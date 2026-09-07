// 다수 전문가 협의 HITL — 회의록(텍스트) → 합의 의견 추출 → meeting_feedback 저장
// LLM 우선, 실패(크레딧 부족·키 부재) 시 규칙 기반 폴백으로 항상 결과 생성.
// (오디오 STT는 준비중 — 텍스트 회의록 입력으로 시작)

const SUPABASE_URL = 'https://mwkdtasjkktqqlqefdhr.supabase.co';

// 규칙 기반: 문장 단위로 쪼개 의미있는 후보를 합의 의견 항목으로
function ruleBasedPoints(transcript) {
  const raw = String(transcript || '')
    .split(/[\n。.!?！？]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 12);
  const seen = {};
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!seen[s]) { seen[s] = 1; out.push(s); }
    if (out.length >= 8) break;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.' });

  const body = req.body || {};
  const title = (body.title || '').toString().slice(0, 200) || null;
  const transcript = (body.transcript || '').toString();
  if (transcript.trim().length < 10) return res.status(400).json({ error: '회의록 텍스트가 필요합니다(10자 이상).' });

  try {
    // 1. 협의 의견 추출 (LLM 우선)
    let points = [];
    let method = 'llm';
    if (ANTHROPIC) {
      try {
        const genPrompt = `다음은 다수의 ESG 전문가가 함께 진행한 검토 회의의 회의록이다. 개별 발언이 아니라, 논의를 통해 '합의된 개선 의견'만 3~8개 항목으로 요약하라. 각 항목은 실행 가능한 한 문장으로. 반드시 JSON 문자열 배열로만 출력하고 다른 설명은 넣지 마라.\n\n[회의록]\n${transcript}`;
        const a = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: genPrompt }] }),
        });
        if (a.ok) {
          const aData = await a.json();
          const t = (aData.content || []).map(c => c.text || '').join('\n').trim();
          const m = t.match(/\[[\s\S]*\]/);
          if (m) {
            const arr = JSON.parse(m[0]);
            if (Array.isArray(arr)) points = arr.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
          }
        }
      } catch (_) { /* 폴백으로 진행 */ }
    }
    if (!points.length) { points = ruleBasedPoints(transcript); method = 'rule'; }
    if (!points.length) return res.status(400).json({ error: '회의록에서 의견을 추출하지 못했습니다.' });

    // 2. meeting_feedback 저장 (service role)
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/meeting_feedback`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        title: title,
        source: 'meeting_text',
        transcript: transcript,
        points: points,
        n_points: points.length,
        method: method,
        status: 'active',
      }),
    });
    if (!ins.ok) return res.status(502).json({ error: 'meeting_feedback 저장 실패: ' + (await ins.text()) });
    const created = await ins.json();

    return res.status(200).json({ ok: true, n_points: points.length, method: method, record: created[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
