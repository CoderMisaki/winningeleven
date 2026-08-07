import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

function checkPromptInjection(text) {
  const lower = text.toLowerCase();
  const blockedPhrases = [
      "ignore previous instructions", "system prompt", "show hidden prompt",
      "print source", "dump project", "reveal memory", "bypass security",
      "roleplay admin", "developer message", "process.env"
  ];
  for (const phrase of blockedPhrases) {
      if (lower.includes(phrase)) {
          return true;
      }
  }
  return false;
}

function scanForSecrets(text) {
  const blockedPatterns = [
      "process.env", "API_KEY", "JWT", "Bearer", "knowledge.json",
      "system prompt", "router source", "hidden endpoint", "database credential"
  ];
  for (const pattern of blockedPatterns) {
      if (text.includes(pattern)) {
          return true;
      }
  }
  return false;
}

let streamStarted = false;
let cachedKnowledge = "";
try {
  const knowledgePath = path.join(process.cwd(), 'src/js/knowledge.json');
  if (fs.existsSync(knowledgePath)) {
    cachedKnowledge = fs.readFileSync(knowledgePath, 'utf8');
  }
} catch (e) {
  console.error("Failed to pre-cache knowledge.json", e);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Deep Payload Validation (Defense-in-Depth)
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Invalid content type. Must be application/json' });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body payload' });
  }

  const apiKey = process.env.minimax3;
  const geminiKey = process.env.gemini35;
  const glmKey = process.env.glm52;

  const { messages, attachment, mode } = req.body;

  if (!apiKey && !geminiKey && !glmKey) {
    return res.status(500).json({ error: 'API keys not configured' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid payload: messages must be an array' });
  }

  if (messages.length > 50) {
    return res.status(400).json({ error: 'Invalid payload: too many messages' });
  }

  const validRoles = ['user', 'assistant'];
  const sanitizedMessages = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({ error: 'Invalid payload: message must be an object' });
    }

    if (!validRoles.includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid payload: invalid role' });
    }

    if (typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid payload: content must be a string' });
    }

    if (msg.content.length > 30000) {
      return res.status(400).json({ error: 'Invalid payload: message content too long' });
    }

    if (msg.role === 'user' && checkPromptInjection(msg.content)) {
      return res.status(403).json({
        error: "Security Violation: Malicious prompt detected and blocked."
      });
    }

    sanitizedMessages.push({
      role: msg.role,
      content: msg.content
    });
  }

  let systemContent = "You are an AI assistant for the WE10 Memory Research System.\n";
  if (mode === 'coding') {
    systemContent += "MODE CODING: Anda adalah ahli pemrograman tingkat dewa. Berikan jawaban dengan menyertakan kode dalam format markdown code block (```language ... ```). Berikan jawaban LENGKAP dan PASTIKAN KODE TIDAK PERNAH TERPOTONG. TULIS SAMPAI SELESAI.\n";
  } else if (mode === 'bola') {
    systemContent += "MODE BOLA: Anda adalah ahli sepak bola global. Gunakan format Markdown standar untuk mempercantik jawaban (bold, list, tabel). Anda boleh dan harus menjawab SEMUA pertanyaan tentang sepak bola.\n";
  } else {
    systemContent += "MODE NORMAL: Jawablah dengan wajar dan profesional. Gunakan format Markdown standar (seperti **bold**, *italic*, ## heading, dan list). Jika memberikan kode atau struktur data, SELALU gunakan fenced code block (```language ... ```).\n";
  }

  if (cachedKnowledge && (mode === 'normal' || !mode)) {
       systemContent += "\n[KNOWLEDGE BASE]\n" + cachedKnowledge + "\n";
  }

  sanitizedMessages.unshift({ role: 'system', content: systemContent });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 1. Fungsi Eksekutor Streaming Google Gemini (Fallback 1 / Attachment Handler)
  const callGemini = async (messagesToPass, fileAttachment = null) => {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const geminiMessages = messagesToPass.map(m => {
          if (m.role === 'system') return { role: 'user', parts: [{ text: "SYSTEM INSTRUCTION (OBEY): " + m.content }] };
          return { role: m.role, parts: [{ text: m.content }] };
      });

      if (fileAttachment) {
          geminiMessages[geminiMessages.length - 1].parts.push({
              inlineData: {
                  data: fileAttachment.base64,
                  mimeType: fileAttachment.mimeType
              }
          });
      }

      const response = await ai.models.generateContentStream({
          model: 'gemini-3.5-flash',
          contents: geminiMessages,
      });

      const decoder = new TextDecoder("utf-8");
      streamStarted = true;
      let aborted = false;

      for await (const chunk of response.stream) {
          if (aborted) break;
          const chunkText = chunk.text();
          if (scanForSecrets(chunkText)) {
              res.write(`data: ${JSON.stringify({ content: "[REDACTED: SENSITIVE INFORMATION DETECTED]" })}\n\n`);
              res.write(`data: [DONE]\n\n`);
              aborted = true;
              break;
          } else {
              res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
          }
      }

      if (aborted) {
          try {
            res.end();
          } catch (_) {}
          return;
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (err) {
        console.error("Gemini Fallback Error:", err);
        res.write(`data: ${JSON.stringify({ error: "Mohon maaf, semua sistem AI sedang sibuk. Silakan coba lagi." })}\n\n`);
        res.end();
    }
  };

  let safeAttachment = null;

  if (attachment && typeof attachment === "object") {
    if (typeof attachment.base64 !== "string" || attachment.base64.length === 0) {
      return res.status(400).json({ error: "Invalid attachment payload" });
    }

    if (attachment.base64.length > 8_000_000) {
      return res.status(400).json({ error: "Attachment too large" });
    }

    safeAttachment = {
      base64: attachment.base64,
      mimeType: typeof attachment.mimeType === "string"
        ? attachment.mimeType
        : "application/octet-stream"
    };
  }

  if (safeAttachment) {
    return callGemini(sanitizedMessages, safeAttachment);
  }

  // 2. Fungsi Eksekutor Streaming Nvidia (Bisa dipakai MiniMax & GLM)
  async function streamNvidiaAPI(modelName, authKey, messagesToPass) {
    const maxRetries = 3;
    let baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: messagesToPass,
            temperature: 0.7,
            top_p: 1,
            max_tokens: 8192,
            stream: true
          }),
        });

        if (!response.ok) {
           if (response.status === 429 || response.status >= 500) {
               throw new Error(`Nvidia API Temporary Error: ${response.status}`);
           }
           throw new Error(`Nvidia API Error: ${response.statusText}`);
        }

        streamStarted = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let aborted = false;
        let buffer = "";

        while (true) {
          if (aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;

            if (!line.startsWith("data: ")) continue;

            const dataStr = line.replace(/^data: /, "").trim();

            if (dataStr === "[DONE]") {
              res.write(`data: [DONE]\n\n`);
              aborted = true;
              break;
            }

            try {
              const parsed = JSON.parse(dataStr);

              const content = parsed.choices?.[0]?.delta?.content;

              if (!content) continue;

              if (scanForSecrets(content)) {
                res.write(
                  `data: ${JSON.stringify({
                    content: "[REDACTED: SENSITIVE INFORMATION DETECTED]"
                  })}\n\n`
                );

                res.write(`data: [DONE]\n\n`);
                aborted = true;
                break;
              }

              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            } catch (e) {
              console.error("Error parsing streaming JSON", e);
            }
          }
        }

        if (aborted) {
          try {
            await reader.cancel();
          } catch (_) {}

          try {
            res.end();
          } catch (_) {}

          return;
        }

        res.write(`data: [DONE]\n\n`);
        res.end();
        return; // Success
      } catch (err) {
         console.warn(`Attempt ${attempt} for ${modelName} failed:`, err.message);
         if (attempt === maxRetries) {
             throw err; // throw to trigger next fallback
         }
         // Exponential backoff
         await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt-1)));
      }
    }
  }

  // Orchestrator / Fallback Logic
  try {
    // Percobaan 1: MiniMax (Primary)
    if (!apiKey) throw new Error("MiniMax Key not available");
    await streamNvidiaAPI("minimax/minimax-01", apiKey, sanitizedMessages);
  } catch (error) {
    console.warn('MiniMax Failed. Falling back to GLM-4...', error.message);
    try {
      // Percobaan 2: GLM-4 (Secondary Fallback)
      if (!glmKey) throw new Error("GLM Key not available");
      await streamNvidiaAPI("zhipuai/glm-4-9b-chat", glmKey, sanitizedMessages);
    } catch (error2) {
      if (streamStarted) {
        console.warn("Stream error setelah output dimulai:", error2.message);

        try {
          res.write(`data: ${JSON.stringify({
            error: "Stream terputus. Silakan coba lagi."
          })}\n\n`);

          res.write(`data: [DONE]\n\n`);
          res.end();
        } catch (_) {}

        return;
      }

      console.warn(
        'MiniMax and GLM both failed. Ultimate Fallback to Gemini:',
        error2.message
      );

      return callGemini(sanitizedMessages);
    }
  }
}
