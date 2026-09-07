// Stage 4 HITL 수정·재생성 — 학습 디렉티브 자동 생성 엔드포인트
// 전문가 피드백(survey_responses)을 읽어 우선 개선 차원을 산출하고,
// LLM으로 튜닝 디렉티브를 생성해 stage5_learning(status=applied)에 저장한다.
// Agent 2(컨설팅 생성)는 최신 applied 디렉티브를 프롬프트에 주입한다.

const SUPABASE_URL = 'https://mwkdtasjkktqqlqefdhr.supabase.co';

const DIMS = [
  ['구체성', 'score_specificity'],
  ['실행가능성', 'score_feasibility'],
  ['산업적합성', 'score_industry_fit'],
  ['구조성', 'score_structure'],
  ['추적가능성', 'score_traceability'],
];
const TEST_NAMES = ['노은미모바일', '노은미'];

// LLM 실패(크레딧 부족·키 부재 등) 시 사용할 규칙 기반 디렉티브 본문 생성
const DIM_GUIDE = {
  '실행가능성': '기업 규모(company_size)·업종(company_industry)·인력·예산을 반영해 실행가능성을 우선 판단하고, 비현실적 과제(협력사 ESG 관리·온실가스 제3자 검증·Scope 2 측정 등)는 중장기·조건부 과제로 분리하며, 각 개선과제에 실행난이도(상/중/하)와 전제조건 태그를 부여한다.',
  '추적가능성': '법령명·조항·인증기준·K-ESG 항목 인용의 정확성을 검증하고, 근거가 불확실하면 표기하며, 신뢰도가 임계값 미만이면 Stage 4 HITL 큐로 에스컬레이션한다.',
  '산업적합성': '업종 특성과 동종업계 사례를 반영해 산업 맞춤형 개선과제를 제시한다.',
  '구체성': '개선과제를 정량 지표와 구체적 실행 절차 중심으로 서술한다.',
  '구조성': '보고서 구조와 가독성을 높이고 핵심 지표를 요약·시각화한다.',
};
function ruleBasedBody(top, commentList) {
  let body = `전문가 평가에서 '${top.label}' 차원이 가장 취약(평균 ${top.mean}, 불일치 ${top.sd})하게 나타났다. ` +
    (DIM_GUIDE[top.label] || `'${top.label}' 개선에 우선 초점을 둔다.`);
  const top3 = (commentList || []).slice(0, 3).map(function (c) { return c.length > 120 ? c.slice(0, 120) + '…' : c; });
  if (top3.length) body += ' 전문가 지적: ' + top3.map(function (c) { return '"' + c + '"'; }).join(' / ') + '.';
  return body;
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
  // ANTHROPIC_API_KEY 없거나 호출 실패 시 규칙 기반 폴백으로 동작

  const sbHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

  try {
    // 1. 전문가 응답 수집 (service role read)
    const sel = 'expert_name,score_specificity,score_feasibility,score_industry_fit,score_structure,score_traceability,free_comment,c4_top_advantage,c5_top_concern';
    const url = `${SUPABASE_URL}/rest/v1/survey_responses?respondent_type=eq.expert&select=${encodeURIComponent(sel)}`;
    const r = await fetch(url, { headers: sbHeaders });
    if (!r.ok) return res.status(502).json({ error: 'survey_responses 조회 실패: ' + (await r.text()) });
    let rows = await r.json();
    rows = rows.filter(x => !(x.expert_name && TEST_NAMES.includes((x.expert_name || '').trim())));
    const n = rows.length;
    if (n < 1) return res.status(400).json({ error: '유효 전문가 응답이 없습니다.' });

    // 1-b. 다수 전문가 협의 HITL(회의) 합의 의견 수집 → 학습에 함께 반영
    let meetingPoints = [];
    try {
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/meeting_feedback?status=eq.active&select=points&order=created_at.desc`, { headers: sbHeaders });
      if (mr.ok) {
        const mrows = await mr.json();
        mrows.forEach(function (m) { if (Array.isArray(m.points)) meetingPoints = meetingPoints.concat(m.points.filter(Boolean)); });
      }
    } catch (_) { /* 회의 피드백 없으면 개인 설문만으로 진행 */ }

    // 2. 차원별 평균/불일치(SD) + 우선 차원 산출
    const stat = DIMS.map(([label, col]) => {
      const vals = rows.map(x => x[col]).filter(v => v != null).map(Number);
      const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (vals.length - 1)) : 0;
      return { label, n: vals.length, mean: +m.toFixed(2), sd: +sd.toFixed(2), agreement: +(100 - sd / 4 * 100).toFixed(0) };
    });
    const ranked = stat.map(s => ({ ...s, pri: (5 - s.mean) + s.sd })).sort((a, b) => b.pri - a.pri);
    const top = ranked[0];

    // 3. LLM으로 튜닝 디렉티브 생성
    const dimsText = stat.map(s => `- ${s.label}: 평균 ${s.mean}, 불일치(SD) ${s.sd}`).join('\n');
    const commentList = rows.map(x => x.free_comment).filter(Boolean);
    const comments = commentList.map(c => '- ' + c).join('\n');
    const genPrompt = `당신은 중소기업 ESG 컨설팅 AI의 품질 개선 담당자다. 아래는 전문가 ${n}명의 EIEC 5차원 평가 결과와 자유서술 피드백이다.

[차원별 평균/불일치(SD)]
${dimsText}

[우선 개선 차원] ${top.label} (평균 ${top.mean}, 불일치 ${top.sd})

[전문가 자유서술 피드백(개인 설문)]
${comments || '(자유서술 없음)'}

[전문가 협의 피드백(회의 합의 의견)]
${meetingPoints.length ? meetingPoints.map(function (p) { return '- ' + p; }).join('\n') : '(없음)'}

위 피드백을 종합하여, ESG 컨설팅 보고서를 생성하는 LLM Agent의 시스템 프롬프트에 삽입할 '튜닝 디렉티브'를 작성하라.
규칙: (1) 우선 차원 '${top.label}' 개선에 초점을 둘 것, (2) 개인 설문 자유서술과 회의 협의 의견에서 드러난 구체적 지적을 함께 반영할 것, (3) 실행 가능한 지시문 형태로 3~5개 문장, (4) 한국어, (5) 300자 내외, (6) 서두·메타설명·머리말 없이 지시문 본문만 출력.`;

    // LLM 우선 시도, 실패(크레딧 부족·키 부재 등) 시 규칙 기반 폴백
    let body = '';
    let method = 'llm';
    if (ANTHROPIC) {
      try {
        const a = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: genPrompt }] }),
        });
        if (a.ok) {
          const aData = await a.json();
          body = (aData.content || []).map(c => c.text || '').join('\n').trim();
        }
      } catch (_) { /* 폴백으로 진행 */ }
    }
    if (!body) { body = ruleBasedBody(top, commentList.concat(meetingPoints)); method = 'rule'; }
    const directive = `[우선 차원: ${top.label}] ${body}`;

    // 4. stage5_learning 저장 (service role insert, status=applied)
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/stage5_learning`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        n_experts: n,
        dims: stat,
        priority_dimension: top.label,
        priority_mean: top.mean,
        priority_sd: top.sd,
        tuning_directive: directive,
        status: 'applied',
      }),
    });
    if (!ins.ok) return res.status(502).json({ error: 'stage5_learning 저장 실패: ' + (await ins.text()) });
    const created = await ins.json();

    return res.status(200).json({ ok: true, n_experts: n, n_meeting_points: meetingPoints.length, priority: top.label, method, record: created[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
