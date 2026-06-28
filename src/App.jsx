import {
  Archive,
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Home,
  Link2,
  LogIn,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  UserRound
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

const AUTH_STORAGE_KEY = "sale-assist-auth";
const CHANNELS_STORAGE_KEY = "sale-assist-channels";
const UNSURE_MANAGER_REPLY =
  "I'm unsure at the moment. Can I get your email address or preferred contact detail so the Sale Manager can answer you back?";
const OFF_TOPIC_REPLY =
  "I can only help with questions related to this business. If you have a business question, please send it here.";

const initialChannels = [
  {
    id: "channel-a",
    name: "Channel A",
    promptUpdatedAt: getTodayDate(),
    prompt:
      "You are Sale Assist. Greet visitors warmly, ask for their name, answer product questions clearly, and hand over to the business owner when needed.",
    autoKnowledgeEnabled: false,
    autoKnowledgePrompt: "",
    autoKnowledgeUpdatedAt: "",
    autoKnowledgeLastRunAt: "",
    conversations: [
      {
        id: "maria-lee",
        visitorName: "Maria Lee",
        status: "Bot active",
        lastSeen: "2 min ago",
        lastActivityAt: new Date(Date.now() - 120_000).toISOString(),
        autoKnowledgeAuditedAt: "",
        archived: false,
        messages: [
          {
            id: 1,
            role: "bot",
            text:
              "Hi, I am Sale Assist. I can help with product questions and connect you with the owner. What is your name?"
          },
          {
            id: 2,
            role: "visitor",
            text: "I am Maria. Do you help compare service packages?"
          },
          {
            id: 3,
            role: "bot",
            text:
              "Nice to meet you, Maria. Yes, tell me what you need most and I can narrow the best option."
          }
        ]
      },
      {
        id: "new-visitor",
        visitorName: "New visitor",
        status: "Waiting",
        lastSeen: "Just now",
        lastActivityAt: new Date().toISOString(),
        autoKnowledgeAuditedAt: "",
        archived: false,
        messages: [
          {
            id: 1,
            role: "bot",
            text:
              "Hi, I am Sale Assist. I can answer questions here. Before we start, what should I call you?"
          }
        ]
      }
    ]
  }
];

function getRoute() {
  const path = window.location.pathname;

  if (path === "/") {
    return { name: "home" };
  }

  if (path.startsWith("/chat/")) {
    return {
      name: "public-chat",
      channelId: decodeURIComponent(path.replace("/chat/", ""))
    };
  }

  return { name: "login" };
}

function getInitialChannels() {
  try {
    const storedChannels = window.localStorage.getItem(CHANNELS_STORAGE_KEY);
    const parsedChannels = storedChannels ? JSON.parse(storedChannels) : null;

    if (Array.isArray(parsedChannels) && parsedChannels.length > 0) {
      return normalizeChannels(parsedChannels);
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
    autoKnowledgePrompt: channel.autoKnowledgePrompt || "",
    autoKnowledgeUpdatedAt: channel.autoKnowledgeUpdatedAt || "",
    autoKnowledgeLastRunAt: channel.autoKnowledgeLastRunAt || "",
    conversations: (channel.conversations || []).map((conversation) => ({
      ...conversation,
      archived: Boolean(conversation.archived),
      autoKnowledgeAuditedAt: conversation.autoKnowledgeAuditedAt || "",
      lastActivityAt:
        conversation.lastActivityAt ||
        deriveLastActivityAt(conversation.lastSeen)
    }))
  }));
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

function getVisitorSessionId(channelId) {
  const key = `sale-assist-visitor-${channelId}`;
  const existingId = window.localStorage.getItem(key);

  if (existingId) {
    return existingId;
  }

  const nextId = `visitor-${Date.now()}`;
  window.localStorage.setItem(key, nextId);
  return nextId;
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
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => window.localStorage.getItem(AUTH_STORAGE_KEY) === "mock"
  );
  const [profile, setProfile] = useState({
    email: "owner@example.com",
    businessName: ""
  });
  const [channels, setChannels] = useState(getInitialChannels);
  const [selectedChannelId, setSelectedChannelId] = useState("channel-a");
  const [selectedConversationId, setSelectedConversationId] =
    useState("maria-lee");
  const [activeTab, setActiveTab] = useState("conversations");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [draftReply, setDraftReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [isKnowledgeUpdating, setIsKnowledgeUpdating] = useState(false);
  const [knowledgeAuditStatus, setKnowledgeAuditStatus] = useState("");

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

  const shareLink = `${window.location.origin}/chat/${selectedChannelId}`;

  useEffect(() => {
    const handlePopState = () => setRoute(getRoute());
    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels));
  }, [channels]);

  useEffect(() => {
    setKnowledgeAuditStatus("");
  }, [selectedChannelId]);

  const navigate = (nextRoute) => {
    const path = nextRoute === "home" ? "/" : "/login";
    window.history.pushState(null, "", path);
    setRoute({ name: nextRoute });
  };

  const loginWithMockFirebase = () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, "mock");
    setIsAuthenticated(true);
    setRoute({ name: "login" });
    window.history.pushState(null, "", "/login");
  };

  const logout = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
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
      autoKnowledgePrompt: "",
      autoKnowledgeUpdatedAt: "",
      autoKnowledgeLastRunAt: "",
      conversations: [
        {
          id: `${id}-visitor`,
          visitorName: "New visitor",
          status: "Bot active",
          lastSeen: "New",
          lastActivityAt: getNowIso(),
          autoKnowledgeAuditedAt: "",
          archived: false,
          messages: [
            {
              id: 1,
              role: "bot",
              text:
                "Hi, I am Sale Assist. I can help answer your questions. What is your name?"
            }
          ]
        }
      ]
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

    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== selectedChannelId) {
          return channel;
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
                  text: draftReply.trim()
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

  if (route.name === "public-chat") {
    const publicChannel = channels.find(
      (channel) => channel.id === route.channelId
    );

    return (
      <PublicChatPage
        channel={publicChannel}
        channelId={route.channelId}
        onNavigate={navigate}
        onEnsureConversation={ensureVisitorConversation}
        onSendVisitorMessage={sendVisitorMessage}
      />
    );
  }

  if (route.name === "home") {
    return <HomePage onNavigate={navigate} />;
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        onNavigate={navigate}
        onLogin={loginWithMockFirebase}
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
          {isSidebarOpen && <strong>Sale Assist</strong>}
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

function HomePage({ onNavigate }) {
  return (
    <div className="home-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>Sale Assist</span>
        </button>
        <button className="secondary-button" onClick={() => onNavigate("login")}>
          <LogIn size={18} />
          <span>Login</span>
        </button>
      </header>

      <section className="home-hero">
        <p className="eyebrow">Customer chat dashboard</p>
        <h1>Sale Assist</h1>
        <p>
          A simple place to create shareable chat channels, let the bot greet
          visitors, and join the conversation when a real person is needed.
        </p>
        <button className="primary-button" onClick={() => onNavigate("login")}>
          <LogIn size={19} />
          <span>Open login</span>
        </button>
      </section>
    </div>
  );
}

function LoginPage({ onNavigate, onLogin }) {
  return (
    <div className="login-page">
      <header className="topbar">
        <button className="brand-button" onClick={() => onNavigate("home")}>
          <Bot size={22} />
          <span>Sale Assist</span>
        </button>
        <button className="secondary-button" onClick={() => onNavigate("home")}>
          <Home size={18} />
          <span>Home</span>
        </button>
      </header>

      <section className="login-panel">
        <div>
          <p className="eyebrow">Firebase auth placeholder</p>
          <h1>Login</h1>
          <p>
            The real Firebase sign-in can be connected once the web app config
            is available.
          </p>
        </div>
        <button className="primary-button" onClick={onLogin}>
          <LogIn size={19} />
          <span>Mock Firebase login</span>
        </button>
      </section>
    </div>
  );
}

function PublicChatPage({
  channel,
  channelId,
  onNavigate,
  onEnsureConversation,
  onSendVisitorMessage
}) {
  const [visitorConversationId] = useState(() => getVisitorSessionId(channelId));
  const [draftMessage, setDraftMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (channel) {
      onEnsureConversation(channelId, visitorConversationId);
    }
  }, [channel, channelId, visitorConversationId]);

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
            <span>Sale Assist</span>
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
          <span>Sale Assist</span>
        </button>
      </header>

      <main className="public-chat-shell">
        <section className="public-chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">{channel.name}</p>
              <h2>Sale Assist</h2>
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
          <div className="panel-heading">
            <h2>Visitors</h2>
          </div>
          <div className="visitor-list">
            {conversations.length === 0 && (
              <div className="empty-panel">No active conversations</div>
            )}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  conversation.id === selectedConversation?.id
                    ? "visitor-button active"
                    : "visitor-button"
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
              placeholder="Join the conversation..."
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
