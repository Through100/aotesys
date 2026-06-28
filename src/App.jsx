import {
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
  Send,
  Settings,
  UserRound
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

const AUTH_STORAGE_KEY = "sale-assist-auth";
const CHANNELS_STORAGE_KEY = "sale-assist-channels";

const initialChannels = [
  {
    id: "channel-a",
    name: "Channel A",
    prompt:
      "You are Sale Assist. Greet visitors warmly, ask for their name, answer product questions clearly, and hand over to the business owner when needed.",
    conversations: [
      {
        id: "maria-lee",
        visitorName: "Maria Lee",
        status: "Bot active",
        lastSeen: "2 min ago",
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
      return parsedChannels;
    }
  } catch {
    return initialChannels;
  }

  return initialChannels;
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

function buildBotReply(text, visitorName, detectedName) {
  const lowerText = text.toLowerCase();
  const name = detectedName || visitorName;

  if (!visitorName || visitorName === "Visitor") {
    if (detectedName) {
      return `Nice to meet you, ${detectedName}. What would you like help with today?`;
    }

    return "Thanks. Before we continue, what should I call you?";
  }

  if (lowerText.includes("price") || lowerText.includes("cost")) {
    return `I can help with pricing, ${name}. Which product or service are you looking at?`;
  }

  if (lowerText.includes("owner") || lowerText.includes("human")) {
    return "I can keep helping here, and I will make this conversation easy for the owner to pick up.";
  }

  return `Thanks, ${name}. I can help with that. Tell me one more detail and I will point you in the right direction.`;
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

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId),
    [channels, selectedChannelId]
  );

  const selectedConversation = useMemo(
    () =>
      selectedChannel?.conversations.find(
        (conversation) => conversation.id === selectedConversationId
      ),
    [selectedChannel, selectedConversationId]
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
      prompt:
        "Introduce yourself, collect the visitor name, answer sales questions, and alert the owner if the visitor is ready to buy.",
      conversations: [
        {
          id: `${id}-visitor`,
          visitorName: "New visitor",
          status: "Bot active",
          lastSeen: "New",
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
    setSelectedChannelId(id);
    setSelectedConversationId(nextChannel?.conversations[0]?.id ?? "");
    setActiveTab("conversations");
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

  const sendVisitorMessage = (channelId, conversationId, text) => {
    const messageText = text.trim();

    if (!messageText) {
      return;
    }

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
            const botReply = buildBotReply(
              messageText,
              conversation.visitorName,
              detectedName
            );

            return {
              ...conversation,
              visitorName,
              status: "Bot active",
              lastSeen: "Just now",
              messages: [
                ...conversation.messages,
                {
                  id: conversation.messages.length + 1,
                  role: "visitor",
                  text: messageText
                },
                {
                  id: conversation.messages.length + 2,
                  role: "bot",
                  text: botReply
                }
              ]
            };
          })
        };
      })
    );
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
            selectedConversationId={selectedConversationId}
            shareLink={shareLink}
            copied={copied}
            draftReply={draftReply}
            onConversationChange={setSelectedConversationId}
            onCopyShareLink={copyShareLink}
            onPromptChange={updatePrompt}
            onDraftReplyChange={setDraftReply}
            onSendOwnerReply={sendOwnerReply}
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

  useEffect(() => {
    if (channel) {
      onEnsureConversation(channelId, visitorConversationId);
    }
  }, [channel, channelId, visitorConversationId]);

  const conversation = channel?.conversations.find(
    (item) => item.id === visitorConversationId
  );

  const sendMessage = () => {
    if (!draftMessage.trim() || !conversation) {
      return;
    }

    onSendVisitorMessage(channelId, visitorConversationId, draftMessage);
    setDraftMessage("");
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
              disabled={!conversation}
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
  selectedConversationId,
  shareLink,
  copied,
  draftReply,
  onConversationChange,
  onCopyShareLink,
  onPromptChange,
  onDraftReplyChange,
  onSendOwnerReply
}) {
  const [conversationMode, setConversationMode] = useState("chats");
  const isSettingsMode = conversationMode === "settings";

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
            {selectedChannel?.conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  conversation.id === selectedConversationId
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
              <h2>{selectedConversation?.visitorName}</h2>
            </div>
            <span className="status-pill">{selectedConversation?.status}</span>
          </div>

          <div className="message-list">
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
