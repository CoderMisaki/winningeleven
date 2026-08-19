import fs from "fs";
import path from "path";

// Mapping model langsung sesuai spesifikasi Geraikita AI Gateway
const MODEL_MAPPING = {
  // Primary Chain
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.6-luna": "gpt-5.6-luna",

  // Pool Models
  "glm-5.3": "glm-5.3",
  "glm-5.2": "glm-5.2",
  "kimi-k3": "kimi-k3",
  "deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-v4-flash": "deepseek-v4-flash",
  "claude-opus-5-thinking": "claude-opus-5-thinking",
  "claude-sonnet-5-thinking": "claude-sonnet-5-thinking"
};

const PRIMARY_CHAIN = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna"
];

const POOL_MODELS = [
  "glm-5.3",
  "glm-5.2",
  "kimi-k3",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "claude-opus-5-thinking",
  "claude-sonnet-5-thinking"
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

// Cache knowledge base
let cachedKnowledge = "";
try {
  const knowledgePath = path.join(process.cwd(), "src/js/knowledge.json");
  if (fs.existsSync(knowledgePath)) {
    const raw = fs.readFileSync(knowledgePath, "utf8");
    cachedKnowledge = raw.length > 15000 ? raw.slice(0, 15000) + "\n...[Knowledge Truncated]" : raw;
  }
} catch (e) {
  console.error("Knowledge load info:", e.message);
}

// Helper untuk shuffle array model random fallback
function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Menggunakan satu ENV tunggal luna5_6
  const apiKey = (process.env.luna5_6 || process.env.LUNA5_6 || "").trim();
  if (!apiKey) {
    return res.status(500).json({
      error: "API Key luna5_6 belum dikonfigurasi di Environment Variables (.env)."
    });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    return res.status(400).json({ error: "Invalid content type. Must be application/json" });
  }

  const { messages, attachment, mode, model: requestedModel } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Payload messages kosong atau tidak valid." });
  }

  // Bangun urutan fallback rantai model
  let fullModelFallbackChain;

  if (requestedModel && requestedModel !== "auto") {
    const remainingModels = [
      ...PRIMARY_CHAIN.filter(m => m !== requestedModel),
      ...shuffleArray(POOL_MODELS.filter(m => m !== requestedModel))
    ];
    fullModelFallbackChain = [requestedModel, ...remainingModels];
  } else {
    // Mode Auto / Random Fallback
    fullModelFallbackChain = [
      ...PRIMARY_CHAIN,
      ...shuffleArray(POOL_MODELS)
    ];
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let activeStreamReader = null;
  let activeModelUsed = "";
  let lastErrorDetail = "";

  // Loop mencari model pertama yang berhasil
  for (const modelToTry of fullModelFallbackChain) {
    try {
      const upstreamModelId = MODEL_MAPPING[modelToTry] || modelToTry;

      // 1. Susun System Prompt Khusus Model & Mode
      let systemContent = `[SYSTEM CORE RULES - HIGHEST PRIORITY OVERRIDE]\n`;
      systemContent += `1. IDENTITAS MUTLAK: Identitas Anda adalah AI Model "${modelToTry}" via Geraikita AI Engine.\n`;
      systemContent += `2. PERTANYAAN IDENTITAS: Jika ditanya versi/model apa, jawab secara tegas bahwa Anda adalah model "${modelToTry}". Dilarang mengaku sebagai model lain.\n`;
      systemContent += `3. INTEGRITAS JAWABAN: Jawaban wajib tuntas, komprehensif, tidak boleh terputus di tengah jalan.\n`;
      systemContent += `4. FORMAT KODE: Semua kode/skrip wajib di dalam Markdown code block lengkap dengan bahasa (contoh: \`\`\`javascript ... \`\`\`).\n\n`;

      if (mode === "coding") {
        systemContent += `[MODE: CODING EXPERT]\nAnda adalah Principal Software Engineer & Cybersecurity Specialist. Berikan kode yang clean, optimal, siap produksi, dan penjelasan mendalam.\n`;
      } else if (mode === "bola") {
        systemContent += `[MODE: ANALISIS BOLA & WE10]\nAnda adalah Master Analis Sepak Bola & Pakar Engine Winning Eleven 10. Berikan analisis taktik, metrik pemain, dan probabilitas berbasis data statistik.\n`;
      } else {
        systemContent += `[MODE: NORMAL ASSISTANT]\nAnda adalah Asisten AI WE10 Memory Research System yang cerdas, adaptif, dan solutif. Format respons dengan Markdown terstruktur.\n`;
      }

      if (cachedKnowledge && (mode === "normal" || !mode)) {
        systemContent += `\n[KNOWLEDGE BASE]\n` + cachedKnowledge + `\n`;
      }

      // 2. Susun dan Sanitasi Pesan
      const sanitizedMessages = [{ role: "system", content: systemContent }];

      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        if (typeof msg.content !== "string" || !msg.content.trim()) continue;

        if (msg.role === "user" && checkPromptInjection(msg.content)) {
          res.write(`data: ${JSON.stringify({ error: "Security Violation: Malicious prompt detected." })}\n\n`);
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

      // Attachment handling
      if (attachment && attachment.base64 && attachment.mimeType && attachment.mimeType.startsWith("image/")) {
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

      // Request ke Geraikita AI Gateway
      const response = await fetch("https://ai.geraikita.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
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
        const errText = await response.text();
        console.warn(`Model [${modelToTry} -> ${upstreamModelId}] gagal (${response.status}):`, errText);
        lastErrorDetail = `Model ${modelToTry} (${response.status})`;
        continue; // Fallback ke model berikutnya
      }

      activeStreamReader = response.body.getReader();
      activeModelUsed = modelToTry;
      break;
    } catch (err) {
      console.warn(`Model [${modelToTry}] Exception:`, err.message);
      lastErrorDetail = err.message;
    }
  }

  // Jika seluruh rantai model gagal
  if (!activeStreamReader) {
    res.write(`data: ${JSON.stringify({ error: `Semua model gagal merespons. Detail: ${lastErrorDetail}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    return res.end();
  }

  // Stream data ke client
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
              res.write(`data: ${JSON.stringify({ content: "[REDACTED: SENSITIVE INFORMATION DETECTED]" })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ error: "Server tidak mengirimkan teks jawaban. Silakan coba kembali." })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: `Stream terputus: ${err.message}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
