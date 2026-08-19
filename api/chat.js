import fs from "fs";
import path from "path";

const GATEWAY_API_KEY = "gk-beeb4c9f68cf17a8d2daf07af5c15d4d667eb604b7a7fe2b";

const MODEL_MAPPING = {
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.6-luna": "gpt-5.6-luna",
  "glm-5.3": "glm-5.3",
  "glm-5.2": "glm-5.2",
  "kimi-k3": "kimi-k3",
  "deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-v4-flash": "deepseek-v4-flash",
  "claude-opus-5-thinking": "claude-opus-5-thinking",
  "claude-sonnet-5-thinking": "claude-sonnet-5-thinking"
};

const PRIMARY_CHAIN = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const POOL_MODELS = [
  "glm-5.3", "glm-5.2", "kimi-k3",
  "deepseek-v4-pro", "deepseek-v4-flash",
  "claude-opus-5-thinking", "claude-sonnet-5-thinking"
];

function checkPromptInjection(text) {
  const lower = text.toLowerCase();
  const blockedPhrases = [
    "ignore previous instructions", "system prompt", "show hidden prompt",
    "print source", "dump project", "reveal memory", "bypass security",
    "roleplay admin", "developer message", "process.env"
  ];
  return blockedPhrases.some(phrase => lower.includes(phrase));
}

function scanForSecrets(text) {
  const blockedPatterns = [
    /process\.env\s*\.\s*[A-Za-z0-9_.]+/i,
    /process\.env\s*\[\s*['"][A-Za-z0-9_.]+['"]\s*\]/i,
    /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}={0,2}/i,
    /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9\-._~+/]{16,}['"]/i,
    /\bsk-[A-Za-z0-9]{16,}\b/i,
    /\bgk-[A-Za-z0-9]{16,}\b/i
  ];
  return blockedPatterns.some(pattern => pattern.test(text));
}

function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function parseStatusCodeReason(status) {
  switch (status) {
    case 400:
      return "Bad Request (400): Payload atau format pesan ditolak model.";
    case 401:
      return "Unauthorized (401): API Key ditolak oleh Geraikita Gateway.";
    case 403:
      return "Forbidden (403): Akses ke endpoint atau model dibatasi.";
    case 404:
      return "Not Found (404): Rute atau model upstream tidak ditemukan.";
    case 429:
      return "Rate Limit Exceeded (429): Batas kuota atau request per menit habis.";
    case 500:
    case 502:
    case 503:
    case 504:
      return `Server Gateway Error (${status}): Server upstream sedang overload/down.`;
    default:
      return `HTTP Error (${status}): Terjadi kesalahan tak terduga dari gateway.`;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "[HTTP 405] Method Not Allowed" });
  }

  const { messages, attachment, mode, model: requestedModel } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "[INVALID PAYLOAD]: Messages wajib diisi." });
  }

  let fullModelFallbackChain;
  if (requestedModel && requestedModel !== "auto") {
    const remainingModels = [
      ...PRIMARY_CHAIN.filter(m => m !== requestedModel),
      ...shuffleArray(POOL_MODELS.filter(m => m !== requestedModel))
    ];
    fullModelFallbackChain = [requestedModel, ...remainingModels];
  } else {
    fullModelFallbackChain = [...PRIMARY_CHAIN, ...shuffleArray(POOL_MODELS)];
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let activeStreamReader = null;
  let activeModelUsed = "";
  const failureAuditLogs = [];

  for (const modelToTry of fullModelFallbackChain) {
    const upstreamModelId = MODEL_MAPPING[modelToTry] || modelToTry;

    try {
      let systemContent = `[SYSTEM CORE RULES]\n1. Identitas: AI Model "${modelToTry}" via Geraikita Engine.\n2. Jawab pertanyaan identitas model sebagai "${modelToTry}".\n\n`;
      if (mode === "coding") {
        systemContent += `[MODE: CODING EXPERT]\nFokus pada solusi kode bersih & aman.\n`;
      } else if (mode === "bola") {
        systemContent += `[MODE: WE10 EXPERT]\nPakar taktik, data tim, dan analisa Winning Eleven 10.\n`;
      }

      const sanitizedMessages = [{ role: "system", content: systemContent }];

      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        if (typeof msg.content !== "string" || !msg.content.trim()) continue;

        if (msg.role === "user" && checkPromptInjection(msg.content)) {
          res.write(`data: ${JSON.stringify({ error: "Prompt injection terdeteksi." })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          return res.end();
        }

        const last = sanitizedMessages[sanitizedMessages.length - 1];
        if (last && last.role === msg.role) {
          last.content += "\n\n" + msg.content;
        } else {
          sanitizedMessages.push({ role: msg.role, content: msg.content });
        }
      }

      if (attachment?.base64 && attachment?.mimeType?.startsWith("image/")) {
        const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          lastMsg.content = [
            { type: "text", text: typeof lastMsg.content === "string" ? lastMsg.content : "" },
            {
              type: "image_url",
              image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` }
            }
          ];
        }
      }

      const response = await fetch("https://ai.geraikita.com/v1/claude/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GATEWAY_API_KEY}`
        },
        body: JSON.stringify({
          model: upstreamModelId,
          messages: sanitizedMessages,
          max_tokens: 8192,
          temperature: 0.7,
          stream: true
        })
      });

      if (!response.ok) {
        const rawErrText = await response.text();
        const reason = parseStatusCodeReason(response.status);

        failureAuditLogs.push({
          model: modelToTry,
          status: response.status,
          reason,
          detail: rawErrText.slice(0, 200),
          timestamp: new Date().toISOString()
        });
        continue;
      }

      activeStreamReader = response.body.getReader();
      activeModelUsed = modelToTry;
      break;
    } catch (err) {
      failureAuditLogs.push({
        model: modelToTry,
        status: "NETWORK_FAIL",
        reason: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Jika seluruh model fallback gagal
  if (!activeStreamReader) {
    res.write(`data: ${JSON.stringify({
      error: "Gagal menghubungkan ke AI Gateway.",
      auditLogs: failureAuditLogs
    })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    return res.end();
  }

  // Stream output response
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let sentContent = false;

  try {
    while (true) {
      const { done, value } = await activeStreamReader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const dataStr = trimmed.replace(/^data: /, "").trim();
        if (dataStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(dataStr);
          // Tangkap teks dari beragam format payload AI Gateway
          const content =
            parsed.choices?.[0]?.delta?.content ??
            parsed.choices?.[0]?.delta?.text ??
            parsed.choices?.[0]?.text ??
            parsed.delta?.text ??
            (parsed.type === "content_block_delta" ? parsed.delta?.text : "") ??
            "";

          if (content) {
            if (scanForSecrets(content)) {
              res.write(`data: ${JSON.stringify({ content: "[REDACTED]" })}\n\n`);
              sentContent = true;
              break;
            }
            res.write(`data: ${JSON.stringify({ content, model: activeModelUsed })}\n\n`);
            sentContent = true;
          }
        } catch (_) {}
      }
    }

    if (!sentContent) {
      res.write(`data: ${JSON.stringify({
        error: "Gateway terhubung tetapi tidak mengirim token output.",
        auditLogs: [{ model: activeModelUsed, status: 204, reason: "Response body stream kosong dari upstream." }]
      })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({
      error: `Stream terputus: ${err.message}`,
      auditLogs: [{ model: activeModelUsed, status: 500, reason: err.message }]
    })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
