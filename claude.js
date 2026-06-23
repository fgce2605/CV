// /api/claude.js
// Vercel Serverless Function — secure proxy to Google Gemini's FREE API.
// The API key lives ONLY on the server (Vercel Environment Variable),
// never exposed to the browser.
//
// IMPORTANT: This endpoint accepts the SAME request shape the frontend
// already sends (Anthropic-style { messages, max_tokens, model }) and
// returns the SAME response shape ({ content: [{type:'text', text}] }),
// so no frontend code needs to change. Internally it translates to/from
// Gemini's API format.

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    const { messages, max_tokens } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'Missing "messages" in request body.' });
    }

    // Convert Anthropic-style messages -> Gemini "contents" format.
    // Supports plain text content AND multimodal content (image/document
    // blocks used by the resume-upload parser).
    const contents = messages.map(m => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      let parts;

      if (typeof m.content === 'string') {
        parts = [{ text: m.content }];
      } else if (Array.isArray(m.content)) {
        parts = m.content.map(block => {
          if (block.type === 'text') {
            return { text: block.text };
          }
          if (block.type === 'image' || block.type === 'document') {
            // Anthropic-style base64 block -> Gemini inlineData block
            return {
              inlineData: {
                mimeType: block.source?.media_type || 'application/octet-stream',
                data: block.source?.data || ''
              }
            };
          }
          return { text: '' };
        });
      } else {
        parts = [{ text: '' }];
      }
      return { role, parts };
    });

    const model = 'gemini-2.0-flash'; // fast + free-tier friendly
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: max_tokens || 1000
          }
        })
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({
        error: data.error?.message || 'Gemini API request failed.'
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    // Return in the same shape the frontend already expects
    return res.status(200).json({
      content: [{ type: 'text', text }]
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
