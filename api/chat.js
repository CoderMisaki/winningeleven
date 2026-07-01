export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.minimax3;
  const { messages } = req.body;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
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
        temperature: 1.00,
        top_p: 0.95,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `NVIDIA API Error: ${errorText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error proxying request:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
