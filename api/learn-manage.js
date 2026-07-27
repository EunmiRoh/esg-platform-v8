// 학습 디렉티브 관리 — 적용(apply) / 보류(hold) / 삭제(delete)
// 어드민 '학습 관리' 패널에서 호출. service_role로 stage5_learning을 갱신한다.

const SUPABASE_URL = 'https://mwkdtasjkktqqlqefdhr.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.' });

  const body = req.body || {};
  const action = body.action;
  const id = body.id;
  if (!id || ['apply', 'hold', 'delete'].indexOf(action) === -1) {
    return res.status(400).json({ error: 'action(apply|hold|delete)과 id가 필요합니다.' });
  }

  const headers = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const target = `${SUPABASE_URL}/rest/v1/stage5_learning?id=eq.${encodeURIComponent(id)}`;

  try {
    let r;
    if (action === 'delete') {
      r = await fetch(target, { method: 'DELETE', headers });
    } else {
      const status = action === 'apply' ? 'applied' : 'proposed';
      r = await fetch(target, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ status }),
      });
    }
    if (!r.ok) return res.status(502).json({ error: 'DB 처리 실패: ' + (await r.text()) });
    return res.status(200).json({ ok: true, action, id });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
