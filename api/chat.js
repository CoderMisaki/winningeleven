import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
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
  const { messages, attachment, mode } = req.body;

  if (!apiKey && !geminiKey && !glmKey) {
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
  let systemContent = "You are an AI assistant for the WE10 Memory Research System.\n";
  if (mode === 'coding') {
    systemContent += "MODE CODING: Anda adalah ahli pemrograman tingkat dewa. Berikan jawaban dengan menyertakan kode dalam format markdown code block (```language ... ```). Berikan jawaban LENGKAP dan PASTIKAN KODE TIDAK PERNAH TERPOTONG. TULIS SAMPAI SELESAI.\n";
  } else if (mode === 'bola') {
    systemContent += "MODE BOLA: Anda adalah ahli sepak bola global. Anda boleh dan harus menjawab SEMUA pertanyaan tentang sepak bola, pemain, taktik, sejarah, liga, meskipun tidak ada di database.\n";
  } else {
    systemContent += "MODE NORMAL: Jawablah dengan wajar. Jangan gunakan format markdown untuk cetak tebal/miring, tapi gunakan markdown code block (```) jika memang memberikan kode.\n";
  }
  systemContent += "SANGAT PENTING: Pastikan jawaban yang kamu berikan SELALU TUNTAS, LENGKAP 100%, DAN JANGAN PERNAH TERPOTONG DI TENGAH KALIMAT, KODE, ATAU PARAGRAF. HASILKAN JAWABAN YANG UTUH DARI AWAL SAMPAI AKHIR.\n";
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

  async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 60000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  }

  async function callMiniMax(messagesToPass, fileAttachment = null) {
    if (!apiKey) throw new Error('MiniMax API key not configured.');

    let finalMessages = [...messagesToPass];

    if (fileAttachment && fileAttachment.mimeType.startsWith('image/')) {
        // Find last user message
        const lastUserIdx = finalMessages.map(m => m.role).lastIndexOf('user');
        if (lastUserIdx !== -1) {
             const originalText = finalMessages[lastUserIdx].content;
             const dataUri = `data:${fileAttachment.mimeType};base64,${fileAttachment.base64}`;
             finalMessages[lastUserIdx] = {
                 role: 'user',
                 content: [
                     { type: "text", text: originalText },
                     { type: "image_url", image_url: { url: dataUri } }
                 ]
             };
        }
    }

    const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'minimaxai/minimax-m3',
        messages: finalMessages,
        max_tokens: 8192,
        temperature: 0.70,
        top_p: 0.95,
        stream: false
      }),
      timeout: 60000
    });

    if (!response.ok) {
        throw new Error(`MiniMax API failed with status ${response.status}`);
    }
    return await response.json();
  }

  async function callGLM(messagesToPass) {
    if (!glmKey) throw new Error('GLM API key not configured.');

    const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${glmKey}`
      },
      body: JSON.stringify({
        model: 'z-ai/glm-5.2',
        messages: messagesToPass,
        max_tokens: 16384,
        temperature: 1,
        top_p: 1,
        seed: 42,
        stream: false
      }),
      timeout: 60000
    });

    if (!response.ok) {
        throw new Error(`GLM API failed with status ${response.status}`);
    }
    return await response.json();
  }

  async function smartRouter(messagesToPass, fileAttachment = null) {
    let requestType = 'TEXT';
    if (fileAttachment) {
       if (fileAttachment.mimeType.startsWith('image/')) requestType = 'IMAGE';
       else if (fileAttachment.mimeType.startsWith('audio/')) requestType = 'AUDIO';
       else if (fileAttachment.mimeType.startsWith('video/')) requestType = 'VIDEO';
       else requestType = 'DOCUMENT';
    }

    console.log('[Router]');
    console.log(`Request Type : ${requestType}`);
    console.log('Primary : MiniMax M3');

    // Attempt 1: MiniMax
    try {
        const result = await callMiniMax(messagesToPass, fileAttachment);
        console.log('Model Used : MiniMax M3');
        return result;
    } catch (e) {
        console.warn('MiniMax failed.');

        if (requestType === 'TEXT') {
            console.log('Switching to GLM...');
            // Attempt 2: GLM
            try {
                const resultGLM = await callGLM(messagesToPass);
                console.log('Model Used : GLM 5.2');
                return resultGLM;
            } catch (e2) {
                console.warn('GLM failed.');
                console.log('Switching to Gemini...');
                // Attempt 3: Gemini
                try {
                   const resultGemini = await callGemini(messagesToPass, fileAttachment);
                   console.log('Model Used : Gemini 3.5 Flash');
                   return resultGemini;
                } catch (e3) {
                   console.warn('Gemini failed too.');
                }
            }
        } else {
            console.log('Switching to Gemini...');
            // Attempt 2: Gemini
            try {
                const resultGemini = await callGemini(messagesToPass, fileAttachment);
                console.log('Model Used : Gemini 3.5 Flash');
                return resultGemini;
            } catch (e2) {
                console.warn('Gemini failed too.');
            }
        }
    }

    return {
      choices: [
        {
          message: {
            content: "Mohon maaf, seluruh layanan AI sedang tidak tersedia. Silakan coba beberapa saat lagi."
          }
        }
      ]
    };
  }

  // Fallback function to call Gemini API
  async function callGemini(messagesToPass, fileAttachment = null) {
    try {
      if (!geminiKey) {
          throw new Error('Gemini API key not configured.');
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      let systemPrompt = "";
      let lastUserMsg = "";

      let geminiHistory = [];
      for (const m of messagesToPass) {
          if (m.role === 'system') {
              systemPrompt += m.content + "\n";
          } else if (m.role === 'user' || m.role === 'assistant') {
              // Note: Gemini API requires 'model' instead of 'assistant' in contents array if using history
              // But since we are using inlineData for images, we might just pass a formatted string of the whole history
              // Or use proper Gemini format. Since `contents` accepts a string for simple text generation:
              if (m.role === 'user') lastUserMsg = m.content;
              geminiHistory.push(`${m.role.toUpperCase()}: ${m.content}`);
          }
      }
      const fullPrompt = geminiHistory.join("\n\n");


      if (fileAttachment) {
          const response = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: [
                  { text: fullPrompt },

                  { inlineData: { data: fileAttachment.base64, mimeType: fileAttachment.mimeType } }
              ],
              config: {
                  systemInstruction: systemPrompt
              }
          });
          return { choices: [{ message: { content: response.text } }] };
      } else {
          const response = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: fullPrompt,
              config: {
                  systemInstruction: systemPrompt
              }
          });
          return { choices: [{ message: { content: response.text } }] };
      }
    } catch (err) {
        console.error("Gemini Fallback Error:", err);
        throw err;
    }
  }

  const routerResult = await smartRouter(sanitizedMessages, attachment);
  return res.status(200).json(routerResult);
}
