import fs from "fs";
import path from "path";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

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
    /\bnvapi-[A-Za-z0-9_-]{16,}\b/i
  ];
  return blockedPatterns.some(pattern => pattern.test(text));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "[HTTP 405] Method Not Allowed" });
  }

  const { messages, mode, model = DEFAULT_MODEL } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "[INVALID PAYLOAD]: Messages wajib diisi." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let systemContent = `[SYSTEM IDENTITY & MISSION]\nKamu adalah Senior Autonomous Software Engineer yang menggunakan model ${DEFAULT_MODEL}.\nFokus pada analisa kode mendalam, arsitektur bersih, dan eksekusi utuh tanpa placeholder.\n\n`;
    if (mode === "coding") {
      systemContent += `[MODE: AUTONOMOUS CODING AGENT]\nSelesaikan seluruh penulisan kode dalam satu alur terstruktur hingga pembuatan Pull Request siap dieksekusi.\n`;
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

      sanitizedMessages.push({ role: msg.role, content: msg.content });
    }

    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: sanitizedMessages,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        extra_body: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_budget: 16384
        },
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ error: `NVIDIA API Error (${response.status}): ${errText.slice(0, 300)}` })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const dataStr = trimmed.replace(/^data: /, "").trim();
        if (dataStr === "[DONE]") {
          res.write(`data: [DONE]\n\n`);
          return res.end();
        }

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoning = delta.reasoning_content || null;
          const content = delta.content || null;

          if (reasoning) {
            res.write(`data: ${JSON.stringify({ reasoning, model: DEFAULT_MODEL })}\n\n`);
          }

          if (content) {
            if (scanForSecrets(content)) {
              res.write(`data: ${JSON.stringify({ content: "[REDACTED_SECRET]", model: DEFAULT_MODEL })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ content, model: DEFAULT_MODEL })}\n\n`);
            }
          }
        } catch (_) {}
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: `Stream failure: ${err.message}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
