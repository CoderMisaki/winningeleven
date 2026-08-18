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

// Cache knowledge dengan batas aman (maks 15.000 karakter agar tidak over context)
let cachedKnowledge = "";
try {
  const knowledgePath = path.join(process.cwd(), 'src/js/knowledge.json');
  if (fs.existsSync(knowledgePath)) {
    const raw = fs.readFileSync(knowledgePath, 'utf8');
    cachedKnowledge = raw.length > 15000 ? raw.slice(0, 15000) + "\n...[Knowledge Truncated]" : raw;
  }
} catch (e) {
  console.error("Knowledge load info:", e.message);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Payload messages kosong atau tidak valid.' });
  }

  // 1. Susun System Prompt
  let systemContent = "You are an AI assistant for the WE10 Memory Research System.\n";
  if (mode === 'coding') {
    systemContent += "MODE CODING: Anda adalah ahli pemrograman tingkat dewa. Berikan kode LENGKAP dalam markdown code block.\n";
  } else if (mode === 'bola') {
    systemContent += "MODE BOLA: Anda adalah ahli sepak bola global. Berikan data akurat dan gunakan markdown rapi.\n";
  } else {
    systemContent += "MODE NORMAL: Jawablah dengan wajar, ringkas, dan profesional. Gunakan format Markdown standar.\n";
  }

  if (cachedKnowledge && (mode === 'normal' || !mode)) {
    systemContent += "\n[KNOWLEDGE BASE]\n" + cachedKnowledge + "\n";
  }

  // 2. Sanitasi & Perbaiki Urutan Pesan
  const sanitizedMessages = [{ role: 'system', content: systemContent }];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (typeof msg.content !== 'string' || !msg.content.trim()) continue;

    if (msg.role === 'user' && checkPromptInjection(msg.content)) {
      return res.status(403).json({
        error: "Security Violation: Malicious prompt detected."
      });
    }

    // Pastikan tidak ada role duplikat yang berurutan
    const last = sanitizedMessages[sanitizedMessages.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + msg.content;
    } else {
      sanitizedMessages.push({
        role: msg.role,
        content: msg.content
      });
    }
  }

  if (sanitizedMessages.length <= 1) {
    return res.status(400).json({ error: 'Tidak ada pesan yang valid untuk dikirim.' });
  }

  // Handle attachment jika ada gambar
  if (attachment && attachment.base64 && attachment.mimeType && attachment.mimeType.startsWith('image/')) {
    const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content = [
        { type: "text", text: typeof lastMsg.content === 'string' ? lastMsg.content : "" },
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
        max_tokens: 8192,
        temperature: 0.7,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Upstream Error:", response.status, errText);

      // Ekstrak pesan detail error asli dari Geraikita
      let detailMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        detailMsg = parsed.error?.message || parsed.message || errText;
      } catch (_) {}

      res.write(`data: ${JSON.stringify({ error: `Geraikita API (${response.status}): ${detailMsg}` })}\n\n`);
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
        if (dataStr === '[DONE]') break;

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
        } catch (e) {}
      }
    }

    if (!sentContent) {
      res.write(`data: ${JSON.stringify({ error: "Server tidak mengirimkan teks jawaban. Periksa sisa kuota token harian Anda." })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("Fetch Exception:", err);
    res.write(`data: ${JSON.stringify({ error: `Gagal terhubung ke AI: ${err.message}` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
