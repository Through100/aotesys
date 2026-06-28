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

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", async (request, response) => {
  try {
    const reply = await createOllamaReply(request.body);
    response.json({ reply });
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

  const messages = buildMessages(payload, message);
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

  return reply.trim();
}

function buildMessages(payload, message) {
  const prompt =
    payload?.prompt ||
    "You are Sale Assist. Greet visitors, ask for their name, answer clearly, and help the business owner follow up.";
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
      content: `${prompt}\n\nCurrent visitor name: ${visitorName}.\nKeep replies concise, warm, and useful. If the visitor name is unknown, ask for their name before going deeper.`
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
