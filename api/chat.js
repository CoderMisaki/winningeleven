import fs from "fs";
import path from "path";

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

  // Mengambil API Key dari ENV 'luna5_6' di Vercel
  const apiKey = process.env.luna5_6 || process.env['luna5.6'];
  if (!apiKey) {
    return res.status(500).json({
      error: 'API Key luna5_6 belum dikonfigurasi di Environment Variables Vercel.'
    });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Invalid content type. Must be application/json' });
  }

  const { messages, attachment, mode } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid payload: messages must be an array' });
  }

  if (messages.length > 50) {
    return res.status(400).json({ error: 'Invalid payload: too many messages' });
  }

  const validRoles = ['user', 'assistant'];
  const sanitizedMessages = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (!validRoles.includes(msg.role)) continue;
    if (typeof msg.content !== 'string') continue;

    if (msg.content.length > 30000) {
      return res.status(400).json({ error: 'Message content too long' });
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

  // Handle attachment gambar jika ada (Format Vision OpenAI)
  if (attachment && attachment.base64 && attachment.mimeType) {
    const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content = [
        { type: "text", text: lastMsg.content || "" },
        {
          type: "image_url",
          image_url: {
            url: `data:${attachment.mimeType};base64,${attachment.base64}`
          }
        }
      ];
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await fetch('https://ai.geraikita.com/v1/claude/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        messages: sanitizedMessages,
        temperature: 0.7,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Geraikita API Error:", response.status, errText);
      res.write(`data: ${JSON.stringify({ error: `API Error (${response.status}): Gagal memproses ke server AI.` })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let sentContent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.replace(/^data: /, '').trim();
        if (dataStr === '[DONE]') {
          break;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const content = parsed.choices?.[0]?.delta?.content || '';

          if (content) {
            if (scanForSecrets(content)) {
              res.write(`data: ${JSON.stringify({ content: "[REDACTED: SENSITIVE INFORMATION DETECTED]" })}\n\n`);
              sentContent = true;
              break;
            }
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
            sentContent = true;
          }
        } catch (e) {
          // ignore partial json parsing
        }
      }
    }

    if (!sentContent) {
      res.write(`data: ${JSON.stringify({ error: "Model tidak menghasilkan balasan. Cek API Key atau status limit." })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("Stream Fetch Error:", err);
    res.write(`data: ${JSON.stringify({ error: `Koneksi gagal: ${err.message}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
