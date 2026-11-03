// 허용 출처: 본 플랫폼(운영·Vercel 미리보기)과 로컬 개발. 다른 사이트·스크립트가
// ANTHROPIC_API_KEY로 임의 프롬프트를 호출하지 못하게 한다. 추가 도메인은 ALLOWED_ORIGINS(쉼표 구분)로.
const ALLOWED_HOST = /^(esg-platform-v8(-[a-z0-9-]+)?\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
const MAX_TOKENS_CAP = 8000;

function allowedOrigin(req) {
  const src = req.headers.origin || req.headers.referer || '';
  let host = '';
  try { host = new URL(src).host; } catch (_) { return false; }
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ALLOWED_HOST.test(host) || extra.indexOf(host) !== -1;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!allowedOrigin(req)) return res.status(403).json({ error: '허용되지 않은 출처입니다.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { prompt, max_tokens = 8000 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: Math.min(Number(max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'API error' });
    }

    const text = data.content?.map(c => c.text || '').join('\n') || '';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

