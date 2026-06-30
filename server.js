import express from "express";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { cert, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createServer as createViteServer } from "vite";
import {
  DEFAULT_IMAGE,
  SITE_URL,
  getCanonicalUrl,
  getPageMetadataByName,
  getPageMetadataByPath,
  getRouteNameByPath,
  getStructuredData
} from "./src/seoContent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const MANAGER_HANDOFF_REPLY =
  "I'm unsure at the moment. Can I get your email address or preferred contact detail so the Sale Manager can answer you back?";
const OFF_TOPIC_REPLY =
  "I can only help with questions related to this business. If you have a business question, please send it here.";
const WORKSPACE_SYNC_TOKEN_HEADER = "x-aotesys-workspace-token";
const FIREBASE_AUTH_ORIGIN = "https://aotesys-9c7a5.firebaseapp.com";

const runtimeEnvPath = resolveRuntimeEnvPath();
ensureRuntimeEnvTemplate(runtimeEnvPath);
loadEnvFile(runtimeEnvPath);

const firebaseAdmin = initializeFirebaseAdmin();
const appDatabase = initializeAppDatabase();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

if (isProduction) {
  app.use(applyProductionHeaders);
  app.use(redirectCanonicalHost);
}

app.get("/api/firebase-status", (request, response) => {
  response.json({
    enabled: Boolean(firebaseAdmin.auth && appDatabase),
    projectId: firebaseAdmin.projectId,
    storage: "sqlite"
  });
});

app.get("/api/workspaces", async (request, response) => {
  try {
    const firebaseUser = await requireFirebaseUser(request);
    const rows = appDatabase
      .prepare(
        "SELECT name, slug, created_at AS createdAt FROM workspaces WHERE owner_uid = ? ORDER BY created_at"
      )
      .all(firebaseUser.uid);

    response.json({
      workspaces: rows.map(normalizeWorkspaceRecord)
    });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.post("/api/workspaces", async (request, response) => {
  try {
    const firebaseUser = await requireFirebaseUser(request);
    const workspace = sanitizeWorkspace(request.body?.workspace || request.body);
    const channels = normalizeChannelsPayload(request.body?.channels);
    const syncToken = getWorkspaceSyncToken(request);
    const workspaceRecord = getWorkspaceRecord(workspace.slug);
    const syncTokenHash = hashWorkspaceSyncToken(syncToken);
    const now = new Date().toISOString();

    if (request.body?.intent === "create" && workspaceRecord) {
      throwWorkspaceUnavailable();
    }

    assertWorkspaceOwner(workspaceRecord, firebaseUser.uid);

    appDatabase
      .prepare(
        `
          INSERT INTO workspaces (
            slug,
            name,
            owner_uid,
            owner_email,
            owner_name,
            sync_token_hash,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            name = excluded.name,
            owner_email = excluded.owner_email,
            owner_name = excluded.owner_name,
            sync_token_hash = excluded.sync_token_hash,
            updated_at = excluded.updated_at
        `
      )
      .run(
        workspace.slug,
        workspace.name,
        firebaseUser.uid,
        firebaseUser.email || "",
        firebaseUser.name || "",
        syncTokenHash,
        workspaceRecord?.created_at || workspace.createdAt || now,
        now
      );

    if (channels.length > 0) {
      upsertWorkspaceChannels(workspace.slug, channels, now);
    }

    response.status(201).json({ workspace });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.get("/api/workspaces/:workspaceSlug/channels", async (request, response) => {
  try {
    const firebaseUser = await getOptionalFirebaseUser(request);
    const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
    requireWorkspaceAccess(workspaceSlug, {
      firebaseUser,
      syncToken: getOptionalWorkspaceSyncToken(request)
    });
    const state = getWorkspaceStateRecord(workspaceSlug);

    response.json({
      channels: normalizeChannelsPayload(parseJsonArray(state?.channels_json))
    });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.get(
  "/api/public/workspaces/:workspaceSlug/channels/:channelId",
  (request, response) => {
    try {
      const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
      const channelId = sanitizeChannelId(request.params.channelId);
      const conversationId = request.query.conversationId
        ? sanitizeConversationId(request.query.conversationId)
        : "";
      const workspaceRecord = requirePublicWorkspace(workspaceSlug);
      const channel = requirePublicChannel(workspaceSlug, channelId);

      response.json({
        workspace: normalizeWorkspaceRecord(workspaceRecord),
        channel: toPublicChannelPayload(channel, conversationId)
      });
    } catch (error) {
      sendFirebaseError(response, error);
    }
  }
);

app.post(
  "/api/public/workspaces/:workspaceSlug/channels/:channelId/conversations/:conversationId/messages",
  async (request, response) => {
    try {
      const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
      const channelId = sanitizeChannelId(request.params.channelId);
      const conversationId = sanitizeConversationId(request.params.conversationId);
      const message = String(request.body?.message || "").trim();

      if (!message) {
        throwBadRequest("Message is required.");
      }

      const workspaceRecord = requirePublicWorkspace(workspaceSlug);
      const channels = getWorkspaceChannels(workspaceSlug);
      const channelIndex = channels.findIndex((channel) => channel.id === channelId);

      if (channelIndex === -1) {
        throwNotFound("Channel not found.");
      }

      const now = new Date().toISOString();
      let channel = channels[channelIndex];
      let conversation = getOrCreatePublicConversation(channel, conversationId, now);
      const detectedName = detectVisitorName(message);
      const visitorName =
        conversation.visitorName === "Visitor" && detectedName
          ? detectedName
          : conversation.visitorName;

      conversation = {
        ...conversation,
        visitorName,
        status: "Bot typing",
        lastSeen: "Just now",
        lastActivityAt: now,
        autoKnowledgeAuditedAt: "",
        archived: false,
        messages: [
          ...conversation.messages,
          {
            id: conversation.messages.length + 1,
            role: "visitor",
            text: message
          }
        ]
      };

      const botReply = await getPublicBotReply(channel, conversation, message);
      const botMessageText =
        botReply.needsManager && channel.receptionistLearningEnabled
          ? "Thanks, let me check that properly with the business owner so I can give you the right answer."
          : botReply.reply;
      const conversationStatus =
        botReply.needsManager && channel.receptionistLearningEnabled
          ? "Receptionist checking"
          : botReply.needsManager
            ? "Needs manager"
            : "Bot active";

      conversation = {
        ...conversation,
        status: conversationStatus,
        lastSeen: "Just now",
        lastActivityAt: new Date().toISOString(),
        messages: [
          ...conversation.messages,
          {
            id: conversation.messages.length + 1,
            role: "bot",
            text: botMessageText
          }
        ]
      };

      if (botReply.needsManager && channel.receptionistLearningEnabled) {
        channel = upsertChannelConversation(
          channel,
          createReceptionistLearningConversation({
            channel,
            customerConversation: conversation,
            customerMessage: message,
            now
          })
        );
      }

      channel = upsertChannelConversation(channel, conversation);
      channels[channelIndex] = channel;
      upsertWorkspaceChannels(workspaceSlug, channels, new Date().toISOString());

      response.json({
        workspace: normalizeWorkspaceRecord(workspaceRecord),
        channel: toPublicChannelPayload(channel, conversationId)
      });
    } catch (error) {
      sendFirebaseError(response, error);
    }
  }
);

app.put("/api/workspaces/:workspaceSlug/channels", async (request, response) => {
  try {
    const firebaseUser = await getOptionalFirebaseUser(request);
    const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
    const channels = normalizeChannelsPayload(request.body?.channels);
    requireWorkspaceAccess(workspaceSlug, {
      firebaseUser,
      syncToken: getOptionalWorkspaceSyncToken(request)
    });

    upsertWorkspaceChannels(workspaceSlug, channels, new Date().toISOString());

    response.json({ ok: true });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.post("/api/chat", async (request, response) => {
  try {
    const result = await createOllamaReply(request.body);
    response.json(result);
  } catch (error) {
    console.error("Ollama chat failed:", error.message);
    response.status(502).json({
      error: "The bot could not reach the Ollama service."
    });
  }
});

app.post("/api/auto-knowledge", async (request, response) => {
  try {
    const result = await createAutoKnowledgeUpdate(request.body);
    response.json(result);
  } catch (error) {
    console.error("Auto knowledge update failed:", error.message);
    response.status(502).json({
      error: "The auto knowledge update could not reach the Ollama service."
    });
  }
});

app.use("/__/auth", proxyFirebaseAuthHandler);

if (isProduction) {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath, { index: false }));
  app.use((request, response, next) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      next();
      return;
    }

    const metadata = getPageMetadataByPath(request.path);
    const routeName = metadata ? getRouteNameByPath(request.path) : "not-found";
    const statusCode = metadata ? 200 : 404;

    response
      .status(statusCode)
      .type("html")
      .send(renderIndexForRoute(distPath, routeName));
  });
} else {
  const vite = await createViteServer({
    appType: "spa",
    server: {
      host,
      middlewareMode: true
    }
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`Aotesys running at http://${host}:${port}/`);
});

function applyProductionHeaders(request, response, next) {
  response.setHeader(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://www.gstatic.com https://lh3.googleusercontent.com",
      "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://*.google-analytics.com https://firebase.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://accounts.google.com",
      "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'"
    ].join("; ")
  );
  next();
}

function redirectCanonicalHost(request, response, next) {
  const hostHeader = String(request.headers.host || "").toLowerCase();
  const hostname = hostHeader.split(":")[0];

  if (hostname === "www.aotesys.com") {
    response.redirect(301, `https://aotesys.com${request.originalUrl}`);
    return;
  }

  next();
}

async function proxyFirebaseAuthHandler(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.sendStatus(405);
    return;
  }

  try {
    const targetUrl = new URL(request.originalUrl, FIREBASE_AUTH_ORIGIN);
    const firebaseResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        accept: request.headers.accept || "*/*",
        "accept-language": request.headers["accept-language"] || "en-US,en;q=0.9",
        "user-agent": request.headers["user-agent"] || "Aotesys auth proxy"
      },
      redirect: "manual"
    });

    response.status(firebaseResponse.status);
    copyProxyHeader(firebaseResponse, response, "cache-control");
    copyProxyHeader(firebaseResponse, response, "content-type");
    copyProxyHeader(firebaseResponse, response, "etag");
    copyProxyHeader(firebaseResponse, response, "location");

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const body = Buffer.from(await firebaseResponse.arrayBuffer());
    response.send(body);
  } catch (error) {
    console.error("Firebase auth proxy failed:", error.message);
    response.status(502).type("text/plain").send("Firebase auth proxy failed.");
  }
}

function copyProxyHeader(sourceResponse, targetResponse, headerName) {
  const value = sourceResponse.headers.get(headerName);

  if (value) {
    targetResponse.setHeader(headerName, value);
  }
}

function renderIndexForRoute(distPath, routeName) {
  const indexPath = path.join(distPath, "index.html");
  const metadata = getPageMetadataByName(routeName);
  const canonicalUrl = getCanonicalUrl(routeName);
  const imageUrl = `${SITE_URL}${DEFAULT_IMAGE}`;
  const structuredData = JSON.stringify(getStructuredData(routeName)).replace(
    /</g,
    "\\u003c"
  );

  let html = readFileSync(indexPath, "utf8");
  html = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`
  );
  html = replaceMetaTag(html, "name", "description", metadata.description);
  html = replaceMetaTag(
    html,
    "name",
    "robots",
    metadata.indexable ? "index, follow" : "noindex, follow"
  );
  html = replaceMetaTag(html, "property", "og:type", routeName === "guide" ? "article" : "website");
  html = replaceMetaTag(html, "property", "og:title", metadata.title);
  html = replaceMetaTag(html, "property", "og:description", metadata.description);
  html = replaceMetaTag(html, "property", "og:url", canonicalUrl);
  html = replaceMetaTag(html, "property", "og:image", imageUrl);
  html = replaceMetaTag(html, "name", "twitter:title", metadata.title);
  html = replaceMetaTag(html, "name", "twitter:description", metadata.description);
  html = replaceMetaTag(html, "name", "twitter:image", imageUrl);
  html = replaceCanonicalLink(html, canonicalUrl);
  html = html.replace(
    /<script\b(?=[^>]*\bid=["']structured-data["'])[^>]*>[\s\S]*?<\/script>/i,
    `<script id="structured-data" type="application/ld+json">${structuredData}</script>`
  );

  return html;
}

function replaceMetaTag(html, attribute, key, content) {
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(key)}["'])[^>]*>`,
    "i"
  );
  const tag = `<meta ${attribute}="${key}" content="${escapeHtmlAttribute(
    content
  )}">`;

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function replaceCanonicalLink(html, href) {
  const tag = `<link rel="canonical" href="${escapeHtmlAttribute(href)}">`;
  const pattern = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i;

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveRuntimeEnvPath() {
  const sharedEnvPath = "/var/www/vhosts/aotesys.com/shared/.env";

  if (isProduction && existsSync(path.dirname(sharedEnvPath))) {
    return sharedEnvPath;
  }

  return path.join(__dirname, ".env");
}

function ensureRuntimeEnvTemplate(envPath) {
  if (!isProduction) {
    return;
  }

  const templateEntries = [
    ["OLLAMA_BASE_URL", "https://ollama.com/api"],
    ["OLLAMA_MODEL", ""],
    ["OLLAMA_API_KEY", ""],
    ["AUTO_KNOWLEDGE_MODEL", ""]
  ];

  mkdirSync(path.dirname(envPath), { recursive: true });

  const existingContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const existingKeys = new Set(
    existingContent
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#=]+)=/)?.[1]?.trim())
      .filter(Boolean)
  );
  const missingLines = templateEntries
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, value]) => `${key}=${value}`);

  if (missingLines.length === 0) {
    return;
  }

  const prefix = existingContent.trim() ? "\n\n" : "";
  const nextContent = `${existingContent}${prefix}# Aotesys chatbot model settings\n${missingLines.join("\n")}\n`;
  writeFileSync(envPath, nextContent, { mode: 0o600 });
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const envLines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of envLines) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);

    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function initializeFirebaseAdmin() {
  const serviceAccount = getFirebaseServiceAccount();

  if (!serviceAccount) {
    return {
      db: null,
      projectId: ""
    };
  }

  const app =
    getApps()[0] ||
    initializeAdminApp({
      credential: cert(serviceAccount)
    });

  return {
    auth: getAuth(app),
    projectId: serviceAccount.project_id || ""
  };
}

function initializeAppDatabase() {
  const databasePath = resolveAppDatabasePath();

  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_uid TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      sync_token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workspaces_owner_created
      ON workspaces(owner_uid, created_at);

    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_slug TEXT PRIMARY KEY,
      channels_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_slug) REFERENCES workspaces(slug) ON DELETE CASCADE
    );
  `);

  return database;
}

function resolveAppDatabasePath() {
  if (process.env.AOTESYS_DB_PATH) {
    return process.env.AOTESYS_DB_PATH;
  }

  const productionSharedDir = "/var/www/vhosts/aotesys.com/shared";

  if (isProduction && existsSync(productionSharedDir)) {
    return path.join(productionSharedDir, "aotesys.sqlite");
  }

  return path.join(__dirname, ".data", "aotesys.sqlite");
}

function getFirebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  try {
    if (rawJson) {
      return normalizeServiceAccount(JSON.parse(rawJson));
    }

    if (serviceAccountPath && existsSync(serviceAccountPath)) {
      return normalizeServiceAccount(
        JSON.parse(readFileSync(serviceAccountPath, "utf8"))
      );
    }

    const bundledServiceAccountPath = path.join(
      __dirname,
      ".deploy",
      "firebase-service-account.json"
    );

    if (existsSync(bundledServiceAccountPath)) {
      return normalizeServiceAccount(
        JSON.parse(readFileSync(bundledServiceAccountPath, "utf8"))
      );
    }
  } catch (error) {
    console.error("Firebase service account could not be loaded:", error.message);
  }

  return null;
}

function normalizeServiceAccount(serviceAccount) {
  return {
    ...serviceAccount,
    private_key: String(serviceAccount.private_key || "").replace(/\\n/g, "\n")
  };
}

async function requireFirebaseUser(request) {
  const user = await getOptionalFirebaseUser(request);

  if (!user) {
    const error = new Error("Firebase sign-in is required.");
    error.statusCode = 401;
    throw error;
  }

  return user;
}

async function getOptionalFirebaseUser(request) {
  if (!firebaseAdmin.auth) {
    return null;
  }

  const authorization = String(request.get("authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }

  try {
    return await firebaseAdmin.auth.verifyIdToken(match[1]);
  } catch {
    const error = new Error("Firebase sign-in could not be verified.");
    error.statusCode = 401;
    throw error;
  }
}

function normalizeWorkspaceRecord(record) {
  return {
    name: String(record?.name || record?.slug || ""),
    slug: String(record?.slug || ""),
    createdAt: toIsoString(record?.createdAt || record?.created_at) || new Date(0).toISOString()
  };
}

function getWorkspaceRecord(workspaceSlug) {
  return appDatabase
    .prepare("SELECT * FROM workspaces WHERE slug = ?")
    .get(workspaceSlug);
}

function getWorkspaceStateRecord(workspaceSlug) {
  return appDatabase
    .prepare("SELECT * FROM workspace_state WHERE workspace_slug = ?")
    .get(workspaceSlug);
}

function getWorkspaceChannels(workspaceSlug) {
  const state = getWorkspaceStateRecord(workspaceSlug);

  return normalizeChannelsPayload(parseJsonArray(state?.channels_json));
}

function upsertWorkspaceChannels(workspaceSlug, channels, updatedAt) {
  appDatabase
    .prepare(
      `
        INSERT INTO workspace_state (workspace_slug, channels_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_slug) DO UPDATE SET
          channels_json = excluded.channels_json,
          updated_at = excluded.updated_at
      `
    )
    .run(workspaceSlug, JSON.stringify(channels), updatedAt);
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeWorkspace(value) {
  const slug = sanitizeSlug(value?.slug);
  const name = String(value?.name || "").trim().slice(0, 120);

  if (!name) {
    throwBadRequest("Workspace name is required.");
  }

  return {
    name,
    slug,
    createdAt: String(value?.createdAt || new Date().toISOString())
  };
}

function sanitizeSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (!slug) {
    throwBadRequest("Workspace slug is required.");
  }

  return slug;
}

function sanitizeChannelId(value) {
  const channelId = String(value || "").trim().toLowerCase();

  if (!/^[a-z0-9-]{1,80}$/.test(channelId)) {
    throwBadRequest("Channel ID is invalid.");
  }

  return channelId;
}

function sanitizeConversationId(value) {
  const conversationId = String(value || "").trim().toLowerCase();

  if (!/^[a-z0-9-]{1,120}$/.test(conversationId)) {
    throwBadRequest("Conversation ID is invalid.");
  }

  return conversationId;
}

function requirePublicWorkspace(workspaceSlug) {
  const workspaceRecord = getWorkspaceRecord(workspaceSlug);

  if (!workspaceRecord) {
    throwNotFound("Workspace not found.");
  }

  return workspaceRecord;
}

function requirePublicChannel(workspaceSlug, channelId) {
  const channel = getWorkspaceChannels(workspaceSlug).find(
    (item) => item.id === channelId
  );

  if (!channel) {
    throwNotFound("Channel not found.");
  }

  return channel;
}

function toPublicChannelPayload(channel, conversationId = "") {
  const conversations = conversationId
    ? channel.conversations.filter(
        (conversation) => conversation.id === conversationId
      )
    : [];

  return {
    ...channel,
    conversations
  };
}

function getOrCreatePublicConversation(channel, conversationId, now) {
  const existingConversation = channel.conversations.find(
    (conversation) => conversation.id === conversationId
  );

  if (existingConversation) {
    return existingConversation;
  }

  return {
    id: conversationId,
    visitorName: "Visitor",
    status: "Bot active",
    lastSeen: "Just now",
    lastActivityAt: now,
    autoKnowledgeAuditedAt: "",
    archived: false,
    messages: [
      {
        id: 1,
        role: "bot",
        text:
          "Hi, I am Sale Assist. I can help answer questions here. Before we start, what should I call you?"
      }
    ]
  };
}

function upsertChannelConversation(channel, conversation) {
  const existingIndex = channel.conversations.findIndex(
    (item) => item.id === conversation.id
  );

  if (existingIndex === -1) {
    return {
      ...channel,
      conversations: [...channel.conversations, conversation]
    };
  }

  return {
    ...channel,
    conversations: channel.conversations.map((item) =>
      item.id === conversation.id ? conversation : item
    )
  };
}

function createReceptionistLearningConversation({
  channel,
  customerConversation,
  customerMessage,
  now
}) {
  const id = `learn-${customerConversation.id}`;
  const existingConversation = channel.conversations.find(
    (conversation) => conversation.id === id
  );
  const existingMessages = existingConversation?.messages || [];
  const customerName = customerConversation.visitorName || "the visitor";
  const existingKnowledge = String(channel.autoKnowledgePrompt || "").trim();
  const possibleConflict = existingKnowledge
    ? "\n\nIf this differs from existing learned knowledge, please say what changed and which answer should be used going forward."
    : "";

  return {
    id,
    visitorName: "Receptionist learning",
    status: "Owner input needed",
    lastSeen: "Just now",
    lastActivityAt: now,
    autoKnowledgeAuditedAt: "",
    archived: false,
    receptionistLearning: {
      customerConversationId: customerConversation.id,
      customerName,
      customerQuestion: customerMessage
    },
    messages:
      existingMessages.length > 0
        ? existingMessages
        : [
            {
              id: 1,
              role: "bot",
              text: [
                `Customer question from ${customerName}: "${customerMessage}"`,
                "I do not have an approved answer yet. What should I tell the customer?",
                "Helpful details to include: exact answer, any limits or conditions, whether this answer should be reused for future customers, and one or two related follow-up details customers often ask.",
                possibleConflict.trim()
              ]
                .filter(Boolean)
                .join("\n\n")
            }
          ]
  };
}

async function getPublicBotReply(channel, conversation, message) {
  try {
    return await createOllamaReply({
      message,
      prompt: channel.prompt,
      promptUpdatedAt: channel.promptUpdatedAt,
      autoKnowledgeEnabled: channel.autoKnowledgeEnabled,
      autoKnowledgePrompt: channel.autoKnowledgePrompt,
      autoKnowledgeUpdatedAt: channel.autoKnowledgeUpdatedAt,
      visitorName: conversation.visitorName,
      history: conversation.messages
    });
  } catch (error) {
    console.error("Public chat bot failed:", error.message);
    return {
      reply: MANAGER_HANDOFF_REPLY,
      needsManager: true,
      offTopic: false
    };
  }
}

function getWorkspaceSyncToken(request) {
  const token = getOptionalWorkspaceSyncToken(request);

  if (!token) {
    throwBadRequest("Workspace sync token is required.");
  }

  return token;
}

function getOptionalWorkspaceSyncToken(request) {
  const token = String(
    request.get(WORKSPACE_SYNC_TOKEN_HEADER) || request.body?.syncToken || ""
  ).trim();

  if (!token) {
    return "";
  }

  if (token.length < 24 || token.length > 160) {
    throwBadRequest("Workspace sync token is invalid.");
  }

  return token;
}

function hashWorkspaceSyncToken(syncToken) {
  return createHash("sha256").update(syncToken).digest("hex");
}

function requireWorkspaceAccess(workspaceSlug, { firebaseUser, syncToken }) {
  const workspaceRecord = getWorkspaceRecord(workspaceSlug);

  if (!workspaceRecord) {
    const error = new Error("Workspace not found.");
    error.statusCode = 404;
    throw error;
  }

  if (firebaseUser?.uid && workspaceRecord.owner_uid === firebaseUser.uid) {
    return;
  }

  if (syncToken) {
    assertWorkspaceTokenMatch(workspaceRecord, hashWorkspaceSyncToken(syncToken));
    return;
  }

  const error = new Error("Workspace access is required.");
  error.statusCode = 401;
  throw error;
}

function assertWorkspaceOwner(workspaceRecord, ownerUid) {
  const savedOwnerUid = workspaceRecord?.owner_uid;

  if (workspaceRecord && savedOwnerUid && savedOwnerUid !== ownerUid) {
    throwWorkspaceUnavailable();
  }
}

function throwWorkspaceUnavailable() {
  const error = new Error("The workspace name is unavailable.");
  error.statusCode = 409;
  error.code = "workspace-unavailable";
  throw error;
}

function assertWorkspaceTokenMatch(workspaceRecord, syncTokenHash) {
  const savedTokenHash = workspaceRecord?.sync_token_hash;

  if (workspaceRecord && savedTokenHash && savedTokenHash !== syncTokenHash) {
    const error = new Error("Workspace sync token is invalid.");
    error.statusCode = 403;
    throw error;
  }
}

function normalizeChannelsPayload(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels.map((channel) => ({
    id: String(channel?.id || ""),
    name: String(channel?.name || ""),
    promptUpdatedAt: String(channel?.promptUpdatedAt || ""),
    prompt: String(channel?.prompt || ""),
    autoKnowledgeEnabled: Boolean(channel?.autoKnowledgeEnabled),
    autoKnowledgePrompt: String(channel?.autoKnowledgePrompt || ""),
    autoKnowledgeUpdatedAt: String(channel?.autoKnowledgeUpdatedAt || ""),
    autoKnowledgeLastRunAt: String(channel?.autoKnowledgeLastRunAt || ""),
    receptionistLearningEnabled: Boolean(channel?.receptionistLearningEnabled),
    conversations: Array.isArray(channel?.conversations)
      ? channel.conversations.map(normalizeConversationPayload)
      : []
  }));
}

function normalizeConversationPayload(conversation) {
  return {
    id: String(conversation?.id || ""),
    visitorName: String(conversation?.visitorName || "Visitor"),
    status: String(conversation?.status || "Bot active"),
    lastSeen: String(conversation?.lastSeen || "Just now"),
    lastActivityAt: String(conversation?.lastActivityAt || ""),
    autoKnowledgeAuditedAt: String(conversation?.autoKnowledgeAuditedAt || ""),
    archived: Boolean(conversation?.archived),
    receptionistLearning: conversation?.receptionistLearning || null,
    messages: Array.isArray(conversation?.messages)
      ? conversation.messages.map((message) => ({
          id: Number(message?.id) || 1,
          role: String(message?.role || "bot"),
          text: String(message?.text || "")
        }))
      : []
  };
}

function toIsoString(value) {
  if (!value) {
    return "";
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function throwBadRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function throwNotFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  throw error;
}

function sendFirebaseError(response, error) {
  response.status(error.statusCode || 500).json({
    code: error.code || "firebase-request-failed",
    error: error.message || "Firebase request failed."
  });
}

async function createOllamaReply(payload) {
  const model = process.env.OLLAMA_MODEL;

  if (!model) {
    throw new Error("OLLAMA_BASE_URL and OLLAMA_MODEL must be set.");
  }

  const message = String(payload?.message || "").trim();

  if (!message) {
    throw new Error("Message is required.");
  }

  const visitorName = String(payload?.visitorName || "").trim();
  const detectedName = detectVisitorName(message);

  if (hasContactDetail(message)) {
    return {
      reply:
        "Thanks, I have your contact detail. The Sale Manager can follow up with you.",
      needsManager: false,
      offTopic: false
    };
  }

  if (!hasBusinessTerm(message)) {
    if (detectedName) {
      return {
        reply: `Nice to meet you, ${detectedName}. What would you like help with today?`,
        needsManager: false,
        offTopic: false
      };
    }

    if (isGreeting(message)) {
      return {
        reply:
          !visitorName || visitorName === "Visitor" || visitorName === "unknown"
            ? "Hi, what should I call you?"
            : `Hi ${visitorName}. What business question can I help with today?`,
        needsManager: false,
        offTopic: false
      };
    }

    return {
      reply: OFF_TOPIC_REPLY,
      needsManager: false,
      offTopic: true
    };
  }

  const prompt = String(payload?.prompt || "").trim();
  const promptUpdatedAt = String(payload?.promptUpdatedAt || "").trim();
  const autoKnowledgePrompt = payload?.autoKnowledgeEnabled
    ? String(payload?.autoKnowledgePrompt || "").trim()
    : "";
  const autoKnowledgeUpdatedAt = payload?.autoKnowledgeEnabled
    ? String(payload?.autoKnowledgeUpdatedAt || "").trim()
    : "";
  const promptAge = getPromptAge(promptUpdatedAt);
  const messages = buildMessages(payload, message, {
    prompt,
    promptAge,
    promptUpdatedAt,
    autoKnowledgePrompt,
    autoKnowledgeUpdatedAt
  });
  const reply = await sendOllamaMessages(messages, model);

  const decision = parseModelDecision(reply);

  if (!decision.businessRelated) {
    return {
      reply: OFF_TOPIC_REPLY,
      needsManager: false,
      offTopic: true
    };
  }

  if (!decision.supportedByPrompt) {
    return {
      reply: MANAGER_HANDOFF_REPLY,
      needsManager: true,
      offTopic: false
    };
  }

  let cleanReply = decision.reply.trim();

  if (
    promptAge.isStale &&
    hasBusinessTerm(message) &&
    !cleanReply.includes(promptAge.label)
  ) {
    cleanReply = stripLastUpdatedSentence(cleanReply);
    cleanReply = `${cleanReply} This information was last updated ${promptAge.label}.`;
  }

  return {
    reply: cleanReply,
    needsManager: isManagerHandoff(cleanReply),
    offTopic: false
  };
}

async function createAutoKnowledgeUpdate(payload) {
  const model = process.env.AUTO_KNOWLEDGE_MODEL || process.env.OLLAMA_MODEL;

  if (!model) {
    throw new Error("OLLAMA_MODEL must be set.");
  }

  const conversations = Array.isArray(payload?.conversations)
    ? payload.conversations
    : [];
  const existingKnowledge = String(payload?.autoKnowledgePrompt || "").trim();

  if (conversations.length === 0) {
    return {
      autoKnowledgePrompt: existingKnowledge,
      auditedConversationIds: [],
      summary: "No conversations were provided."
    };
  }

  const messages = buildAutoKnowledgeMessages(payload, conversations);
  const reply = await sendOllamaMessages(messages, model);
  const update = parseAutoKnowledgeUpdate(reply, existingKnowledge);

  return {
    ...update,
    auditedConversationIds: conversations
      .map((conversation) => String(conversation.id || "").trim())
      .filter(Boolean)
  };
}

async function sendOllamaMessages(messages, model) {
  const baseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "");

  if (!baseUrl || !model) {
    throw new Error("OLLAMA_BASE_URL and OLLAMA_MODEL must be set.");
  }

  const isOpenAiCompatible = /\/v1(?:\/)?$/i.test(baseUrl);
  const endpoint = isOpenAiCompatible
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/chat`;
  const headers = {
    "Content-Type": "application/json"
  };

  if (process.env.OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }

  const ollamaResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: false })
  });

  if (!ollamaResponse.ok) {
    throw new Error(`Ollama returned HTTP ${ollamaResponse.status}.`);
  }

  const data = await ollamaResponse.json();
  const reply = isOpenAiCompatible
    ? data?.choices?.[0]?.message?.content
    : data?.message?.content;

  if (!reply) {
    throw new Error("Ollama response did not include a reply.");
  }

  return reply;
}

function buildMessages(
  payload,
  message,
  { prompt, promptAge, promptUpdatedAt, autoKnowledgePrompt, autoKnowledgeUpdatedAt }
) {
  const visitorName = payload?.visitorName || "unknown";
  let history = Array.isArray(payload?.history) ? payload.history : [];

  if (
    history.at(-1)?.role === "visitor" &&
    history.at(-1)?.text === message
  ) {
    history = history.slice(0, -1);
  }

  return [
    {
      role: "system",
      content: `You are Sale Assist, a careful sales assistant.

Approved channel prompt and business facts:
${prompt || "(No approved facts have been provided yet.)"}

Prompt last updated: ${promptUpdatedAt || "unknown"} (${promptAge.label}).

Enabled Auto Knowledges Learning prompt:
${autoKnowledgePrompt || "(Auto Knowledges Learning is disabled or empty.)"}

Auto Knowledges Learning last updated: ${autoKnowledgeUpdatedAt || "unknown"}.

Current visitor name: ${visitorName}.

Accuracy rules:
- Treat the approved channel prompt and enabled Auto Knowledges Learning prompt above as the only sources of business truth.
- Do not invent prices, shipping details, availability, product/service features, policies, locations, timelines, guarantees, or contact details.
- Answer a business question only when the answer is explicitly provided in the approved channel prompt, enabled Auto Knowledges Learning prompt, or already stated by the visitor in this conversation.
- If the answer is not explicitly provided, use this exact reply: "${MANAGER_HANDOFF_REPLY}"
- If the visitor provides contact details, acknowledge them and say the Sale Manager can follow up.
- If the visitor asks something unrelated to this business, use this exact reply: "${OFF_TOPIC_REPLY}"
- If the visitor has not provided their name yet, ask for their name before deeper sales questions.
- When you answer using an approved fact and the prompt is stale, include that the information was last updated ${promptAge.label}.
- Set supportedByPrompt to true only when the reply is supported by one of the approved sources.
- Keep replies concise, warm, and useful.

Return only JSON with this shape:
{
  "businessRelated": boolean,
  "supportedByPrompt": boolean,
  "reply": "string"
}`
    },
    ...history.slice(-8).map((item) => ({
      role: item.role === "visitor" ? "user" : "assistant",
      content: String(item.text || "")
    })),
    {
      role: "user",
      content: message
    }
  ];
}

function buildAutoKnowledgeMessages(payload, conversations) {
  const channelName = String(payload?.channelName || "Selected channel").trim();
  const botPrompt = String(payload?.botPrompt || "").trim();
  const existingKnowledge = String(payload?.autoKnowledgePrompt || "").trim();

  return [
    {
      role: "system",
      content: `You are GLM 5.2 running Sale Assist's Auto Knowledges Learning audit.

Your job is to update a channel learning prompt from conversations that have not been audited yet.

Learning rules:
- Only add durable business facts explicitly confirmed by the business owner, manager, staff, or existing approved prompts.
- Do not learn facts from visitor guesses, visitor claims, or unanswered visitor questions.
- Visitor questions may be summarized under "Open visitor questions" when they reveal what customers need answered.
- Use the bot prompt only as context; do not copy general bot behavior instructions into Auto Knowledges Learning.
- Prefer conversation-derived business facts and open questions over repeating existing channel instructions.
- Preserve useful existing knowledge, remove duplicates, and keep the result concise.
- If nothing reliable was learned, return the existing learning prompt unchanged.
- Do not invent business details.

Return only JSON with this shape:
{
  "autoKnowledgePrompt": "string",
  "summary": "string"
}`
    },
    {
      role: "user",
      content: `Channel: ${channelName}

Approved bot prompt:
${botPrompt || "(No bot prompt provided.)"}

Existing Auto Knowledges Learning prompt:
${existingKnowledge || "(No learned knowledge yet.)"}

Unaudited or changed conversations:
${conversations.map(formatConversationForKnowledge).join("\n\n")}`
    }
  ];
}

function formatConversationForKnowledge(conversation) {
  const messages = Array.isArray(conversation?.messages)
    ? conversation.messages
    : [];
  const lines = messages
    .map((message) => {
      const text = String(message?.text || "").replace(/\s+/g, " ").trim();

      if (!text) {
        return "";
      }

      return `${getKnowledgeRoleLabel(message?.role)}: ${text}`;
    })
    .filter(Boolean);

  return `Conversation ${conversation?.id || "unknown"} (${conversation?.visitorName || "Visitor"}, last activity ${conversation?.lastActivityAt || "unknown"}):
${lines.join("\n")}`;
}

function getKnowledgeRoleLabel(role) {
  if (role === "owner") {
    return "Business owner";
  }

  if (role === "visitor") {
    return "Visitor";
  }

  return "Sale Assist bot";
}

function isManagerHandoff(reply) {
  return /unsure at the moment|preferred contact|sale manager/i.test(reply);
}

function stripLastUpdatedSentence(reply) {
  return reply
    .replace(
      /\s*(?:please note,?\s*)?(?:this|the)\s+(?:information|answer|price|detail|details)?\s*(?:was|were)?\s*last updated[^.?!]*[.?!]/gi,
      ""
    )
    .trim();
}

function hasBusinessTerm(message) {
  const lowerMessage = message.toLowerCase();

  return [
    "price",
    "cost",
    "fee",
    "charge",
    "pricing",
    "quote",
    "ship",
    "shipping",
    "deliver",
    "delivery",
    "available",
    "availability",
    "feature",
    "package",
    "plan",
    "subscription",
    "setup",
    "support",
    "install",
    "installation",
    "service",
    "product",
    "policy",
    "refund",
    "location",
    "hours",
    "book",
    "appointment",
    "order",
    "buy"
  ].some((term) => lowerMessage.includes(term));
}

function hasContactDetail(message) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s().-]{6,}/.test(message);
}

function isGreeting(message) {
  return /^(hi|hello|hey|kia ora|good morning|good afternoon|good evening)\b/i.test(
    message.trim()
  );
}

function detectVisitorName(message) {
  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();

  if (isGreeting(trimmedMessage)) {
    return "";
  }

  const match = trimmedMessage.match(
    /(?:my name is|i am|i'm|im|call me)\s+([a-z][a-z\s'-]{1,40})/i
  );

  if (match?.[1]) {
    return cleanVisitorName(match[1]);
  }

  if (/^[a-z][a-z'-]*(?:\s[a-z][a-z'-]*){0,2}$/i.test(trimmedMessage)) {
    if (
      [
        "price",
        "shipping",
        "delivery",
        "service",
        "product",
        "business"
      ].includes(lowerMessage)
    ) {
      return "";
    }

    return cleanVisitorName(trimmedMessage);
  }

  return "";
}

function cleanVisitorName(value) {
  return value
    .replace(/[.?!,].*$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseModelDecision(content) {
  const fallback = {
    businessRelated: true,
    supportedByPrompt: false,
    reply: MANAGER_HANDOFF_REPLY
  };

  try {
    const jsonText = String(content).match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(jsonText || content);

    return {
      businessRelated: parsed.businessRelated !== false,
      supportedByPrompt: parsed.supportedByPrompt === true,
      reply:
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply
          : fallback.reply
    };
  } catch {
    return fallback;
  }
}

function parseAutoKnowledgeUpdate(content, existingKnowledge) {
  const fallback = {
    autoKnowledgePrompt: existingKnowledge,
    summary: "No reliable new knowledge was returned."
  };

  try {
    const jsonText = String(content).match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(jsonText || content);
    const nextPrompt =
      typeof parsed.autoKnowledgePrompt === "string"
        ? parsed.autoKnowledgePrompt.trim()
        : "";

    return {
      autoKnowledgePrompt: nextPrompt || existingKnowledge,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Auto Knowledges Learning was updated."
    };
  } catch {
    return fallback;
  }
}

function getPromptAge(promptUpdatedAt) {
  if (!promptUpdatedAt) {
    return {
      isStale: true,
      label: "an unknown time ago"
    };
  }

  const updatedDate = new Date(`${promptUpdatedAt}T00:00:00`);
  const time = updatedDate.getTime();

  if (Number.isNaN(time)) {
    return {
      isStale: true,
      label: "an unknown time ago"
    };
  }

  const diffMs = Math.max(0, Date.now() - time);
  const days = Math.floor(diffMs / 86_400_000);

  if (days >= 365) {
    const years = Math.max(1, Math.floor(days / 365));
    return {
      isStale: true,
      label: years === 1 ? "about 1 year ago" : `about ${years} years ago`
    };
  }

  if (days >= 30) {
    const months = Math.max(1, Math.floor(days / 30));
    return {
      isStale: false,
      label: months === 1 ? "about 1 month ago" : `about ${months} months ago`
    };
  }

  return {
    isStale: false,
    label: days <= 1 ? "today" : `${days} days ago`
  };
}
