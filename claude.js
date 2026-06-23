// /api/claude.js
// Vercel Serverless Function — secure proxy to Groq's FREE API.
// Groq requires NO credit card / billing setup for its free tier.
// The API key lives ONLY on the server (Vercel Environment Variable),
// never exposed to the browser.
//
// IMPORTANT: This endpoint accepts the SAME request shape the frontend
// already sends (Anthropic-style { messages, max_tokens, model }) and
// returns the SAME response shape ({ content: [{type:'text', text}] }),
// so no frontend code needs to change. Internally it translates to/from
// Groq's OpenAI-compatible API format.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing GROQ_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    const { messages, max_tokens } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'Missing "messages" in request body.' });
    }

    // Convert Anthropic-style messages -> OpenAI-style messages (Groq uses
    // the OpenAI chat format). Note: Groq's free text models do NOT support
    // image/PDF input the way Claude/Gemini vision does — if a message
    // contains an image/document block, we extract any accompanying text
    // instruction and let the model work from that alone.
    const oaiMessages = messages.map(m => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (typeof m.content === 'string') {
        return { role, content: m.content };
      }
      if (Array.isArray(m.content)) {
        const textParts = m.content.filter(b => b.type === 'text').map(b => b.text);
        const hasMedia = m.content.some(b => b.type === 'image' || b.type === 'document');
        let combined = textParts.join('\n');
        if (hasMedia) {
          combined += '\n\n[Note: A file was attached, but this free model cannot read images/PDFs directly. Working from any text provided above only.]';
        }
        return { role, content: combined || ' ' };
      }
      return { role, content: ' ' };
    });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: max_tokens || 1000,
        messages: oaiMessages
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({
        error: data.error?.message || 'Groq API request failed.'
      });
    }

    const text = data.choices?.[0]?.message?.content || '';

    // Return in the same shape the frontend already expects
    return res.status(200).json({
      content: [{ type: 'text', text }]
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
