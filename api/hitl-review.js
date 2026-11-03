// Stage 4 HITL 검수 처리 — 진단 건별 승인(approved) / 수정 요청(revision) / 반려(rejected) / 재검토(pending)
// 어드민 'HITL 큐'에서 호출. service_role로 hitl_reviews를 diagnosis_id 기준 upsert한다.
// revision·rejected 의견과 지적 차원은 api/learn.js가 다음 학습 디렉티브에 반영한다.

const SUPABASE_URL = 'https://mwkdtasjkktqqlqefdhr.supabase.co';
const STATUSES = ['pending', 'approved', 'revision', 'rejected'];
const DIMS = ['구체성', '실행가능성', '산업적합성', '구조성', '추적가능성'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.' });

  const b = req.body || {};
  const status = b.status;
  const dims = Array.isArray(b.flagged_dims) ? b.flagged_dims : [];
  const comment = String(b.comment || '').trim().slice(0, 2000);
  const reviewer = String(b.reviewer || '').trim().slice(0, 50);

  if (!UUID.test(String(b.diagnosis_id || ''))) return res.status(400).json({ error: 'diagnosis_id(uuid)가 필요합니다.' });
  if (STATUSES.indexOf(status) === -1) return res.status(400).json({ error: 'status(pending|approved|revision|rejected)가 필요합니다.' });
  if (dims.some(d => DIMS.indexOf(d) === -1)) return res.status(400).json({ error: '지적 차원은 ' + DIMS.join('·') + ' 중에서 고르세요.' });
  if ((status === 'revision' || status === 'rejected') && !comment && !dims.length) {
    return res.status(400).json({ error: '수정 요청·반려는 지적 차원이나 의견이 필요합니다.' });
  }

  const now = new Date().toISOString();
  const row = {
    diagnosis_id: b.diagnosis_id,
    trigger_reason: String(b.trigger_reason || '').slice(0, 200) || null,
    status,
    flagged_dims: status === 'approved' || status === 'pending' ? [] : dims,
    reviewer: reviewer || null,
    comment: comment || null,
    decided_at: status === 'pending' ? null : now,
    updated_at: now,
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/hitl_reviews?on_conflict=diagnosis_id`, {
      method: 'POST',
      headers: {
        apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) return res.status(502).json({ error: 'DB 처리 실패: ' + (await r.text()) });
    const saved = await r.json();
    return res.status(200).json({ ok: true, record: saved[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
