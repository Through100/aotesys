import express from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cert, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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

loadEnvFile(path.join(__dirname, ".env"));

const firebaseAdmin = initializeFirebaseAdmin();

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
    enabled: Boolean(firebaseAdmin.db),
    projectId: firebaseAdmin.projectId
  });
});

app.get("/api/workspaces", async (request, response) => {
  try {
    const db = requireFirebaseDb();
    const snapshot = await db.collection("workspaces").orderBy("createdAt").get();

    response.json({
      workspaces: snapshot.docs.map((doc) => normalizeWorkspaceDoc(doc))
    });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.post("/api/workspaces", async (request, response) => {
  try {
    const db = requireFirebaseDb();
    const workspace = sanitizeWorkspace(request.body?.workspace || request.body);
    const channels = normalizeChannelsPayload(request.body?.channels);
    const syncToken = getWorkspaceSyncToken(request);
    const workspaceRef = db.collection("workspaces").doc(workspace.slug);
    const workspaceSnapshot = await workspaceRef.get();
    const syncTokenHash = hashWorkspaceSyncToken(syncToken);

    assertWorkspaceTokenMatch(workspaceSnapshot, syncTokenHash);

    await workspaceRef.set(
      {
        ...workspace,
        syncTokenHash,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: workspace.createdAt || FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    if (channels.length > 0) {
      await workspaceRef.collection("state").doc("channels").set(
        {
          channels,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    response.status(201).json({ workspace });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.get("/api/workspaces/:workspaceSlug/channels", async (request, response) => {
  try {
    const db = requireFirebaseDb();
    const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
    await requireWorkspaceAccess(db, workspaceSlug, getWorkspaceSyncToken(request));
    const snapshot = await db
      .collection("workspaces")
      .doc(workspaceSlug)
      .collection("state")
      .doc("channels")
      .get();

    response.json({
      channels: normalizeChannelsPayload(snapshot.data()?.channels)
    });
  } catch (error) {
    sendFirebaseError(response, error);
  }
});

app.put("/api/workspaces/:workspaceSlug/channels", async (request, response) => {
  try {
    const db = requireFirebaseDb();
    const workspaceSlug = sanitizeSlug(request.params.workspaceSlug);
    const channels = normalizeChannelsPayload(request.body?.channels);
    await requireWorkspaceAccess(db, workspaceSlug, getWorkspaceSyncToken(request));

    await db
      .collection("workspaces")
      .doc(workspaceSlug)
      .collection("state")
      .doc("channels")
      .set(
        {
          channels,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://*.google-analytics.com https://firebase.googleapis.com https://firestore.googleapis.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
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
    db: getFirestore(app),
    projectId: serviceAccount.project_id || ""
  };
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

function requireFirebaseDb() {
  if (!firebaseAdmin.db) {
    const error = new Error("Firebase Admin is not configured.");
    error.statusCode = 503;
    throw error;
  }

  return firebaseAdmin.db;
}

function normalizeWorkspaceDoc(doc) {
  const data = doc.data() || {};

  return {
    name: String(data.name || doc.id),
    slug: String(data.slug || doc.id),
    createdAt: toIsoString(data.createdAt) || new Date(0).toISOString()
  };
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

function getWorkspaceSyncToken(request) {
  const token = String(
    request.get(WORKSPACE_SYNC_TOKEN_HEADER) || request.body?.syncToken || ""
  ).trim();

  if (token.length < 24 || token.length > 160) {
    throwBadRequest("Workspace sync token is required.");
  }

  return token;
}

function hashWorkspaceSyncToken(syncToken) {
  return createHash("sha256").update(syncToken).digest("hex");
}

async function requireWorkspaceAccess(db, workspaceSlug, syncToken) {
  const workspaceSnapshot = await db.collection("workspaces").doc(workspaceSlug).get();

  if (!workspaceSnapshot.exists) {
    const error = new Error("Workspace not found.");
    error.statusCode = 404;
    throw error;
  }

  assertWorkspaceTokenMatch(workspaceSnapshot, hashWorkspaceSyncToken(syncToken));
}

function assertWorkspaceTokenMatch(workspaceSnapshot, syncTokenHash) {
  const savedTokenHash = workspaceSnapshot.data()?.syncTokenHash;

  if (workspaceSnapshot.exists && savedTokenHash && savedTokenHash !== syncTokenHash) {
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

function sendFirebaseError(response, error) {
  response.status(error.statusCode || 500).json({
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
