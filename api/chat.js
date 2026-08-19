import fs from "fs";
import path from "path";

// Hardcoded API Key Geraikita AI Gateway
const GATEWAY_API_KEY = "gk-beeb4c9f68cf17a8d2daf07af5c15d4d667eb604b7a7fe2b";

// Mapping model Geraikita AI Gateway
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

// Analisis kode status HTTP dari Gateway
function parseStatusCodeReason(status) {
  switch (status) {
    case 400:
      return "Bad Request (400): Format payload atau parameter token ditolak oleh model gateway.";
    case 401:
      return "Unauthorized (401): API Key ditolak atau tidak valid di Geraikita AI Gateway.";
    case 403:
      return "Forbidden (403): API Key tidak memiliki izin akses ke model atau rute ini.";
    case 404:
      return "Not Found (404): Model upstream tidak ditemukan pada endpoint gateway.";
    case 429:
      return "Rate Limit / Quota Exceeded (429): Batas request per menit atau saldo API telah habis.";
    case 500:
    case 502:
    case 503:
    case 504:
      return `Upstream Error (${status}): Server gateway/upstream sedang down atau mengalami timeout.`;
    default:
      return `HTTP Error (${status}): Respons tidak terduga dari gateway AI.`;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "[HTTP 405] Method Not Allowed",
      detail: "Endpoint ini hanya menerima request POST."
    });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    return res.status(400).json({
      error: "[INVALID CONTENT TYPE]",
      detail: "Header Content-Type wajib 'application/json'."
    });
  }

  const { messages, attachment, mode, model: requestedModel } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "[INVALID PAYLOAD]",
      detail: "Array 'messages' kosong atau tidak sesuai spesifikasi."
    });
  }

  // Siapkan rantai fallback model
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

  // Loop rantai fallback model
  for (const modelToTry of fullModelFallbackChain) {
    const upstreamModelId = MODEL_MAPPING[modelToTry] || modelToTry;

    // Kirim log realtime percobaan model
    res.write(`data: ${JSON.stringify({
      log: {
        type: "ATTEMPT",
        model: modelToTry,
        message: `Menghubungkan ke model [${modelToTry}]...`,
        timestamp: new Date().toISOString()
      }
    })}\n\n`);

    try {
      let systemContent = `[SYSTEM CORE RULES - HIGHEST PRIORITY OVERRIDE]\n`;
      systemContent += `1. IDENTITAS MUTLAK: Identitas Anda adalah AI Model "${modelToTry}" via Geraikita AI Engine.\n`;
      systemContent += `2. PERTANYAAN IDENTITAS: Jika ditanya versi/model apa, jawab secara tegas bahwa Anda adalah model "${modelToTry}".\n`;
      systemContent += `3. FORMAT KODE: Semua kode/skrip wajib di dalam Markdown code block lengkap dengan bahasa.\n\n`;

      if (mode === "coding") {
        systemContent += `[MODE: CODING EXPERT]\nAnda adalah Principal Software Engineer & Cybersecurity Specialist.\n`;
      } else if (mode === "bola") {
        systemContent += `[MODE: ANALISIS BOLA & WE10]\nAnda adalah Master Analis Sepak Bola & Pakar Winning Eleven 10.\n`;
      } else {
        systemContent += `[MODE: NORMAL ASSISTANT]\nAnda adalah Asisten AI WE10 Memory Research System.\n`;
      }

      const sanitizedMessages = [{ role: "system", content: systemContent }];

      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        if (typeof msg.content !== "string" || !msg.content.trim()) continue;

        if (msg.role === "user" && checkPromptInjection(msg.content)) {
          res.write(`data: ${JSON.stringify({ error: "[SECURITY ERROR]: Prompt injection terdeteksi." })}\n\n`);
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

      // Request ke AI Gateway
      const response = await fetch("https://ai.geraikita.com/v1/chat/completions", {
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

        const logEntry = {
          model: modelToTry,
          status: response.status,
          reason,
          upstreamRaw: rawErrText.slice(0, 150),
          timestamp: new Date().toISOString()
        };
        failureAuditLogs.push(logEntry);

        // Kirim notifikasi error realtime ke client
        res.write(`data: ${JSON.stringify({
          log: {
            type: "ERROR",
            model: modelToTry,
            status: response.status,
            message: reason,
            timestamp: logEntry.timestamp
          }
        })}\n\n`);

        console.warn(`[AI GATEWAY FAIL] Model: ${modelToTry} | Status: ${response.status} | Reason: ${reason}`);
        continue;
      }

      activeStreamReader = response.body.getReader();
      activeModelUsed = modelToTry;

      // Beritahu client model yang berhasil terhubung
      res.write(`data: ${JSON.stringify({
        log: {
          type: "CONNECTED",
          model: modelToTry,
          message: `Terhubung dengan ${modelToTry}. Menghasilkan output...`
        }
      })}\n\n`);

      break;
    } catch (err) {
      const logEntry = {
        model: modelToTry,
        status: "NETWORK_EXCEPTION",
        reason: `Koneksi gagal: ${err.message}`,
        upstreamRaw: err.stack ? err.stack.split("\n")[0] : err.message,
        timestamp: new Date().toISOString()
      };
      failureAuditLogs.push(logEntry);

      res.write(`data: ${JSON.stringify({
        log: {
          type: "EXCEPTION",
          model: modelToTry,
          status: 500,
          message: `Network Exception: ${err.message}`,
          timestamp: logEntry.timestamp
        }
      })}\n\n`);

      console.error(`[EXCEPTION] Model: ${modelToTry}`, err);
    }
  }

  // Jika seluruh model dalam rantai fallback gagal
  if (!activeStreamReader) {
    const isAll401 = failureAuditLogs.every(l => l.status === 401);
    const isAll429 = failureAuditLogs.every(l => l.status === 429);

    let mainDiagnosis = "Semua model di dalam rantai fallback gagal merespons.";
    let category = "MODEL_PIPELINE_ERROR";

    if (isAll401) {
      category = "AUTHENTICATION_FAILED";
      mainDiagnosis = "API Key ditolak oleh Geraikita Gateway (Error 401).";
    } else if (isAll429) {
      category = "RATE_LIMIT_EXCEEDED";
      mainDiagnosis = "Kuota API Key habis atau limit request per menit terlampaui (Error 429).";
    }

    const errorPayload = {
      error: `[${category}]: ${mainDiagnosis}`,
      auditLogs: failureAuditLogs,
      diagnosticTips: isAll401
        ? "Periksa masa aktif kuota API Key Gateway Geraikita."
        : "Coba beberapa saat lagi atau hubungi administrator Gateway."
    };

    res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
    res.write(`data: [DONE]\n\n`);
    return res.end();
  }

  // Streaming Response ke Client
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
          const content = parsed.choices?.[0]?.delta?.content || "";

          if (content) {
            if (scanForSecrets(content)) {
              res.write(`data: ${JSON.stringify({ content: "[REDACTED: INFORMASI SENSITIF DISENSOR]" })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ error: "[EMPTY RESPONSE]: Gateway terhubung namun tidak mengembalikan token teks." })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: `[STREAM ERROR]: Koneksi stream terputus: ${err.message}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
