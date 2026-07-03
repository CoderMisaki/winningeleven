import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }


  const apiKey = process.env.minimax3;
  const geminiKey = process.env.gemini35;
  const { messages, attachment } = req.body;

  if (!apiKey && !geminiKey) {
    return res.status(500).json({ error: 'API keys not configured' });
  }

  // Security Audit: Validate messages payload to prevent abuse
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid payload: messages must be an array' });
  }

  if (messages.length > 50) {
    return res.status(400).json({ error: 'Invalid payload: too many messages' });
  }


  const validRoles = ['user', 'assistant', 'system'];

  const sanitizedMessages = [];

  // Inject Knowledge Context
  let systemContent = "You are an AI assistant for the WE10 Memory Research System. PENTING: Berikan jawaban dalam teks biasa (plain text), jangan gunakan format markdown seperti ** (cetak tebal) atau * (cetak miring). Pastikan jawaban yang kamu berikan SELALU TUNTAS, LENGKAP 100%, DAN JANGAN PERNAH TERPOTONG DI TENGAH KALIMAT ATAU PARAGRAF. Hasilkan jawaban yang utuh dari awal sampai akhir.";
  try {
    const knowledgePath = path.join(process.cwd(), 'src/js/knowledge.json');
    if (fs.existsSync(knowledgePath)) {
      const knowledgeData = fs.readFileSync(knowledgePath, 'utf8');
      systemContent += `\n\nHere is the knowledge data you must remember and use to answer questions:\n\n${knowledgeData}`;
    }
  } catch (err) {
    console.error('Failed to load knowledge.json:', err);
  }

  sanitizedMessages.push({
    role: 'system',
    content: systemContent
  });

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

    if (msg.content.length > 4000) {
      return res.status(400).json({ error: 'Invalid payload: message content too long' });
    }

    sanitizedMessages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Fallback function to call Gemini API
  async function callGemini(messagesToPass, fileAttachment = null) {
    try {
      if (!geminiKey) {
          throw new Error('Gemini API key not configured.');
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      let systemPrompt = "";
      let historyTexts = [];
      let lastUserMsg = "";

      for (const m of messagesToPass) {
          if (m.role === 'system') systemPrompt += m.content + "\n";
          else if (m.role === 'user') lastUserMsg = m.content;
          historyTexts.push(`${m.role}: ${m.content}`);
      }

      if (fileAttachment) {
          const inputArr = [
              { type: "text", text: `\n\nSystem Context:\n${systemPrompt}\n\nChat History:\n${historyTexts.join('\n')}\n\nCurrent Request: ${lastUserMsg}` },
              { type: fileAttachment.type, data: fileAttachment.base64, mime_type: fileAttachment.mimeType }
          ];
          const interaction = await ai.interactions.create({
              model: "gemini-3.5-flash",
              input: inputArr,
          });
          return { choices: [{ message: { content: interaction.output_text } }] };
      } else {
          // No attachment fallback
          const combinedPrompt = `System Context:\n${systemPrompt}\n\nChat History:\n${historyTexts.join('\n')}\n\nCurrent Request: ${lastUserMsg}`;
          const response = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: combinedPrompt
          });
          return { choices: [{ message: { content: response.text } }] };
      }
    } catch (err) {
        console.error("Gemini Fallback Error:", err);
        throw err;
    }
  }

  if (attachment) {
      try {
          const result = await callGemini(sanitizedMessages, attachment);
          return res.status(200).json(result);
      } catch (err) {
          return res.status(200).json({ choices: [{ message: { content: "Mohon maaf, sistem AI sedang mengalami gangguan. Silakan coba beberapa saat lagi." } }] });
      }
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'minimaxai/minimax-m3',
        messages: sanitizedMessages,
        max_tokens: 8192,
        temperature: 0.70,
        top_p: 0.95,
        stream: false
      })
    });

    if (!response.ok) {
      console.warn("NVIDIA API Failed, falling back to Gemini...");
      try {
          const fallbackResult = await callGemini(sanitizedMessages);
          return res.status(200).json(fallbackResult);
      } catch (fallbackErr) {
          const errorText = await response.text();
          return res.status(200).json({ choices: [{ message: { content: "Mohon maaf, sistem AI sedang mengalami gangguan. Silakan coba beberapa saat lagi." } }] });
      }
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.warn('Error proxying request, falling back to Gemini:', error);
    try {
        const fallbackResult = await callGemini(sanitizedMessages);
        return res.status(200).json(fallbackResult);
    } catch (fallbackErr) {
        return res.status(200).json({ choices: [{ message: { content: "Mohon maaf, sistem AI sedang mengalami gangguan. Silakan coba beberapa saat lagi." } }] });
    }
  }
}
