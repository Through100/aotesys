import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer as createViteServer } from "vite";

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

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
app.use(express.json({ limit: "1mb" }));

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

if (isProduction) {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }

    response.sendFile(path.join(distPath, "index.html"));
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
  console.log(`Sale Assist running at http://${host}:${port}/`);
});

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

async function createOllamaReply(payload) {
  const baseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL;

  if (!baseUrl || !model) {
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
  const promptAge = getPromptAge(promptUpdatedAt);
  const messages = buildMessages(payload, message, {
    prompt,
    promptAge,
    promptUpdatedAt
  });
  const isOpenAiCompatible = /\/v1(?:\/)?$/i.test(baseUrl);
  const endpoint = isOpenAiCompatible
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/chat`;
  const body = isOpenAiCompatible
    ? { model, messages, stream: false }
    : { model, messages, stream: false };

  const headers = {
    "Content-Type": "application/json"
  };

  if (process.env.OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }

  const ollamaResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
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

function buildMessages(payload, message, { prompt, promptAge, promptUpdatedAt }) {
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

Current visitor name: ${visitorName}.

Accuracy rules:
- Treat the approved channel prompt above as the only source of business truth.
- Do not invent prices, shipping details, availability, product/service features, policies, locations, timelines, guarantees, or contact details.
- Answer a business question only when the answer is explicitly provided in the approved channel prompt or already stated by the visitor in this conversation.
- If the answer is not explicitly provided, use this exact reply: "${MANAGER_HANDOFF_REPLY}"
- If the visitor provides contact details, acknowledge them and say the Sale Manager can follow up.
- If the visitor asks something unrelated to this business, use this exact reply: "${OFF_TOPIC_REPLY}"
- If the visitor has not provided their name yet, ask for their name before deeper sales questions.
- When you answer using an approved fact and the prompt is stale, include that the information was last updated ${promptAge.label}.
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
    "ship",
    "shipping",
    "deliver",
    "delivery",
    "available",
    "availability",
    "feature",
    "package",
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
