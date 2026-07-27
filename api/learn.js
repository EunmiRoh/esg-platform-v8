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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.' });
  if (!ANTHROPIC) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' });

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
    const comments = rows.map(x => x.free_comment).filter(Boolean).map(c => '- ' + c).join('\n');
    const genPrompt = `당신은 중소기업 ESG 컨설팅 AI의 품질 개선 담당자다. 아래는 전문가 ${n}명의 EIEC 5차원 평가 결과와 자유서술 피드백이다.

[차원별 평균/불일치(SD)]
${dimsText}

[우선 개선 차원] ${top.label} (평균 ${top.mean}, 불일치 ${top.sd})

[전문가 자유서술 피드백]
${comments || '(자유서술 없음)'}

위 피드백을 종합하여, ESG 컨설팅 보고서를 생성하는 LLM Agent의 시스템 프롬프트에 삽입할 '튜닝 디렉티브'를 작성하라.
규칙: (1) 우선 차원 '${top.label}' 개선에 초점을 둘 것, (2) 전문가 자유서술에서 드러난 구체적 지적을 반영할 것, (3) 실행 가능한 지시문 형태로 3~5개 문장, (4) 한국어, (5) 250자 내외, (6) 서두·메타설명·머리말 없이 지시문 본문만 출력.`;

    const a = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: genPrompt }] }),
    });
    if (!a.ok) return res.status(502).json({ error: 'LLM 호출 실패: ' + (await a.text()) });
    const aData = await a.json();
    let directive = (aData.content || []).map(c => c.text || '').join('\n').trim();
    if (!directive) return res.status(502).json({ error: 'LLM이 빈 디렉티브를 반환했습니다.' });
    directive = `[우선 차원: ${top.label}] ${directive}`;

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

    return res.status(200).json({ ok: true, n_experts: n, priority: top.label, record: created[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
