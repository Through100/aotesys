import {
  ArrowRight,
  Archive,
  BadgeCheck,
  BookOpen,
  Bot,
  Brain,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Globe2,
  Home,
  Link2,
  LogIn,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Settings,
  Target,
  UserPlus,
  UserRound,
  Workflow
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  DEFAULT_IMAGE,
  FOOTER_LINKS,
  MARKETING_NAV,
  SITE_URL,
  getCanonicalUrl,
  getPageMetadataByName,
  getRouteNameByPath,
  getStructuredData,
  normalizePathname
} from "./seoContent.js";
import {
  initializeFirebaseAnalytics,
  signInWithGoogle,
  signOutFromFirebase,
  subscribeToFirebaseAuth
} from "./firebaseClient.js";

const APP_NAME = "Aotesys";
const APP_DOMAIN = "aotesys.com";
const LEGACY_AUTH_STORAGE_KEY = "sale-assist-auth";
const LEGACY_CHANNELS_STORAGE_KEY = "sale-assist-channels";
const WORKSPACES_STORAGE_KEY = "aotesys-workspaces";
const CURRENT_WORKSPACE_STORAGE_KEY = "aotesys-current-workspace";
const WORKSPACE_SYNC_TOKEN_STORAGE_PREFIX = "aotesys-sync-token";
const UNSURE_MANAGER_REPLY =
  "I'm unsure at the moment. Can I get your email address or preferred contact detail so the Sale Manager can answer you back?";
const OFF_TOPIC_REPLY =
  "I can only help with questions related to this business. If you have a business question, please send it here.";
const MARKETING_ROUTE_NAMES = new Set([
  "features",
  "resources",
  "guide",
  "about",
  "contact",
  "privacy",
  "terms"
]);

const initialChannels = [
  {
    id: "channel-a",
    name: "Channel A",
    promptUpdatedAt: getTodayDate(),
    prompt:
      "You are Sale Assist. Greet visitors warmly, ask for their name, answer product questions clearly, and hand over to the business owner when needed.",
    autoKnowledgeEnabled: false,
    receptionistLearningEnabled: true,
    autoKnowledgePrompt: "",
    autoKnowledgeUpdatedAt: "",
    autoKnowledgeLastRunAt: "",
    conversations: [
      buildOwnerSetupConversation("channel-a", "Channel A", new Date().toISOString())
    ]
  }
];

function getRoute() {
  const path = normalizePathname(window.location.pathname);
  const hostWorkspaceSlug = getWorkspaceSlugFromHost();

  if (path === "/") {
    return { name: "home" };
  }

  if (path.startsWith("/chat/")) {
    const chatParts = path
      .replace("/chat/", "")
      .split("/")
      .map((part) => decodeURIComponent(part))
      .filter(Boolean);
    const workspaceSlug = hostWorkspaceSlug || chatParts[0] || "";
    const channelId = hostWorkspaceSlug ? chatParts[0] : chatParts[1];

    return {
      name: "public-chat",
      workspaceSlug,
      channelId: channelId || "channel-a"
    };
  }

  return { name: getRouteNameByPath(path) };
}

function updateDocumentMetadata(routeName) {
  const metadata = getPageMetadataByName(routeName);
  const canonicalUrl = getCanonicalUrl(routeName);
  const imageUrl = `${SITE_URL}${DEFAULT_IMAGE}`;

  document.title = metadata.title;
  setMetaTag("name", "description", metadata.description);
  setMetaTag(
    "name",
    "robots",
    metadata.indexable ? "index, follow" : "noindex, follow"
  );
  setMetaTag("name", "author", AUTHOR_NAME);
  setMetaTag("property", "og:site_name", APP_NAME);
  setMetaTag("property", "og:type", routeName === "guide" ? "article" : "website");
  setMetaTag("property", "og:title", metadata.title);
  setMetaTag("property", "og:description", metadata.description);
  setMetaTag("property", "og:url", canonicalUrl);
  setMetaTag("property", "og:image", imageUrl);
  setMetaTag("name", "twitter:card", "summary_large_image");
  setMetaTag("name", "twitter:title", metadata.title);
  setMetaTag("name", "twitter:description", metadata.description);
  setMetaTag("name", "twitter:image", imageUrl);
  setCanonicalLink(canonicalUrl);
  setStructuredData(routeName);
}

function setMetaTag(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function setCanonicalLink(href) {
  let element = document.head.querySelector('link[rel="canonical"]');

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  element.setAttribute("href", href);
}

function setStructuredData(routeName) {
  let element = document.head.querySelector("#structured-data");

  if (!element) {
    element = document.createElement("script");
    element.id = "structured-data";
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify(getStructuredData(routeName));
}

function getInitialChannels(workspaceSlug) {
  try {
    const storedChannels = window.localStorage.getItem(
      getWorkspaceChannelsStorageKey(workspaceSlug)
    );
    const parsedChannels = storedChannels ? JSON.parse(storedChannels) : null;

    if (Array.isArray(parsedChannels) && parsedChannels.length > 0) {
      return normalizeChannels(parsedChannels);
    }

    const legacyChannels = window.localStorage.getItem(LEGACY_CHANNELS_STORAGE_KEY);
    const parsedLegacyChannels = legacyChannels ? JSON.parse(legacyChannels) : null;

    if (Array.isArray(parsedLegacyChannels) && parsedLegacyChannels.length > 0) {
      return normalizeChannels(parsedLegacyChannels);
    }
  } catch {
    return normalizeChannels(initialChannels);
  }

  return normalizeChannels(initialChannels);
}

function normalizeChannels(channels) {
  return channels.map((channel) => ({
    ...channel,
    promptUpdatedAt: channel.promptUpdatedAt || getTodayDate(),
    autoKnowledgeEnabled: Boolean(channel.autoKnowledgeEnabled),
    receptionistLearningEnabled: Boolean(channel.receptionistLearningEnabled),
    autoKnowledgePrompt: channel.autoKnowledgePrompt || "",
    autoKnowledgeUpdatedAt: channel.autoKnowledgeUpdatedAt || "",
    autoKnowledgeLastRunAt: channel.autoKnowledgeLastRunAt || "",
    conversations: (channel.conversations || []).map((conversation) => ({
      ...conversation,
      archived: Boolean(conversation.archived),
      receptionistLearning: conversation.receptionistLearning || null,
      autoKnowledgeAuditedAt: conversation.autoKnowledgeAuditedAt || "",
      lastActivityAt:
        conversation.lastActivityAt ||
        deriveLastActivityAt(conversation.lastSeen)
    }))
  }));
}

function ensureOwnerSetupChannels(channels) {
  return normalizeChannels(channels).map((channel) => {
    const hasSetupConversation = channel.conversations.some(
      (conversation) => conversation.receptionistLearning?.type === "owner-setup"
    );

    if (hasSetupConversation) {
      return channel;
    }

    return {
      ...channel,
      receptionistLearningEnabled: true,
      conversations: [
        buildOwnerSetupConversation(channel.id, channel.name),
        ...channel.conversations
      ]
    };
  });
}

function deriveLastActivityAt(lastSeen) {
  if (lastSeen === "2 min ago") {
    return new Date(Date.now() - 120_000).toISOString();
  }

  return new Date().toISOString();
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getNowIso() {
  return new Date().toISOString();
}

function getStoredWorkspaces() {
  try {
    const storedWorkspaces = window.localStorage.getItem(WORKSPACES_STORAGE_KEY);
    const parsedWorkspaces = storedWorkspaces
      ? JSON.parse(storedWorkspaces)
      : [];

    if (Array.isArray(parsedWorkspaces)) {
      return parsedWorkspaces
        .filter((workspace) => workspace?.slug && workspace?.name)
        .map((workspace) => ({
          name: workspace.name,
          slug: workspace.slug,
          createdAt: workspace.createdAt || getNowIso()
        }));
    }
  } catch {
    return [];
  }

  return [];
}

function getInitialWorkspace() {
  const workspaces = getStoredWorkspaces();
  const hostSlug = getWorkspaceSlugFromHost();
  const storedSlug = window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY);
  const selectedSlug = hostSlug || storedSlug;

  if (selectedSlug) {
    return (
      workspaces.find((workspace) => workspace.slug === selectedSlug) || {
        name: titleFromSlug(selectedSlug),
        slug: selectedSlug,
        createdAt: getNowIso()
      }
    );
  }

  if (workspaces[0]) {
    return workspaces[0];
  }

  if (window.localStorage.getItem(LEGACY_AUTH_STORAGE_KEY) === "mock") {
    return {
      name: "Demo Workspace",
      slug: "demo",
      createdAt: getNowIso()
    };
  }

  return null;
}

function getWorkspaceSlugFromHost() {
  const hostname = window.location.hostname.toLowerCase();

  if (
    hostname === APP_DOMAIN ||
    hostname === `www.${APP_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) {
    return "";
  }

  if (hostname.endsWith(`.${APP_DOMAIN}`)) {
    return hostname.replace(`.${APP_DOMAIN}`, "");
  }

  return "";
}

function getWorkspaceChannelsStorageKey(workspaceSlug) {
  return `aotesys-channels-${workspaceSlug || "default"}`;
}

function getWorkspaceAuthStorageKey(workspaceSlug) {
  return `aotesys-auth-${workspaceSlug || "default"}`;
}

function getWorkspaceShareLink(workspaceSlug, channelId) {
  return `https://${APP_DOMAIN}/chat/${workspaceSlug}/${channelId}`;
}

function slugifyWorkspaceName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSortedVisibleConversations(channel) {
  return [...(channel?.conversations || [])]
    .filter((conversation) => !conversation.archived)
    .sort(
      (left, right) =>
        getConversationTime(right) - getConversationTime(left)
    );
}

function getPendingKnowledgeConversations(channel) {
  return (channel?.conversations || []).filter(isConversationPendingKnowledge);
}

function getKnowledgeAuditStats(channel) {
  const conversations = (channel?.conversations || []).filter(
    hasKnowledgeAuditContent
  );
  const pendingConversations = conversations.filter(
    isConversationPendingKnowledge
  );
  const auditedCount = conversations.filter(
    (conversation) => conversation.autoKnowledgeAuditedAt
  ).length;

  return {
    auditedCount,
    pendingConversations,
    totalCount: conversations.length
  };
}

function isConversationPendingKnowledge(conversation) {
  if (!hasKnowledgeAuditContent(conversation)) {
    return false;
  }

  const auditedTime = Date.parse(conversation.autoKnowledgeAuditedAt || "");
  const lastActivityTime = getConversationTime(conversation);

  return !auditedTime || lastActivityTime > auditedTime;
}

function hasKnowledgeAuditContent(conversation) {
  return (conversation?.messages || []).some((message) =>
    ["visitor", "owner"].includes(message.role)
  );
}

function toKnowledgeConversationPayload(conversation) {
  return {
    id: conversation.id,
    visitorName: conversation.visitorName,
    lastActivityAt: conversation.lastActivityAt,
    messages: (conversation.messages || []).map((message) => ({
      role: message.role,
      text: message.text
    }))
  };
}

function getConversationTime(conversation) {
  return Date.parse(conversation.lastActivityAt || "") || 0;
}

function formatAuditDate(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString();
}

function getPluralLabel(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function getVisitorSessionId(workspaceSlug, channelId) {
  const key = `aotesys-visitor-${workspaceSlug || "default"}-${channelId}`;
  const existingId = window.localStorage.getItem(key);

  if (existingId) {
    return existingId;
  }

  const nextId = `visitor-${Date.now()}`;
  window.localStorage.setItem(key, nextId);
  return nextId;
}

function buildReceptionistCustomerReply(ownerAnswer) {
  return `Thanks for waiting. I checked that for you: ${ownerAnswer.trim()}`;
}

function buildReceptionistLearnedFact(customerQuestion, ownerAnswer) {
  return `Customer asked: ${customerQuestion.trim()}\nOwner confirmed: ${ownerAnswer.trim()}`;
}

function appendLearnedKnowledge(existingKnowledge, learnedFact) {
  const cleanExisting = String(existingKnowledge || "").trim();
  const cleanFact = String(learnedFact || "").trim();

  if (!cleanFact || cleanExisting.includes(cleanFact)) {
    return cleanExisting;
  }

  return [cleanExisting, cleanFact].filter(Boolean).join("\n\n");
}

function buildOwnerSetupConversation(channelId, channelName, now = getNowIso()) {
  return {
    id: `${channelId}-owner-setup`,
    visitorName: "Receptionist setup",
    status: "Owner input needed",
    lastSeen: "Start here",
    lastActivityAt: now,
    autoKnowledgeAuditedAt: "",
    archived: false,
    receptionistLearning: {
      type: "owner-setup",
      customerConversationId: "",
      customerName: "Business owner",
      customerQuestion: "Initial business setup"
    },
    messages: [
      {
        id: 1,
        role: "bot",
        text: [
          `Let's set up ${channelName} before customers arrive.`,
          "Tell me what the business does, what products or services you sell, who the ideal customer is, pricing or booking basics, service area, hours, delivery or refund rules, and the top questions customers usually ask.",
          "You can also paste or dump your existing FAQ/Q&A, website copy, product notes, or old customer answers here. I will treat it as owner-approved source material, turn it into receptionist knowledge, and ask follow-up questions where details are missing."
        ].join("\n\n")
      }
    ]
  };
}

function buildOwnerSetupFollowUp(ownerAnswer, learnedCount) {
  if (learnedCount <= 1) {
    return [
      "Thanks, I have saved that as starter receptionist knowledge.",
      "Next, you can paste a Q&A dump if you already have one. Otherwise, tell me the main products or services customers ask about, and what I should say about pricing, packages, availability, or booking."
    ].join("\n\n");
  }

  if (learnedCount === 2) {
    return [
      "Good, I have added those details.",
      "If you have more Q&A, paste it in. What policies should I know before answering customers? For example delivery, refunds, appointment changes, warranty, service area, opening hours, payment methods, or when I should ask for contact details."
    ].join("\n\n");
  }

  return [
    "Got it. I have updated the receptionist knowledge.",
    "Any more FAQ entries, common customer objections, follow-up questions, or things I should never promise? If something changed from an earlier answer, tell me which version is correct."
  ].join("\n\n");
}

function detectVisitorName(text) {
  const trimmedText = text.trim();
  const lowerText = trimmedText.toLowerCase();

  if (["hi", "hello", "hey", "kia ora"].includes(lowerText)) {
    return "";
  }

  const namedMatch = trimmedText.match(
    /(?:my name is|i am|i'm|im|call me)\s+([a-z][a-z\s'-]{1,40})/i
  );

  if (namedMatch?.[1]) {
    return cleanVisitorName(namedMatch[1]);
  }

  if (/^[a-z][a-z'-]*(?:\s[a-z][a-z'-]*){0,2}$/i.test(trimmedText)) {
    return cleanVisitorName(trimmedText);
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

async function requestBotReply(channel, conversation, text) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: text,
      prompt: channel.prompt,
      promptUpdatedAt: channel.promptUpdatedAt,
      autoKnowledgeEnabled: channel.autoKnowledgeEnabled,
      autoKnowledgePrompt: channel.autoKnowledgePrompt,
      autoKnowledgeUpdatedAt: channel.autoKnowledgeUpdatedAt,
      visitorName: conversation.visitorName,
      history: conversation.messages
    })
  });

  if (!response.ok) {
    throw new Error("Ollama request failed.");
  }

  return response.json();
}

async function fetchFirebaseStatus() {
  const response = await fetch("/api/firebase-status");

  if (!response.ok) {
    return { enabled: false };
  }

  return response.json();
}

async function getFirebaseUserHeaders(firebaseUser) {
  if (!firebaseUser) {
    return {};
  }

  const idToken = await firebaseUser.getIdToken();

  return {
    Authorization: `Bearer ${idToken}`
  };
}

async function fetchCloudWorkspaces(firebaseUser) {
  const response = await fetch("/api/workspaces", {
    headers: await getFirebaseUserHeaders(firebaseUser)
  });

  if (!response.ok) {
    throw new Error("Firebase workspaces request failed.");
  }

  const result = await response.json();

  return Array.isArray(result.workspaces) ? result.workspaces : [];
}

async function saveCloudWorkspace(workspace, channels, firebaseUser) {
  return saveCloudWorkspaceWithOptions(workspace, channels, firebaseUser);
}

async function createCloudWorkspace(workspace, channels, firebaseUser) {
  return saveCloudWorkspaceWithOptions(workspace, channels, firebaseUser, {
    intent: "create"
  });
}

async function saveCloudWorkspaceWithOptions(
  workspace,
  channels,
  firebaseUser,
  options = {}
) {
  const syncToken = ensureWorkspaceSyncToken(workspace.slug);
  const authHeaders = await getFirebaseUserHeaders(firebaseUser);
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify({
      workspace,
      channels,
      syncToken,
      intent: options.intent || "sync"
    })
  });

  if (!response.ok) {
    const error = await getApiError(response, "Workspace could not be saved.");
    throw error;
  }
}

async function getApiError(response, fallbackMessage) {
  try {
    const result = await response.json();
    const error = new Error(result.error || fallbackMessage);
    error.statusCode = response.status;
    error.code = result.code || "";
    return error;
  } catch {
    const error = new Error(fallbackMessage);
    error.statusCode = response.status;
    error.code = "";
    return error;
  }
}

async function fetchCloudChannels(workspaceSlug, firebaseUser) {
  const syncToken = getStoredWorkspaceSyncToken(workspaceSlug);
  const authHeaders = await getFirebaseUserHeaders(firebaseUser);

  if (!syncToken && !firebaseUser) {
    return [];
  }

  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/channels`,
    {
      headers: {
        ...authHeaders,
        "x-aotesys-workspace-token": syncToken
      }
    }
  );

  if (!response.ok) {
    throw new Error("Firebase channels request failed.");
  }

  const result = await response.json();

  return normalizeChannels(
    Array.isArray(result.channels) ? result.channels : []
  );
}

async function fetchPublicChatChannel(workspaceSlug, channelId, conversationId = "") {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";
  const response = await fetch(
    `/api/public/workspaces/${encodeURIComponent(
      workspaceSlug
    )}/channels/${encodeURIComponent(channelId)}${query}`
  );

  if (!response.ok) {
    const error = await getApiError(response, "Public chat channel failed.");
    throw error;
  }

  const result = await response.json();

  return {
    workspace: result.workspace,
    channel: normalizeChannels([result.channel])[0]
  };
}

async function sendPublicChatMessage(
  workspaceSlug,
  channelId,
  conversationId,
  message
) {
  const response = await fetch(
    `/api/public/workspaces/${encodeURIComponent(
      workspaceSlug
    )}/channels/${encodeURIComponent(channelId)}/conversations/${encodeURIComponent(
      conversationId
    )}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    }
  );

  if (!response.ok) {
    const error = await getApiError(response, "Public chat message failed.");
    throw error;
  }

  const result = await response.json();

  return {
    workspace: result.workspace,
    channel: normalizeChannels([result.channel])[0]
  };
}

function mergeWorkspaces(localWorkspaces, cloudWorkspaces) {
  const workspaceMap = new Map();

  for (const workspace of [...localWorkspaces, ...cloudWorkspaces]) {
    if (workspace?.slug && workspace?.name) {
      workspaceMap.set(workspace.slug, {
        name: workspace.name,
        slug: workspace.slug,
        createdAt: workspace.createdAt || getNowIso()
      });
    }
  }

  return [...workspaceMap.values()].sort(
    (left, right) =>
      Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")
  );
}

function getPreferredWorkspace(workspaces) {
  const hostSlug = getWorkspaceSlugFromHost();
  const storedSlug = window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY);
  const selectedSlug = hostSlug || storedSlug;

  if (selectedSlug) {
    return workspaces.find((workspace) => workspace.slug === selectedSlug) || null;
  }

  return workspaces[0] || null;
}

function getWorkspaceSyncTokenStorageKey(workspaceSlug) {
  return `${WORKSPACE_SYNC_TOKEN_STORAGE_PREFIX}-${workspaceSlug || "default"}`;
}

function getStoredWorkspaceSyncToken(workspaceSlug) {
  return window.localStorage.getItem(getWorkspaceSyncTokenStorageKey(workspaceSlug));
}

function ensureWorkspaceSyncToken(workspaceSlug) {
  const storageKey = getWorkspaceSyncTokenStorageKey(workspaceSlug);
  const storedToken = window.localStorage.getItem(storageKey);

  if (storedToken) {
    return storedToken;
  }

  const token = generateWorkspaceSyncToken();
  window.localStorage.setItem(storageKey, token);

  return token;
}

function generateWorkspaceSyncToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildFallbackBotReply(text, visitorName, detectedName) {
  const lowerText = text.toLowerCase();

  if (!visitorName || visitorName === "Visitor") {
    if (detectedName) {
      return `Nice to meet you, ${detectedName}. What would you like help with today?`;
    }

    return "Thanks. Before we continue, what should I call you?";
  }

  if (hasContactDetail(text)) {
    return "Thanks, I have your contact detail. The Sale Manager can follow up with you.";
  }

  if (!isLikelyBusinessRelated(lowerText)) {
    return OFF_TOPIC_REPLY;
  }

  return UNSURE_MANAGER_REPLY;
}

function isLikelyBusinessRelated(lowerText) {
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
    "business",
    "sale",
    "manager",
    "buy",
    "order"
  ].some((term) => lowerText.includes(term));
}

function hasContactDetail(text) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s().-]{6,}/.test(text);
}

function isManagerHandoffReply(text) {
  return /unsure at the moment|preferred contact|sale manager/i.test(text);
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [workspaces, setWorkspaces] = useState(() => {
    const storedWorkspaces = getStoredWorkspaces();
    const initialWorkspace = getInitialWorkspace();

    if (
      initialWorkspace &&
      !storedWorkspaces.some(
        (workspace) => workspace.slug === initialWorkspace.slug
      )
    ) {
      return [...storedWorkspaces, initialWorkspace];
    }

    return storedWorkspaces;
  });
  const [activeWorkspace, setActiveWorkspace] = useState(getInitialWorkspace);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const workspace = getInitialWorkspace();

    return Boolean(
      workspace &&
        (window.localStorage.getItem(getWorkspaceAuthStorageKey(workspace.slug)) ===
          "mock" ||
          window.localStorage.getItem(getWorkspaceAuthStorageKey(workspace.slug)) ===
            "firebase" ||
          window.localStorage.getItem(LEGACY_AUTH_STORAGE_KEY) === "mock")
    );
  });
  const [profile, setProfile] = useState({
    email: "owner@example.com",
    businessName: getInitialWorkspace()?.name || ""
  });
  const [channels, setChannels] = useState(() =>
    getInitialChannels(getInitialWorkspace()?.slug)
  );
  const [selectedChannelId, setSelectedChannelId] = useState("channel-a");
  const [selectedConversationId, setSelectedConversationId] =
    useState("maria-lee");
  const [activeTab, setActiveTab] = useState("conversations");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [draftReply, setDraftReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [isKnowledgeUpdating, setIsKnowledgeUpdating] = useState(false);
  const [knowledgeAuditStatus, setKnowledgeAuditStatus] = useState("");
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId),
    [channels, selectedChannelId]
  );

  const visibleConversations = useMemo(
    () => getSortedVisibleConversations(selectedChannel),
    [selectedChannel]
  );

  const selectedConversation = useMemo(
    () =>
      visibleConversations.find(
        (conversation) => conversation.id === selectedConversationId
      ) || visibleConversations[0],
    [selectedConversationId, visibleConversations]
  );

  const pendingKnowledgeCount = useMemo(
    () => getPendingKnowledgeConversations(selectedChannel).length,
    [selectedChannel]
  );

  const shareLink = activeWorkspace
    ? getWorkspaceShareLink(activeWorkspace.slug, selectedChannelId)
    : `${window.location.origin}/chat/${selectedChannelId}`;
  const publicWorkspaceSlug =
    route.name === "public-chat"
      ? route.workspaceSlug || getWorkspaceSlugFromHost()
      : "";

  useEffect(() => {
    const handlePopState = () => setRoute(getRoute());
    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    updateDocumentMetadata(route.name);
  }, [route.name]);

  useEffect(() => {
    let isCancelled = false;

    const loadPublicChat = async () => {
      if (route.name !== "public-chat" || !publicWorkspaceSlug || !route.channelId) {
        return;
      }

      try {
        const result = await fetchPublicChatChannel(
          publicWorkspaceSlug,
          route.channelId
        );

        if (isCancelled) {
          return;
        }

        setActiveWorkspace(result.workspace);
        setWorkspaces((current) => mergeWorkspaces(current, [result.workspace]));
        setChannels((current) => {
          const withoutChannel = current.filter(
            (channel) => channel.id !== result.channel.id
          );

          return [...withoutChannel, result.channel];
        });
      } catch {
        if (!isCancelled) {
          setActiveWorkspace({
            name: titleFromSlug(publicWorkspaceSlug),
            slug: publicWorkspaceSlug,
            createdAt: getNowIso()
          });
        }
      }
    };

    void loadPublicChat();

    return () => {
      isCancelled = true;
    };
  }, [route.name, route.channelId, publicWorkspaceSlug]);

  useEffect(() => {
    void initializeFirebaseAnalytics();
  }, []);

  useEffect(() => {
    return subscribeToFirebaseAuth((user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);

      if (user) {
        setProfile((currentProfile) => ({
          ...currentProfile,
          email: user.email || currentProfile.email
        }));
      } else {
        setIsAuthenticated(false);
        setIsCloudReady(false);
      }
    });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const hydrateFromFirebase = async () => {
      try {
        if (!firebaseUser) {
          setIsCloudReady(false);
          return;
        }

        const status = await fetchFirebaseStatus();

        if (!status.enabled) {
          return;
        }

        const cloudWorkspaces = await fetchCloudWorkspaces(firebaseUser);

        if (isCancelled) {
          return;
        }

        const mergedWorkspaces = mergeWorkspaces([], cloudWorkspaces);
        const preferredWorkspace = getPreferredWorkspace(mergedWorkspaces);

        setWorkspaces(mergedWorkspaces);

        if (preferredWorkspace) {
          setActiveWorkspace(preferredWorkspace);
          setProfile((currentProfile) => ({
            ...currentProfile,
            businessName: preferredWorkspace.name
          }));
          window.localStorage.setItem(
            CURRENT_WORKSPACE_STORAGE_KEY,
            preferredWorkspace.slug
          );
        }

        if (preferredWorkspace) {
          const cloudChannels = await fetchCloudChannels(
            preferredWorkspace.slug,
            firebaseUser
          );

          if (!isCancelled && cloudChannels.length > 0) {
            setChannels(ensureOwnerSetupChannels(cloudChannels));
          }

          if (!isCancelled) {
            setIsAuthenticated(true);
          }
        } else if (!isCancelled) {
          setActiveWorkspace(null);
          setChannels(normalizeChannels(initialChannels));
          setSelectedChannelId("channel-a");
          setSelectedConversationId("maria-lee");
          setIsAuthenticated(true);
        }

        if (!isCancelled) {
          setIsCloudReady(true);
        }
      } catch {
        if (!isCancelled) {
          setIsCloudReady(false);
        }
      }
    };

    void hydrateFromFirebase();

    return () => {
      isCancelled = true;
    };
  }, [firebaseUser, route.name]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    if (activeWorkspace) {
      window.localStorage.setItem(
        CURRENT_WORKSPACE_STORAGE_KEY,
        activeWorkspace.slug
      );
      window.localStorage.setItem(
        getWorkspaceChannelsStorageKey(activeWorkspace.slug),
        JSON.stringify(channels)
      );

      if (isCloudReady && firebaseUser) {
        void saveCloudWorkspace(activeWorkspace, channels, firebaseUser).catch(
          () => {}
        );
      }
    }
  }, [activeWorkspace, channels, isCloudReady, firebaseUser]);

  useEffect(() => {
    setKnowledgeAuditStatus("");
  }, [selectedChannelId]);

  useEffect(() => {
    if (
      !selectedChannel ||
      !selectedChannel.autoKnowledgeEnabled ||
      !selectedChannel.receptionistLearningEnabled
    ) {
      return;
    }

    const hasOwnerSetup = selectedChannel.conversations.some(
      (conversation) => conversation.receptionistLearning?.type === "owner-setup"
    );

    if (hasOwnerSetup) {
      return;
    }

    const setupConversation = buildOwnerSetupConversation(
      selectedChannel.id,
      selectedChannel.name
    );

    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== selectedChannel.id) {
          return channel;
        }

        if (
          channel.conversations.some(
            (conversation) =>
              conversation.receptionistLearning?.type === "owner-setup"
          )
        ) {
          return channel;
        }

        return {
          ...channel,
          conversations: [setupConversation, ...channel.conversations]
        };
      })
    );
    setSelectedConversationId(setupConversation.id);
  }, [
    selectedChannel?.id,
    selectedChannel?.autoKnowledgeEnabled,
    selectedChannel?.receptionistLearningEnabled
  ]);

  const navigate = (nextRoute) => {
    const path = getPageMetadataByName(nextRoute)?.path || "/login";
    window.history.pushState(null, "", path);
    setRoute({ name: nextRoute });
  };

  const selectWorkspace = (workspace, nextChannels) => {
    const workspaceChannels = ensureOwnerSetupChannels(
      nextChannels || getInitialChannels(workspace.slug)
    );

    setActiveWorkspace(workspace);
    setProfile((current) => ({
      ...current,
      businessName: workspace.name
    }));
    setChannels(workspaceChannels);
    setSelectedChannelId("channel-a");
    setSelectedConversationId(workspaceChannels[0]?.conversations[0]?.id || "");
    window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspace.slug);
  };

  const createWorkspace = async (workspaceName) => {
    const slug = slugifyWorkspaceName(workspaceName);

    if (!slug) {
      return {
        ok: false,
        message: "Add a workspace name to continue."
      };
    }

    const user = firebaseUser || (await signInWithGoogle());
    const workspace = {
      name: workspaceName.trim(),
      slug,
      createdAt: getNowIso()
    };
    const workspaceChannels = normalizeChannels(initialChannels);

    await createCloudWorkspace(workspace, workspaceChannels, user);

    setWorkspaces((current) => {
      const withoutDuplicate = current.filter((item) => item.slug !== slug);
      return [...withoutDuplicate, workspace];
    });
    selectWorkspace(workspace, workspaceChannels);
    window.localStorage.setItem(
      getWorkspaceChannelsStorageKey(slug),
      JSON.stringify(workspaceChannels)
    );
    window.localStorage.setItem(getWorkspaceAuthStorageKey(slug), "firebase");
    setFirebaseUser(user);
    setIsAuthenticated(true);
    setRoute({ name: "login" });
    window.history.pushState(null, "", "/login");

    return {
      ok: true,
      workspace
    };
  };

  const loginWithGoogleWorkspace = async () => {
    const user = firebaseUser || (await signInWithGoogle());
    const cloudWorkspaces = await fetchCloudWorkspaces(user).catch(() => []);
    const mergedWorkspaces = mergeWorkspaces(getStoredWorkspaces(), cloudWorkspaces);
    const workspace = getPreferredWorkspace(mergedWorkspaces);

    if (!workspace) {
      setFirebaseUser(user);
      setWorkspaces([]);
      setActiveWorkspace(null);
      setChannels(normalizeChannels(initialChannels));
      setSelectedChannelId("channel-a");
      setSelectedConversationId("maria-lee");
      setIsAuthenticated(true);
      setRoute({ name: "login" });
      window.history.pushState(null, "", "/login");

      return {
        ok: true,
        workspace: null
      };
    }

    const cloudChannels = await fetchCloudChannels(workspace.slug, user).catch(
      () => []
    );

    setWorkspaces(mergedWorkspaces);
    selectWorkspace(
      workspace,
      cloudChannels.length > 0 ? cloudChannels : getInitialChannels(workspace.slug)
    );
    window.localStorage.setItem(
      getWorkspaceAuthStorageKey(workspace.slug),
      "firebase"
    );
    setFirebaseUser(user);
    setIsAuthenticated(true);
    setRoute({ name: "login" });
    window.history.pushState(null, "", "/login");

    return {
      ok: true,
      workspace
    };
  };

  const logout = async () => {
    if (activeWorkspace) {
      window.localStorage.removeItem(
        getWorkspaceAuthStorageKey(activeWorkspace.slug)
      );
    }
    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    await signOutFromFirebase().catch(() => {});
    setFirebaseUser(null);
    setIsAuthenticated(false);
  };

  const createChannel = () => {
    const channelNumber = channels.length + 1;
    const id = `channel-${channelNumber}`;
    const nextChannel = {
      id,
      name: `Channel ${String.fromCharCode(64 + channelNumber)}`,
      promptUpdatedAt: getTodayDate(),
      prompt:
        "Introduce yourself, collect the visitor name, answer sales questions, and alert the owner if the visitor is ready to buy.",
      autoKnowledgeEnabled: false,
      receptionistLearningEnabled: true,
      autoKnowledgePrompt: "",
      autoKnowledgeUpdatedAt: "",
      autoKnowledgeLastRunAt: "",
      conversations: [buildOwnerSetupConversation(id, `Channel ${String.fromCharCode(64 + channelNumber)}`)]
    };

    setChannels((current) => [...current, nextChannel]);
    setSelectedChannelId(nextChannel.id);
    setSelectedConversationId(nextChannel.conversations[0].id);
    setActiveTab("conversations");
  };

  const updatePrompt = (prompt) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === selectedChannelId ? { ...channel, prompt } : channel
      )
    );
  };

  const updatePromptUpdatedAt = (promptUpdatedAt) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === selectedChannelId
          ? { ...channel, promptUpdatedAt }
          : channel
      )
    );
  };

  const updateAutoKnowledgeEnabled = (autoKnowledgeEnabled) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === selectedChannelId
          ? { ...channel, autoKnowledgeEnabled }
          : channel
      )
    );
  };

  const updateReceptionistLearningEnabled = (receptionistLearningEnabled) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === selectedChannelId
          ? {
              ...channel,
              receptionistLearningEnabled,
              autoKnowledgeEnabled: receptionistLearningEnabled
                ? true
                : channel.autoKnowledgeEnabled
            }
          : channel
      )
    );
  };

  const updateAutoKnowledgePrompt = (autoKnowledgePrompt) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === selectedChannelId
          ? { ...channel, autoKnowledgePrompt }
          : channel
      )
    );
  };

  const auditAutoKnowledge = async () => {
    if (!selectedChannel || isKnowledgeUpdating) {
      return;
    }

    const pendingConversations =
      getPendingKnowledgeConversations(selectedChannel);

    if (pendingConversations.length === 0) {
      setKnowledgeAuditStatus("No new conversations to audit.");
      return;
    }

    setIsKnowledgeUpdating(true);
    setKnowledgeAuditStatus(
      `Auditing ${getPluralLabel(pendingConversations.length, "conversation")}...`
    );

    try {
      const response = await fetch("/api/auto-knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channelId: selectedChannel.id,
          channelName: selectedChannel.name,
          botPrompt: selectedChannel.prompt,
          autoKnowledgePrompt: selectedChannel.autoKnowledgePrompt,
          conversations: pendingConversations.map(toKnowledgeConversationPayload)
        })
      });

      if (!response.ok) {
        throw new Error("Auto knowledge update failed.");
      }

      const result = await response.json();
      const now = getNowIso();
      const fallbackAuditedIds = pendingConversations.map(
        (conversation) => conversation.id
      );
      const auditedIds = new Set(
        Array.isArray(result.auditedConversationIds) &&
          result.auditedConversationIds.length > 0
          ? result.auditedConversationIds
          : fallbackAuditedIds
      );
      const nextKnowledgePrompt =
        typeof result.autoKnowledgePrompt === "string"
          ? result.autoKnowledgePrompt.trim()
          : selectedChannel.autoKnowledgePrompt;

      setChannels((current) =>
        current.map((channel) => {
          if (channel.id !== selectedChannel.id) {
            return channel;
          }

          return {
            ...channel,
            autoKnowledgePrompt: nextKnowledgePrompt,
            autoKnowledgeUpdatedAt: now,
            autoKnowledgeLastRunAt: now,
            conversations: channel.conversations.map((conversation) =>
              auditedIds.has(conversation.id)
                ? {
                    ...conversation,
                    autoKnowledgeAuditedAt: now
                  }
                : conversation
            )
          };
        })
      );
      setKnowledgeAuditStatus(
        result.summary ||
          `Updated ${getPluralLabel(auditedIds.size, "conversation")}.`
      );
    } catch {
      setKnowledgeAuditStatus(
        "Auto knowledge update failed. Check Ollama settings and try again."
      );
    } finally {
      setIsKnowledgeUpdating(false);
    }
  };

  const sendOwnerReply = () => {
    if (!draftReply.trim() || !selectedConversation) {
      return;
    }

    const ownerAnswer = draftReply.trim();
    const learningRequest = selectedConversation.receptionistLearning;

    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== selectedChannelId) {
          return channel;
        }

        if (learningRequest?.type === "owner-setup") {
          const now = getNowIso();
          const learnedFact = `Owner-approved setup knowledge or Q&A:\n${ownerAnswer}`;
          const nextKnowledge = appendLearnedKnowledge(
            channel.autoKnowledgePrompt,
            learnedFact
          );
          const learnedCount =
            selectedConversation.messages.filter(
              (message) => message.role === "owner"
            ).length + 1;

          return {
            ...channel,
            autoKnowledgeEnabled: true,
            receptionistLearningEnabled: true,
            autoKnowledgePrompt: nextKnowledge,
            autoKnowledgeUpdatedAt: now,
            conversations: channel.conversations.map((conversation) =>
              conversation.id === selectedConversation.id
                ? {
                    ...conversation,
                    status: "Learning",
                    lastSeen: "Just now",
                    lastActivityAt: now,
                    autoKnowledgeAuditedAt: now,
                    archived: false,
                    messages: [
                      ...conversation.messages,
                      {
                        id: conversation.messages.length + 1,
                        role: "owner",
                        text: ownerAnswer
                      },
                      {
                        id: conversation.messages.length + 2,
                        role: "bot",
                        text: buildOwnerSetupFollowUp(ownerAnswer, learnedCount)
                      }
                    ]
                  }
                : conversation
            )
          };
        }

        if (learningRequest?.customerConversationId) {
          const now = getNowIso();
          const customerReply = buildReceptionistCustomerReply(ownerAnswer);
          const learnedFact = buildReceptionistLearnedFact(
            learningRequest.customerQuestion,
            ownerAnswer
          );
          const nextKnowledge = appendLearnedKnowledge(
            channel.autoKnowledgePrompt,
            learnedFact
          );

          return {
            ...channel,
            autoKnowledgeEnabled: true,
            autoKnowledgePrompt: nextKnowledge,
            autoKnowledgeUpdatedAt: now,
            conversations: channel.conversations.map((conversation) => {
              if (conversation.id === selectedConversation.id) {
                return {
                  ...conversation,
                  status: "Learned",
                  lastSeen: "Just now",
                  lastActivityAt: now,
                  autoKnowledgeAuditedAt: now,
                  archived: false,
                  messages: [
                    ...conversation.messages,
                    {
                      id: conversation.messages.length + 1,
                      role: "owner",
                      text: ownerAnswer
                    },
                    {
                      id: conversation.messages.length + 2,
                      role: "bot",
                      text:
                        "Got it. I learned this and prepared a customer-friendly reply."
                    }
                  ]
                };
              }

              if (conversation.id === learningRequest.customerConversationId) {
                return {
                  ...conversation,
                  status: "Bot active",
                  lastSeen: "Just now",
                  lastActivityAt: now,
                  autoKnowledgeAuditedAt: "",
                  messages: [
                    ...conversation.messages,
                    {
                      id: conversation.messages.length + 1,
                      role: "bot",
                      text: customerReply
                    }
                  ]
                };
              }

              return conversation;
            })
          };
        }

        return {
          ...channel,
          conversations: channel.conversations.map((conversation) => {
            if (conversation.id !== selectedConversation.id) {
              return conversation;
            }

            return {
              ...conversation,
              status: "Owner joined",
              lastSeen: "Just now",
              lastActivityAt: getNowIso(),
              autoKnowledgeAuditedAt: "",
              archived: false,
              messages: [
                ...conversation.messages,
                {
                  id: conversation.messages.length + 1,
                  role: "owner",
                  text: ownerAnswer
                }
              ]
            };
          })
        };
      })
    );
    setDraftReply("");
  };

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const selectChannel = (id) => {
    const nextChannel = channels.find((channel) => channel.id === id);
    const nextConversations = getSortedVisibleConversations(nextChannel);

    setSelectedChannelId(id);
    setSelectedConversationId(nextConversations[0]?.id ?? "");
    setActiveTab("conversations");
  };

  const archiveConversation = (channelId, conversationId) => {
    let nextSelectedConversationId = "";

    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) {
          return channel;
        }

        const conversations = channel.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                archived: true,
                status: "Archived",
                lastActivityAt: getNowIso()
              }
            : conversation
        );
        nextSelectedConversationId =
          getSortedVisibleConversations({ ...channel, conversations })[0]?.id ||
          "";

        return {
          ...channel,
          conversations
        };
      })
    );
    setSelectedConversationId(nextSelectedConversationId);
  };

  const ensureVisitorConversation = (channelId, conversationId) => {
    setChannels((current) =>
      current.map((channel) => {
        if (
          channel.id !== channelId ||
          channel.conversations.some(
            (conversation) => conversation.id === conversationId
          )
        ) {
          return channel;
        }

        return {
          ...channel,
          conversations: [
            ...channel.conversations,
            {
              id: conversationId,
              visitorName: "Visitor",
              status: "Bot active",
              lastSeen: "Just now",
              lastActivityAt: getNowIso(),
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
            }
          ]
        };
      })
    );
  };

  const appendBotMessage = (channelId, conversationId, text, status) => {
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) {
          return channel;
        }

        return {
          ...channel,
          conversations: channel.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            return {
              ...conversation,
              status,
              lastSeen: "Just now",
              lastActivityAt: getNowIso(),
              autoKnowledgeAuditedAt: "",
              messages: [
                ...conversation.messages,
                {
                  id: conversation.messages.length + 1,
                  role: "bot",
                  text
                }
              ]
            };
          })
        };
      })
    );
  };

  const sendVisitorMessage = async (channelId, conversationId, text) => {
    const messageText = text.trim();

    if (!messageText) {
      return;
    }

    if (route.name === "public-chat" && publicWorkspaceSlug) {
      const result = await sendPublicChatMessage(
        publicWorkspaceSlug,
        channelId,
        conversationId,
        messageText
      );

      setActiveWorkspace(result.workspace);
      setChannels((current) => {
        const withoutChannel = current.filter(
          (channel) => channel.id !== result.channel.id
        );

        return [...withoutChannel, result.channel];
      });
      return;
    }

    let botContext;

    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) {
          return channel;
        }

        return {
          ...channel,
          conversations: channel.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const detectedName = detectVisitorName(messageText);
            const visitorName =
              conversation.visitorName === "Visitor" && detectedName
                ? detectedName
                : conversation.visitorName;
            const nextConversation = {
              ...conversation,
              visitorName,
              status: "Bot typing",
              lastSeen: "Just now",
              lastActivityAt: getNowIso(),
              autoKnowledgeAuditedAt: "",
              archived: false,
              messages: [
                ...conversation.messages,
                {
                  id: conversation.messages.length + 1,
                  role: "visitor",
                  text: messageText
                }
              ]
            };

            botContext = {
              channel,
              conversation: nextConversation,
              fallbackReply: buildFallbackBotReply(
                messageText,
                conversation.visitorName,
                detectedName
              )
            };

            return nextConversation;
          })
        };
      })
    );

    if (!botContext) {
      return;
    }

    try {
      const botReply = await requestBotReply(
        botContext.channel,
        botContext.conversation,
        messageText
      );
      appendBotMessage(
        channelId,
        conversationId,
        botReply.reply,
        botReply.needsManager ? "Needs manager" : "Bot active"
      );
    } catch {
      appendBotMessage(
        channelId,
        conversationId,
        botContext.fallbackReply,
        isManagerHandoffReply(botContext.fallbackReply)
          ? "Needs manager"
          : "Bot fallback"
      );
    }
  };

  const refreshPublicConversation = async (channelId, conversationId) => {
    if (route.name !== "public-chat" || !publicWorkspaceSlug) {
      return;
    }

    const result = await fetchPublicChatChannel(
      publicWorkspaceSlug,
      channelId,
      conversationId
    );

    setActiveWorkspace(result.workspace);
    setChannels((current) => {
      const withoutChannel = current.filter(
        (channel) => channel.id !== result.channel.id
      );

      return [...withoutChannel, result.channel];
    });
  };

  if (route.name === "public-chat") {
    const publicChannel = channels.find(
      (channel) => channel.id === route.channelId
    );

    return (
      <PublicChatPage
        channel={publicChannel}
        channelId={route.channelId}
        workspaceSlug={publicWorkspaceSlug}
        workspace={activeWorkspace}
        onNavigate={navigate}
        onEnsureConversation={ensureVisitorConversation}
        onSendVisitorMessage={sendVisitorMessage}
        onRefreshConversation={refreshPublicConversation}
      />
    );
  }

  if (route.name === "home") {
    return <HomePage onNavigate={navigate} />;
  }

  if (MARKETING_ROUTE_NAMES.has(route.name)) {
    return <MarketingPage routeName={route.name} onNavigate={navigate} />;
  }

  if (route.name === "signup" && !firebaseUser) {
    return (
      <SignupPage
        isAuthReady={isAuthReady}
        onNavigate={navigate}
        onCreateWorkspace={createWorkspace}
      />
    );
  }

  if (route.name === "not-found") {
    return <NotFoundPage onNavigate={navigate} />;
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        isAuthReady={isAuthReady}
        onNavigate={navigate}
        onLogin={loginWithGoogleWorkspace}
      />
    );
  }

  if (isAuthenticated && !activeWorkspace) {
    return (
      <WorkspaceOnboardingPage
        userEmail={firebaseUser?.email || profile.email}
        onCreateWorkspace={createWorkspace}
        onNavigate={navigate}
        onSignOut={logout}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className={isSidebarOpen ? "sidebar" : "sidebar collapsed"}>
        <div className="sidebar-top">
          <button
            className="icon-button"
            onClick={() => navigate("home")}
            title="Home"
            aria-label="Home"
          >
            <Home size={20} />
          </button>
          {isSidebarOpen && (
            <strong>{activeWorkspace?.name || APP_NAME}</strong>
          )}
          <button
            className="icon-button edge"
            onClick={() => setIsSidebarOpen((open) => !open)}
            title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          <button
            className={activeTab === "profile" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("profile")}
            title="Profile"
          >
            <UserRound size={20} />
            {isSidebarOpen && <span>Profile</span>}
          </button>
          <div
            className={
              activeTab === "conversations"
                ? "conversation-nav-section active"
                : "conversation-nav-section"
            }
          >
            <div className="conversation-nav-row">
              <button
                className={
                  activeTab === "conversations" ? "nav-item active" : "nav-item"
                }
                onClick={() => setActiveTab("conversations")}
                title="Conversations"
              >
                <MessagesSquare size={20} />
                {isSidebarOpen && <span>Conversations</span>}
              </button>
              {isSidebarOpen && (
                <button
                  className="sidebar-add-button"
                  onClick={createChannel}
                  title="Create channel"
                  aria-label="Create channel"
                >
                  <Plus size={18} />
                </button>
              )}
            </div>

            {isSidebarOpen && activeTab === "conversations" && (
              <div className="sidebar-channel-list">
                {channels.map((channel) => (
                  <button
                    key={channel.id}
                    className={
                      channel.id === selectedChannelId
                        ? "sidebar-channel-button active"
                        : "sidebar-channel-button"
                    }
                    onClick={() => selectChannel(channel.id)}
                  >
                    <MessageCircle size={16} />
                    <span>{channel.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <button className="logout-button" onClick={logout} title="Sign out">
          <LogIn size={18} />
          {isSidebarOpen && <span>Sign out</span>}
        </button>
      </aside>

      <main className="workspace">
        {activeTab === "profile" ? (
          <ProfilePanel profile={profile} setProfile={setProfile} />
        ) : (
          <ConversationPanel
            selectedChannel={selectedChannel}
            selectedConversation={selectedConversation}
            conversations={visibleConversations}
            shareLink={shareLink}
            copied={copied}
            draftReply={draftReply}
            onConversationChange={setSelectedConversationId}
            onCopyShareLink={copyShareLink}
            onPromptChange={updatePrompt}
            onPromptUpdatedAtChange={updatePromptUpdatedAt}
            onAutoKnowledgeEnabledChange={updateAutoKnowledgeEnabled}
            onReceptionistLearningEnabledChange={
              updateReceptionistLearningEnabled
            }
            onAutoKnowledgePromptChange={updateAutoKnowledgePrompt}
            onUpdateAutoKnowledge={auditAutoKnowledge}
            onDraftReplyChange={setDraftReply}
            onSendOwnerReply={sendOwnerReply}
            onArchiveConversation={() =>
              selectedChannel &&
              selectedConversation &&
              archiveConversation(selectedChannel.id, selectedConversation.id)
            }
            pendingKnowledgeCount={pendingKnowledgeCount}
            isKnowledgeUpdating={isKnowledgeUpdating}
            knowledgeAuditStatus={knowledgeAuditStatus}
          />
        )}
      </main>
    </div>
  );
}

const homeStats = [
  { value: "1", label: "workspace per business" },
  { value: "24/7", label: "first-response coverage" },
  { value: "0", label: "guessed business facts" }
];

const featureCards = [
  {
    icon: MessagesSquare,
    title: "Website inquiry channels",
    text:
      "Create separate AI chat channels for products, services, campaigns, or locations. Each channel keeps its own prompt, share link, and visitor conversations."
  },
  {
    icon: ShieldCheck,
    title: "Approved knowledge only",
    text:
      "The assistant is designed to answer from approved prompts and learned owner facts, then hand off when the answer is not known."
  },
  {
    icon: UserRound,
    title: "Owner handoff",
    text:
      "When a visitor is ready to buy or asks something uncertain, Aotesys collects contact details and keeps the conversation ready for the manager."
  },
  {
    icon: Workflow,
    title: "Workspace subdomains",
    text:
      "Business chat links stay organized under workspace subdomains such as online2book.aotesys.com, so customer entry points are easy to share."
  },
  {
    icon: Brain,
    title: "Auto Knowledges Learning",
    text:
      "New conversation evidence can be reviewed and converted into safer channel knowledge, helping the assistant improve without inventing claims."
  },
  {
    icon: BadgeCheck,
    title: "Sales-ready context",
    text:
      "Visitor names, timestamps, message history, and conversation status are kept in one dashboard so follow-up starts with context instead of guesswork."
  }
];

const operatingPrinciples = [
  "Ask for the visitor name before deeper selling.",
  "Answer only from approved business facts.",
  "Hand off questions that need human judgement.",
  "Keep every conversation visible to the business owner.",
  "Make public chat links easy to copy, share, and trace."
];

const useCases = [
  {
    title: "Service businesses",
    text:
      "Use Aotesys to answer package, booking, location, and service-fit questions before a visitor leaves the website."
  },
  {
    title: "Product sellers",
    text:
      "Collect buyer intent, product questions, delivery concerns, and quote requests in a channel the owner can review."
  },
  {
    title: "New websites",
    text:
      "Launch with clear sales support, contact capture, and a simple path from curiosity to a managed conversation."
  }
];

const guideSections = [
  {
    title: "Start with the problem, not the bot",
    paragraphs: [
      "Most small business websites lose visitors because the visitor has one practical question and cannot find a quick answer. The question might be about pricing, availability, booking steps, delivery, support, or whether the service is suitable for a specific situation. Aotesys is built around that moment. The assistant should reduce friction for the visitor while protecting the business from made-up answers.",
      "That means the goal is not to make the bot sound clever. The goal is to keep the first conversation moving. The assistant should greet the visitor, ask for a name, answer from approved facts when possible, and ask for contact details when a human reply is needed."
    ]
  },
  {
    title: "Separate approved facts from open questions",
    paragraphs: [
      "A useful sales assistant needs a clear boundary between what the business has approved and what the visitor is asking. If a channel prompt says delivery takes three days, the assistant can use that. If a visitor asks about a custom discount that has never been approved, the assistant should not guess.",
      "This is why Aotesys includes channel prompts and Auto Knowledges Learning. The business can review real conversations, identify repeat questions, and turn reliable owner answers into future knowledge. The assistant improves, but the source of truth stays visible."
    ]
  },
  {
    title: "Design the handoff before the first lead arrives",
    paragraphs: [
      "A handoff is not a failure. In sales support, it is often the highest-value moment. The assistant should know when to stop answering and collect the detail a manager needs to follow up. A clear handoff message is better than a confident wrong answer.",
      "The best workflow is simple: identify the visitor, understand the question, answer when the approved information is enough, and collect an email or phone number when the visitor needs a human response. The owner dashboard should preserve the full conversation so the next reply feels personal."
    ]
  },
  {
    title: "Measure trust, not just automation",
    paragraphs: [
      "Good automation earns trust by staying consistent. For a website, that means the assistant should be available, focused on the business, and honest when it is unsure. It should not drift into unrelated topics or invent policies, prices, stock levels, or guarantees.",
      "Aotesys keeps that trust visible through channel settings, prompt dates, archived conversations, and owner replies. The result is a practical system for sales conversations, not a black box that quietly changes what the business says."
    ]
  }
];

function RouteLink({ route, className, children, onNavigate, title }) {
  const metadata = getPageMetadataByName(route);

  return (
    <a
      className={className}
      href={metadata.path}
      title={title}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        onNavigate(route);
      }}
    >
      {children}
    </a>
  );
}

function MarketingHeader({ onNavigate }) {
  return (
    <header className="topbar marketing-topbar">
      <RouteLink route="home" className="brand-button" onNavigate={onNavigate}>
        <Bot size={22} />
        <span>{APP_NAME}</span>
      </RouteLink>
      <nav className="marketing-nav" aria-label="Public pages">
        {MARKETING_NAV.map((item) => (
          <RouteLink key={item.route} route={item.route} onNavigate={onNavigate}>
            {item.label}
          </RouteLink>
        ))}
      </nav>
      <div className="topbar-actions">
        <RouteLink route="login" className="secondary-button" onNavigate={onNavigate}>
          <LogIn size={18} />
          <span>Login</span>
        </RouteLink>
        <RouteLink route="signup" className="primary-button" onNavigate={onNavigate}>
          <UserPlus size={18} />
          <span>Sign up</span>
        </RouteLink>
      </div>
    </header>
  );
}

function MarketingFooter({ onNavigate }) {
  return (
    <footer className="marketing-footer">
      <div>
        <strong>{APP_NAME}</strong>
        <p>
          AI sales assistant workspaces, written and maintained by {AUTHOR_NAME}.
        </p>
      </div>
      <nav aria-label="Footer">
        {FOOTER_LINKS.map((item) => (
          <RouteLink key={item.route} route={item.route} onNavigate={onNavigate}>
            {item.label}
          </RouteLink>
        ))}
      </nav>
    </footer>
  );
}

function HomePage({ onNavigate }) {
  const [landingMessages, setLandingMessages] = useState([
    {
      role: "bot",
      text:
        "Hi, I am the Aotesys sales bot. Ask what this platform can do for a business website."
    }
  ]);
  const [landingDraft, setLandingDraft] = useState("");

  const sendLandingMessage = () => {
    const message = landingDraft.trim();

    if (!message) {
      return;
    }

    const lowerMessage = message.toLowerCase();
    let reply =
      "Aotesys gives each business a workspace, shareable AI chat channels, owner handoff, and learned business knowledge for sales support.";

    if (lowerMessage.includes("signup") || lowerMessage.includes("start")) {
      reply =
        "Create a workspace with your business name, then your workspace is available as a subdomain like online2book.aotesys.com.";
    } else if (
      lowerMessage.includes("share") ||
      lowerMessage.includes("link") ||
      lowerMessage.includes("subdomain")
    ) {
      reply =
        "Every workspace creates share links from its own subdomain, so customer chats stay tied to that business.";
    } else if (lowerMessage.includes("login")) {
      reply =
        "After signup, use Login and enter your workspace name to open the owner dashboard.";
    }

    setLandingMessages((current) => [
      ...current,
      { role: "visitor", text: message },
      { role: "bot", text: reply }
    ]);
    setLandingDraft("");
  };

  return (
    <div className="home-page marketing-page">
      <MarketingHeader onNavigate={onNavigate} />

      <section className="home-hero">
        <p className="eyebrow">AI sales assistant workspaces</p>
        <h1>{APP_NAME}</h1>
        <p>
          Aotesys helps small businesses turn website questions into organized
          sales conversations. Each business gets a workspace, shareable AI chat
          channels, owner replies, and approved knowledge the assistant can use
          without drifting into guesses.
        </p>
        <div className="hero-actions">
          <RouteLink route="signup" className="primary-button" onNavigate={onNavigate}>
            <UserPlus size={19} />
            <span>Create workspace</span>
          </RouteLink>
          <RouteLink route="features" className="secondary-button hero-secondary" onNavigate={onNavigate}>
            <Sparkles size={18} />
            <span>Explore features</span>
          </RouteLink>
          <RouteLink route="login" className="secondary-button hero-secondary" onNavigate={onNavigate}>
            <LogIn size={18} />
            <span>Workspace login</span>
          </RouteLink>
        </div>
        <div className="hero-stat-row" aria-label="Aotesys product facts">
          {homeStats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-chat-section" aria-label="AI inquiry preview">
        <div className="landing-copy">
          <p className="eyebrow">Visitor inquiry</p>
          <h2>Answer useful questions, then hand off the rest</h2>
          <p>
            Aotesys is made for the practical questions that arrive before a
            customer buys: pricing, availability, packages, booking steps, and
            service fit. The assistant can respond from approved business facts.
            When the answer is missing, it asks for contact details so the sales
            manager can reply from the workspace.
          </p>
          <ul className="check-list">
            {operatingPrinciples.slice(0, 3).map((item) => (
              <li key={item}>
                <Check size={18} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="landing-chat-preview">
          <div className="chat-header">
            <div>
              <p className="eyebrow">aotesys.com</p>
              <h2>Aotesys AI</h2>
            </div>
            <span className="status-pill">Online</span>
          </div>
          <div className="message-list landing-message-list">
            {landingMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <span>{message.role === "bot" ? "Bot" : "You"}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className="reply-box">
            <input
              value={landingDraft}
              placeholder="Ask about Aotesys..."
              onChange={(event) => setLandingDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendLandingMessage();
                }
              }}
            />
            <button
              className="primary-icon-button"
              onClick={sendLandingMessage}
              title="Send inquiry"
              aria-label="Send inquiry"
            >
              <Send size={19} />
            </button>
          </div>
        </div>
      </section>

      <section className="content-band" aria-labelledby="homepage-features">
        <div className="section-heading compact">
          <p className="eyebrow">What Aotesys does</p>
          <h2 id="homepage-features">A practical sales layer for a business website</h2>
          <p>
            The product is intentionally focused. It does not try to replace a
            sales manager, CRM, or full support desk. It captures the first
            website conversation, keeps approved information close to the bot,
            and gives the owner a clear place to continue the conversation.
          </p>
        </div>
        <div className="feature-grid">
          {featureCards.slice(0, 3).map((feature) => {
            const Icon = feature.icon;

            return (
              <article className="feature-card" key={feature.title}>
                <Icon size={23} />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="content-band two-column-band" aria-labelledby="homepage-author">
        <div>
          <p className="eyebrow">Author and product lead</p>
          <h2 id="homepage-author">Built and written by {AUTHOR_NAME}</h2>
          <p>
            I write Aotesys content from the point of view of a product builder:
            keep the assistant useful, keep the source of truth visible, and keep
            human follow-up close when a visitor is ready to buy. The site now
            includes product, trust, contact, and policy pages so search engines
            and AI answer engines can understand what Aotesys is.
          </p>
        </div>
        <div className="author-panel">
          <BadgeCheck size={24} />
          <strong>{AUTHOR_NAME}</strong>
          <span>{AUTHOR_EMAIL}</span>
          <p>
            Product author for Aotesys AI sales assistant workspaces.
          </p>
        </div>
      </section>

      <MarketingFooter onNavigate={onNavigate} />
    </div>
  );
}

function MarketingPage({ routeName, onNavigate }) {
  if (routeName === "features") {
    return <FeaturesPage onNavigate={onNavigate} />;
  }

  if (routeName === "resources") {
    return <ResourcesPage onNavigate={onNavigate} />;
  }

  if (routeName === "guide") {
    return <GuidePage onNavigate={onNavigate} />;
  }

  if (routeName === "about") {
    return <AboutPage onNavigate={onNavigate} />;
  }

  if (routeName === "contact") {
    return <ContactPage onNavigate={onNavigate} />;
  }

  if (routeName === "privacy") {
    return <PolicyPage routeName="privacy" onNavigate={onNavigate} />;
  }

  return <PolicyPage routeName="terms" onNavigate={onNavigate} />;
}

function MarketingShell({ routeName, eyebrow, title, children, onNavigate }) {
  const metadata = getPageMetadataByName(routeName);

  return (
    <div className="home-page marketing-page">
      <MarketingHeader onNavigate={onNavigate} />
      <main className="marketing-main">
        <section className="page-hero">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title || metadata.navLabel}</h1>
          <p>{metadata.description}</p>
          <div className="byline-row">
            <span>
              <UserRound size={16} />
              {AUTHOR_NAME}
            </span>
            <span>
              <CalendarDays size={16} />
              Updated Jun 29, 2026
            </span>
          </div>
        </section>
        {children}
      </main>
      <MarketingFooter onNavigate={onNavigate} />
    </div>
  );
}

function FeaturesPage({ onNavigate }) {
  return (
    <MarketingShell
      routeName="features"
      eyebrow="Product features"
      title="AI sales support with a human fallback"
      onNavigate={onNavigate}
    >
      <section className="content-band">
        <div className="feature-grid wide">
          {featureCards.map((feature) => {
            const Icon = feature.icon;

            return (
              <article className="feature-card" key={feature.title}>
                <Icon size={23} />
                <h2>{feature.title}</h2>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="content-band two-column-band">
        <div>
          <p className="eyebrow">How the workflow fits together</p>
          <h2>From public question to managed follow-up</h2>
          <p>
            Aotesys starts at the public website chat link. A visitor asks a
            question, the assistant checks whether approved channel knowledge
            contains the answer, and the conversation is saved for the owner.
            If the answer is not available, the assistant collects contact
            details instead of inventing a reply.
          </p>
          <p>
            This keeps the sales motion simple for small businesses. The owner
            can update prompts, review conversation history, archive completed
            leads, and convert reliable owner answers into future assistant
            knowledge.
          </p>
        </div>
        <ol className="process-list">
          <li>
            <span>1</span>
            <p>Create a workspace with the business name.</p>
          </li>
          <li>
            <span>2</span>
            <p>Set the channel prompt and share the public chat link.</p>
          </li>
          <li>
            <span>3</span>
            <p>Let the assistant answer from approved facts.</p>
          </li>
          <li>
            <span>4</span>
            <p>Use owner handoff for uncertain or high-intent questions.</p>
          </li>
        </ol>
      </section>

      <section className="content-band">
        <div className="section-heading compact">
          <p className="eyebrow">Use cases</p>
          <h2>Where Aotesys is useful first</h2>
        </div>
        <div className="feature-grid">
          {useCases.map((item) => (
            <article className="feature-card" key={item.title}>
              <Target size={22} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div>
          <p className="eyebrow">Ready to try it</p>
          <h2>Create a workspace and test the flow</h2>
          <p>
            Start with one channel, one approved prompt, and one public chat
            link. That is enough to see how Aotesys handles live website
            questions.
          </p>
        </div>
        <RouteLink route="signup" className="primary-button" onNavigate={onNavigate}>
          <UserPlus size={18} />
          <span>Create workspace</span>
        </RouteLink>
      </section>
    </MarketingShell>
  );
}

function ResourcesPage({ onNavigate }) {
  return (
    <MarketingShell
      routeName="resources"
      eyebrow="Resources"
      title="Guides for safer AI sales conversations"
      onNavigate={onNavigate}
    >
      <section className="content-band">
        <div className="resource-list">
          <RouteLink
            route="guide"
            className="resource-card"
            onNavigate={onNavigate}
            title="Read the AI sales assistant guide"
          >
            <FileText size={24} />
            <div>
              <p className="eyebrow">Guide</p>
              <h2>How an AI sales assistant should handle website inquiries</h2>
              <p>
                A practical guide by {AUTHOR_NAME} on approved facts, visitor
                names, safe handoff, and conversation learning.
              </p>
              <span>Read guide</span>
            </div>
          </RouteLink>
        </div>
      </section>

      <section className="content-band two-column-band">
        <div>
          <p className="eyebrow">Editorial approach</p>
          <h2>Content written from product practice</h2>
          <p>
            The Aotesys resource library is intentionally focused on small
            business sales support. Future articles will cover prompt updates,
            owner handoff scripts, channel design, and how to review customer
            conversations without adding unreliable facts to the assistant.
          </p>
        </div>
        <div className="author-panel">
          <BookOpen size={24} />
          <strong>Author: {AUTHOR_NAME}</strong>
          <span>Updated Jun 29, 2026</span>
          <p>
            Every guide should help a business owner make the assistant more
            useful while keeping human accountability close.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}

function GuidePage({ onNavigate }) {
  return (
    <MarketingShell
      routeName="guide"
      eyebrow="Aotesys guide"
      title="How an AI sales assistant should handle website inquiries"
      onNavigate={onNavigate}
    >
      <article className="article-layout">
        <p className="article-intro">
          A website sales assistant should feel fast to the visitor and careful
          to the business owner. The visitor wants a useful answer now. The
          business needs the answer to be accurate, on-brand, and traceable. The
          Aotesys approach is to answer only from approved facts, then hand off
          the conversation when the question needs a person.
        </p>

        {guideSections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}

        <section>
          <h2>A simple checklist for the first Aotesys channel</h2>
          <ul className="check-list article-checks">
            {operatingPrinciples.map((item) => (
              <li key={item}>
                <Check size={18} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p>
            This checklist is small on purpose. A sales assistant becomes useful
            when the workflow is repeatable. Start with the common visitor
            questions, give the assistant only facts the business owner is happy
            to stand behind, and let the owner handle the questions that still
            need judgement.
          </p>
        </section>
      </article>
    </MarketingShell>
  );
}

function AboutPage({ onNavigate }) {
  return (
    <MarketingShell
      routeName="about"
      eyebrow="About Aotesys"
      title="Built for practical website sales support"
      onNavigate={onNavigate}
    >
      <section className="content-band two-column-band">
        <div>
          <h2>Why Aotesys exists</h2>
          <p>
            Aotesys exists because many small business websites have the same
            problem: visitors arrive with buying intent, but the business owner
            is not always available to answer the first question. A contact form
            can feel slow. A generic chatbot can feel risky. Aotesys sits in the
            middle with a narrow, practical job.
          </p>
          <p>
            The platform gives each business a workspace, channels for different
            sales entry points, a public chat link, and a place for the owner to
            continue the conversation. It is designed to keep the assistant
            useful without letting it make up policies, prices, guarantees, or
            availability.
          </p>
          <p>
            The public Aotesys content is written by {AUTHOR_NAME}. The product
            position is straightforward: AI can help a business respond faster,
            but the source of truth still belongs to the business owner.
          </p>
        </div>
        <div className="author-panel">
          <Globe2 size={24} />
          <strong>{APP_DOMAIN}</strong>
          <span>Author: {AUTHOR_NAME}</span>
          <p>
            Aotesys is presented as a focused AI sales assistant workspace for
            business websites, public chat links, and owner-managed handoff.
          </p>
        </div>
      </section>

      <section className="content-band">
        <div className="section-heading compact">
          <p className="eyebrow">Principles</p>
          <h2>What the product should keep doing</h2>
        </div>
        <div className="feature-grid">
          {operatingPrinciples.map((item) => (
            <article className="feature-card" key={item}>
              <Check size={22} />
              <h3>{item}</h3>
              <p>
                This principle keeps the assistant useful for visitors and
                accountable for business owners.
              </p>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

function ContactPage({ onNavigate }) {
  return (
    <MarketingShell
      routeName="contact"
      eyebrow="Contact"
      title="Ask about Aotesys workspaces"
      onNavigate={onNavigate}
    >
      <section className="content-band two-column-band">
        <div>
          <h2>Contact {AUTHOR_NAME}</h2>
          <p>
            Use this page for product questions, workspace setup help, feature
            requests, partnership ideas, and corrections to public Aotesys
            content. If you are testing Aotesys for a business, include the
            workspace name, the channel you are using, and the visitor question
            you want the assistant to handle better.
          </p>
          <p>
            Aotesys is most useful when the business owner has clear product,
            service, pricing, booking, delivery, or policy information ready to
            approve. If any of that information is still missing, the assistant
            can be configured to collect contact details and hand the question
            back to the manager.
          </p>
          <a className="contact-link" href={`mailto:${AUTHOR_EMAIL}`}>
            <Mail size={20} />
            {AUTHOR_EMAIL}
          </a>
        </div>
        <div className="contact-panel">
          <h2>Helpful details to include</h2>
          <ul className="check-list">
            <li>
              <Check size={18} />
              <span>Your business or workspace name.</span>
            </li>
            <li>
              <Check size={18} />
              <span>The website page or chat link where the issue happened.</span>
            </li>
            <li>
              <Check size={18} />
              <span>The exact question a visitor asked.</span>
            </li>
            <li>
              <Check size={18} />
              <span>The approved answer the assistant should use.</span>
            </li>
          </ul>
        </div>
      </section>
    </MarketingShell>
  );
}

function PolicyPage({ routeName, onNavigate }) {
  const isPrivacy = routeName === "privacy";

  return (
    <MarketingShell
      routeName={routeName}
      eyebrow={isPrivacy ? "Privacy" : "Terms"}
      title={isPrivacy ? "Privacy Policy" : "Terms of Service"}
      onNavigate={onNavigate}
    >
      <article className="article-layout policy-layout">
        {isPrivacy ? <PrivacyContent /> : <TermsContent />}
      </article>
    </MarketingShell>
  );
}

function PrivacyContent() {
  return (
    <>
      <section>
        <h2>Overview</h2>
        <p>
          This privacy policy explains how Aotesys handles information submitted
          through the website, workspace signup, owner login, and public chat
          links. Aotesys is designed for business inquiry handling, so the
          information collected may include names, contact details, visitor
          messages, workspace names, channel prompts, and conversation history.
        </p>
      </section>
      <section>
        <h2>Information used by the assistant</h2>
        <p>
          Workspace owners can provide approved prompts and business knowledge so
          the assistant can answer visitor questions. Visitor messages may be
          stored in the workspace so the owner can reply, archive the
          conversation, or review common questions. Aotesys should not be used to
          collect sensitive personal information that is not needed for a sales
          or support conversation.
        </p>
      </section>
      <section>
        <h2>Contact and corrections</h2>
        <p>
          To ask about privacy, request a correction, or report content that
          should be removed from a workspace conversation, contact {AUTHOR_NAME}
          at {AUTHOR_EMAIL}. Include enough context to identify the relevant
          workspace or public chat link.
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <section>
        <h2>Use of Aotesys</h2>
        <p>
          Aotesys provides AI sales assistant workspaces for business websites.
          Workspace owners are responsible for the accuracy of prompts, approved
          business information, public chat links, and follow-up messages sent to
          visitors. The assistant is a sales support tool and should not be
          treated as legal, financial, medical, or safety advice.
        </p>
      </section>
      <section>
        <h2>Approved facts and handoff</h2>
        <p>
          The platform is designed to answer from approved business facts and
          hand off uncertain questions to a manager. Workspace owners should
          review prompts regularly, remove outdated claims, and avoid asking the
          assistant to invent prices, policies, availability, guarantees, or
          other material business details.
        </p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>
          Aotesys may change as the product improves. Features, workflows, and
          public content can be updated by {AUTHOR_NAME}. If you have questions
          about these terms or about responsible use of an Aotesys workspace,
          contact {AUTHOR_EMAIL}.
        </p>
      </section>
    </>
  );
}

function NotFoundPage({ onNavigate }) {
  return (
    <div className="home-page marketing-page">
      <MarketingHeader onNavigate={onNavigate} />
      <main className="public-empty-state not-found-state">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p>
          This Aotesys URL does not point to a live page. Use the public pages
          below to find the product, resource, contact, and policy information.
        </p>
        <div className="hero-actions">
          <RouteLink route="home" className="primary-button" onNavigate={onNavigate}>
            <Home size={18} />
            <span>Home</span>
          </RouteLink>
          <RouteLink route="contact" className="secondary-button" onNavigate={onNavigate}>
            <Mail size={18} />
            <span>Contact</span>
          </RouteLink>
        </div>
      </main>
      <MarketingFooter onNavigate={onNavigate} />
    </div>
  );
}

function SignupPage({ isAuthReady, onNavigate, onCreateWorkspace }) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previewSlug = slugifyWorkspaceName(workspaceName) || "your-business";
  const isWorkspaceUnavailable = message === "The workspace name is unavailable.";

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const result = await onCreateWorkspace(workspaceName);

      if (!result.ok) {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error.message || "Google sign-in could not create this workspace.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>{APP_NAME}</span>
        </button>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => onNavigate("home")}>
            <Home size={18} />
            <span>Home</span>
          </button>
          <button className="secondary-button" onClick={() => onNavigate("login")}>
            <LogIn size={18} />
            <span>Login</span>
          </button>
        </div>
      </header>

      <section className="login-panel">
        <div>
          <p className="eyebrow">Create workspace</p>
          <h1>Sign up</h1>
          <p>
            Name the workspace with the business name, then continue with Google
            to create the owner dashboard.
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Workspace name</span>
            <input
              value={workspaceName}
              placeholder="Online2Book"
              className={isWorkspaceUnavailable ? "input-error" : ""}
              aria-invalid={isWorkspaceUnavailable}
              onChange={(event) => {
                setWorkspaceName(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <div
            className={`workspace-preview ${
              isWorkspaceUnavailable ? "preview-error" : ""
            }`}
          >
            <Building2 size={18} />
            <span>{previewSlug}.{APP_DOMAIN}</span>
          </div>
          {message && <p className="form-status">{message}</p>}
          <button
            className="primary-button"
            type="submit"
            disabled={!isAuthReady || isSubmitting}
          >
            <ArrowRight size={18} />
            <span>{isSubmitting ? "Opening Google..." : "Continue with Google"}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

function WorkspaceOnboardingPage({
  userEmail,
  onCreateWorkspace,
  onNavigate,
  onSignOut
}) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previewSlug = slugifyWorkspaceName(workspaceName) || "your-business";
  const isWorkspaceUnavailable = message === "The workspace name is unavailable.";

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const result = await onCreateWorkspace(workspaceName);

      if (!result.ok) {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error.message || "Workspace could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>{APP_NAME}</span>
        </button>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={onSignOut}>
            <LogIn size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      <section className="login-panel">
        <div>
          <p className="eyebrow">Signed in{userEmail ? ` as ${userEmail}` : ""}</p>
          <h1>Create Workspace</h1>
          <p>
            Use your business name. Aotesys will create the owner dashboard and
            public workspace address from it.
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Business or workspace name</span>
            <input
              value={workspaceName}
              placeholder="Online2Book"
              className={isWorkspaceUnavailable ? "input-error" : ""}
              aria-invalid={isWorkspaceUnavailable}
              onChange={(event) => {
                setWorkspaceName(event.target.value);
                setMessage("");
              }}
              autoFocus
            />
          </label>
          <div
            className={`workspace-preview ${
              isWorkspaceUnavailable ? "preview-error" : ""
            }`}
          >
            <Building2 size={18} />
            <span>{previewSlug}.{APP_DOMAIN}</span>
          </div>
          {message && <p className="form-status">{message}</p>}
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting}
          >
            <ArrowRight size={18} />
            <span>{isSubmitting ? "Creating..." : "Create workspace"}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

function LoginPage({ isAuthReady, onNavigate, onLogin }) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const result = await onLogin();

      if (!result.ok) {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error.message || "Google sign-in could not open this workspace.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>{APP_NAME}</span>
        </button>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => onNavigate("home")}>
            <Home size={18} />
            <span>Home</span>
          </button>
          <button className="primary-button" onClick={() => onNavigate("signup")}>
            <UserPlus size={18} />
            <span>Sign up</span>
          </button>
        </div>
      </header>

      <section className="login-panel">
        <div>
          <p className="eyebrow">Workspace access</p>
          <h1>Login</h1>
          <p>
            Continue with Google. If your account already owns a workspace,
            Aotesys will open it. If not, you can create one next.
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="workspace-preview">
            <Sparkles size={18} />
            <span>Google account controls workspace access</span>
          </div>
          {message && <p className="form-status">{message}</p>}
          <button
            className="primary-button"
            type="submit"
            disabled={!isAuthReady || isSubmitting}
          >
            <LogIn size={19} />
            <span>{isSubmitting ? "Opening Google..." : "Continue with Google"}</span>
          </button>
        </form>
      </section>
    </div>
  );
}

function PublicChatPage({
  channel,
  channelId,
  workspaceSlug,
  workspace,
  onNavigate,
  onEnsureConversation,
  onSendVisitorMessage,
  onRefreshConversation
}) {
  const [visitorConversationId] = useState(() =>
    getVisitorSessionId(workspace?.slug, channelId)
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (channel) {
      onEnsureConversation(channelId, visitorConversationId);
    }
  }, [channel, channelId, visitorConversationId]);

  useEffect(() => {
    if (!workspaceSlug || !channel) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void onRefreshConversation(channelId, visitorConversationId).catch(() => {});
    }, 5000);

    return () => window.clearInterval(interval);
  }, [
    channel,
    channelId,
    onRefreshConversation,
    visitorConversationId,
    workspaceSlug
  ]);

  const conversation = channel?.conversations.find(
    (item) => item.id === visitorConversationId
  );

  const sendMessage = async () => {
    if (!draftMessage.trim() || !conversation || isSending) {
      return;
    }

    const message = draftMessage;
    setDraftMessage("");
    setIsSending(true);

    try {
      await onSendVisitorMessage(channelId, visitorConversationId, message);
      await onRefreshConversation(channelId, visitorConversationId).catch(() => {});
    } finally {
      setIsSending(false);
    }
  };

  if (!channel) {
    return (
      <div className="public-chat-page">
        <header className="topbar">
          <button className="brand-button" onClick={() => onNavigate("home")}>
            <Bot size={22} />
            <span>{APP_NAME}</span>
          </button>
        </header>

        <section className="public-empty-state">
          <p className="eyebrow">Public chat</p>
          <h1>Channel not found</h1>
          <p>This shared chat link is not connected to an active channel.</p>
          <button className="secondary-button" onClick={() => onNavigate("home")}>
            <Home size={18} />
            <span>Home</span>
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="public-chat-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>{APP_NAME}</span>
        </button>
      </header>

      <main className="public-chat-shell">
        <section className="public-chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">{workspace?.name || channel.name}</p>
              <h2>Sale Support</h2>
            </div>
            <span className="status-pill">Bot active</span>
          </div>

          <div className="message-list">
            {(conversation?.messages ?? []).map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <span>{message.role === "bot" ? "Bot" : "You"}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <div className="reply-box">
            <input
              value={draftMessage}
              placeholder="Type your message..."
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMessage();
                }
              }}
            />
            <button
              className="primary-icon-button"
              onClick={sendMessage}
              title="Send message"
              aria-label="Send message"
              disabled={!conversation || isSending}
            >
              <Send size={19} />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProfilePanel({ profile, setProfile }) {
  return (
    <section className="profile-layout">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h1>Profile</h1>
      </div>

      <form className="form-panel">
        <label>
          <span>Email</span>
          <input
            type="email"
            value={profile.email}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                email: event.target.value
              }))
            }
          />
        </label>
        <label>
          <span>Business name</span>
          <input
            type="text"
            value={profile.businessName}
            placeholder="Optional"
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                businessName: event.target.value
              }))
            }
          />
        </label>
      </form>
    </section>
  );
}

function ConversationPanel({
  selectedChannel,
  selectedConversation,
  conversations,
  shareLink,
  copied,
  draftReply,
  onConversationChange,
  onCopyShareLink,
  onPromptChange,
  onPromptUpdatedAtChange,
  onAutoKnowledgeEnabledChange,
  onReceptionistLearningEnabledChange,
  onAutoKnowledgePromptChange,
  onUpdateAutoKnowledge,
  onDraftReplyChange,
  onSendOwnerReply,
  onArchiveConversation,
  pendingKnowledgeCount,
  isKnowledgeUpdating,
  knowledgeAuditStatus
}) {
  const [conversationMode, setConversationMode] = useState("chats");
  const isSettingsMode = conversationMode === "settings";
  const ownerConversations = conversations.filter(
    (conversation) => conversation.receptionistLearning
  );
  const visitorConversations = conversations.filter(
    (conversation) => !conversation.receptionistLearning
  );
  const showOwnerFrame = Boolean(
    selectedChannel?.autoKnowledgeEnabled &&
      selectedChannel?.receptionistLearningEnabled
  );
  const knowledgeAuditStats = useMemo(
    () => getKnowledgeAuditStats(selectedChannel),
    [selectedChannel]
  );

  return (
    <section className="conversation-layout">
      <div className="section-heading-row">
        <div className="section-heading">
          <p className="eyebrow">
            {isSettingsMode ? "Selected channel setup" : "Visitor messages"}
          </p>
          <h1>{isSettingsMode ? "Channel settings" : "Conversations"}</h1>
        </div>
        <button
          className={isSettingsMode ? "secondary-button" : "primary-button"}
          onClick={() =>
            setConversationMode(isSettingsMode ? "chats" : "settings")
          }
        >
          {isSettingsMode ? <MessagesSquare size={18} /> : <Settings size={18} />}
          <span>{isSettingsMode ? "Back to conversations" : "Channel settings"}</span>
        </button>
      </div>

      {isSettingsMode ? (
        <div className="settings-window">
          <section className="channel-settings-panel">
            <div className="settings-header">
              <div>
                <p className="eyebrow">Channel</p>
                <h2>{selectedChannel?.name}</h2>
              </div>
              <span className="status-pill">Link ready</span>
            </div>

            <div className="settings-stack">
              <div className="share-box expanded">
                <div>
                  <p>Share link</p>
                  <strong>{selectedChannel?.name}</strong>
                </div>
                <div className="share-link">
                  <Link2 size={17} />
                  <span>{shareLink}</span>
                  <button
                    className="icon-button light"
                    onClick={onCopyShareLink}
                    title="Copy share link"
                    aria-label="Copy share link"
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
              </div>

              <label className="date-editor">
                <span>Prompt last updated</span>
                <input
                  type="date"
                  value={selectedChannel?.promptUpdatedAt ?? getTodayDate()}
                  onInput={(event) =>
                    onPromptUpdatedAtChange(event.currentTarget.value)
                  }
                  onChange={(event) =>
                    onPromptUpdatedAtChange(event.target.value)
                  }
                />
              </label>

              <label className="prompt-editor expanded">
                <span>
                  <Settings size={17} />
                  Bot prompt
                </span>
                <textarea
                  value={selectedChannel?.prompt ?? ""}
                  onChange={(event) => onPromptChange(event.target.value)}
                />
              </label>

              <div className="knowledge-editor expanded">
                <div className="knowledge-heading">
                  <span>
                    <BookOpen size={17} />
                    Auto Knowledges Learning
                  </span>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedChannel?.autoKnowledgeEnabled)}
                      onChange={(event) =>
                        onAutoKnowledgeEnabledChange(event.target.checked)
                      }
                    />
                    <span>Enabled</span>
                  </label>
                </div>
                <label className="checkbox-row receptionist-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      selectedChannel?.receptionistLearningEnabled
                    )}
                    onChange={(event) =>
                      onReceptionistLearningEnabledChange(event.target.checked)
                    }
                  />
                  <span>Learn as a real receptionist</span>
                </label>
                <textarea
                  value={selectedChannel?.autoKnowledgePrompt ?? ""}
                  onChange={(event) =>
                    onAutoKnowledgePromptChange(event.target.value)
                  }
                />
                <div className="audit-trace" aria-label="Knowledge audit trace">
                  <div>
                    <strong>
                      {knowledgeAuditStats.pendingConversations.length}
                    </strong>
                    <span>Pending</span>
                  </div>
                  <div>
                    <strong>{knowledgeAuditStats.auditedCount}</strong>
                    <span>Audited</span>
                  </div>
                  <div>
                    <strong>{knowledgeAuditStats.totalCount}</strong>
                    <span>Sources</span>
                  </div>
                </div>
                <div className="knowledge-actions">
                  <span className="audit-status">
                    {pendingKnowledgeCount} pending · Last run{" "}
                    {formatAuditDate(selectedChannel?.autoKnowledgeLastRunAt)}
                  </span>
                  <button
                    className="secondary-button"
                    onClick={onUpdateAutoKnowledge}
                    disabled={!selectedChannel || isKnowledgeUpdating}
                  >
                    <RefreshCcw size={18} />
                    <span>{isKnowledgeUpdating ? "Updating" : "Update Now"}</span>
                  </button>
                </div>
                {knowledgeAuditStatus && (
                  <p className="knowledge-status">{knowledgeAuditStatus}</p>
                )}
                {knowledgeAuditStats.pendingConversations.length > 0 && (
                  <div className="pending-source-list">
                    {knowledgeAuditStats.pendingConversations.map(
                      (conversation) => (
                        <span key={conversation.id}>
                          {conversation.visitorName || "Visitor"}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : (
      <div className="conversation-grid">
        <aside className="visitor-panel">
          {showOwnerFrame && (
            <div className="owner-learning-frame">
              <div className="panel-heading">
                <h2>Owner / Receptionist setup</h2>
              </div>
              <div className="visitor-list owner-learning-list">
                {ownerConversations.length === 0 && (
                  <div className="empty-panel">
                    The receptionist setup conversation will appear here.
                  </div>
                )}
                {ownerConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className={
                      [
                        "visitor-button",
                        "learning-thread",
                        conversation.id === selectedConversation?.id
                          ? "active"
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                    onClick={() => onConversationChange(conversation.id)}
                  >
                    <div>
                      <strong>{conversation.visitorName}</strong>
                      <span>{conversation.lastSeen}</span>
                    </div>
                    <small>{conversation.status}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel-heading visitor-heading">
            <h2>Visitors</h2>
          </div>
          <div className="visitor-list">
            {visitorConversations.length === 0 && (
              <div className="empty-panel">No active conversations</div>
            )}
            {visitorConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  [
                    "visitor-button",
                    conversation.id === selectedConversation?.id ? "active" : "",
                    conversation.receptionistLearning ? "learning-thread" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                onClick={() => onConversationChange(conversation.id)}
              >
                <div>
                  <strong>{conversation.visitorName}</strong>
                  <span>{conversation.lastSeen}</span>
                </div>
                <small>{conversation.status}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">{selectedChannel?.name}</p>
              <h2>{selectedConversation?.visitorName || "No active visitor"}</h2>
              {selectedConversation?.receptionistLearning && (
                <p className="learning-note">
                  Internal learning thread. Your answer will teach the bot and
                  create a warmer customer reply.
                </p>
              )}
            </div>
            <div className="chat-actions">
              <span className="status-pill">
                {selectedConversation?.status || "No active chat"}
              </span>
              <button
                className="icon-button light"
                onClick={onArchiveConversation}
                title="Archive conversation"
                aria-label="Archive conversation"
                disabled={!selectedConversation}
              >
                <Archive size={18} />
              </button>
            </div>
          </div>

          <div className="message-list">
            {!selectedConversation && (
              <div className="empty-panel">Archived conversations are hidden.</div>
            )}
            {selectedConversation?.messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <span>{message.role === "bot" ? "Bot" : message.role === "owner" ? "Owner" : "Visitor"}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <div className="reply-box">
            <input
              value={draftReply}
              placeholder={
                selectedConversation?.receptionistLearning
                  ? "Answer the receptionist..."
                  : "Join the conversation..."
              }
              onChange={(event) => onDraftReplyChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSendOwnerReply();
                }
              }}
            />
            <button
              className="primary-icon-button"
              onClick={onSendOwnerReply}
              title="Send owner reply"
              aria-label="Send owner reply"
              disabled={!selectedConversation}
            >
              <Send size={19} />
            </button>
          </div>
        </section>
      </div>
      )}
    </section>
  );
}
