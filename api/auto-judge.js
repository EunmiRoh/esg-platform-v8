// Stage 4 자동 판정 — 컨설팅 보고서를 EIEC 5차원으로 자동 채점하고 법규·ISO 인용을 검증해
// pass(자동 통과) / escalate(전문가 검수 필요)를 결정한다(논문 7.5절 3단계 다층 검증의 1·2단계).
// 결과는 auto_judgments에 저장하고, escalate면 hitl_reviews에 검수 대기로 등록한다(이미 검수된 건은 건드리지 않음).
// 플랫폼이 보고서 생성 직후 비동기로 호출한다. LLM 채점이 실패하면 보수적으로 escalate.

import { allowedOrigin } from './_origin.js';

const SUPABASE_URL = 'https://mwkdtasjkktqqlqefdhr.supabase.co';
const MODEL = 'claude-sonnet-4-20250514';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REPORT_CHARS = 30000;

// EIEC 5차원 (논문 [표 5-6]) — 1~5점
const DIMS = {
  구체성: '개선과제가 정량 목표·기한·담당·절차까지 구체적으로 제시되는가',
  실행가능성: '해당 기업 규모·업종·인력·예산으로 실제 실행 가능한 과제인가(비현실적 과제는 중장기·조건부로 분리했는가)',
  산업적합성: '업종 특성·동종업계 사례를 반영한 맞춤 과제인가',
  구조성: '보고서 구조가 논리적이고 핵심이 요약되어 읽기 쉬운가',
  추적가능성: '권고마다 법령·조항·인증기준·K-ESG 항목 등 근거를 정확히 인용했는가',
};

// 판정 기준 — 조정 시 여기만 바꾼다
const MIN_SCORE = 3;                                 // 어느 차원이든 이 점수 미만이면 검수
const HITL_DIMS = ['실행가능성', '추적가능성'];      // 전문가 검수 우선 차원(논문 6.2: HITL 필요 1·2위)
const HITL_DIM_MIN = 4;                              // 우선 차원은 이 점수 미만이면 검수
const MAX_UNKNOWN_LAWS = 1;                          // 확인 목록 밖 법령이 이보다 많으면 검수

// 플랫폼 30문항·규정례에서 쓰는 법령 + 중소기업 ESG 컨설팅에 자주 인용되는 현행 법령
const KNOWN_LAWS = [
  '개인정보보호법', '공익신고자보호법', '공정거래법', '국가인권위원회법', '근로기준법', '남녀고용평등법',
  '대기환경보전법', '물환경보전법', '산업안전보건법', '에너지이용합리화법', '온실가스배출권법', '정보통신망법',
  '청탁금지법', '폐기물관리법', '하도급법', '화학물질관리법', '환경교육진흥법', '환경기술산업법', '환경정책기본법',
  '중대재해처벌법', '탄소중립기본법', '자원순환기본법', '토양환경보전법', '소음진동관리법', '최저임금법',
  '장애인고용촉진법', '장애인고용법', '노동조합법', '산업재해보상보험법', '상법', '외부감사법', '중소기업기본법',
  '대중소기업상생협력법', '상생협력법', '부정청탁금지법', '독점규제법', '공정거래위원회법', '화학물질등록평가법',
  '화평법', '화관법', '자원재활용법', '환경영향평가법', '건설산업기본법', '고용보험법', '남녀고용평등과일가정양립지원에관한법률',
  '근로자참여법', '파견법', '기간제법', '개인정보보호법시행령', '전자금융거래법', '신용정보법',
];
const REPEALED_LAWS = { '저탄소녹색성장기본법': '2022년 폐지 → 탄소중립기본법' };
const KNOWN_ISO = ['9001', '14001', '14064', '14067', '20400', '22301', '26000', '27001', '27701', '37001', '37301', '45001', '50001'];
// '법'으로 끝나지만 법령명이 아닌 말
const NOT_LAW = /^(방법|처리방법|파기방법|측정방법|평가방법|산정방법|관리방법|관련법|적법|위법|불법|편법|문법|기법|합법|수법|처리방법|파기방법|국가법|환경법|처벌법|관계법|해당법|개별법|특별법|기본법|현행법|동법|본법|법)$/;

export function checkCitations(text) {
  const laws = new Set(), unknown = new Set(), repealed = new Set(), isos = new Set();
  // 띄어 쓴 법령명을 붙여 쓴다: 「개인정보 보호법」·개인정보 보호법 → 개인정보보호법
  const src = String(text)
    .replace(/「([^」]{2,40})」/g, (_, n) => n.replace(/[\s·ㆍ]/g, ''))
    .replace(/([가-힣]{2,10})\s+(보호법|관리법|기본법|촉진법|처벌법|보전법)/g, '$1$2');
  // 법령명 + (조사·조항·문장부호) — 법령명에는 공백을 허용하지 않는다
  const re = /([가-힣·ㆍ]{2,30}?(?:법률|법))(?=[\s,.)」』'"·/]|제\s*\d|$|[에을를의과와이가은는상및도으로])/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].replace(/[·ㆍ]/g, '');
    if (name.length < 3 || NOT_LAW.test(name)) continue;
    if (REPEALED_LAWS[name]) { repealed.add(name); continue; }
    (KNOWN_LAWS.indexOf(name) !== -1 ? laws : unknown).add(name);
  }
  const isoRe = /ISO\s*\/?\s*(?:IEC\s*)?(\d{4,5})/gi;
  while ((m = isoRe.exec(src))) {
    if (KNOWN_ISO.indexOf(m[1]) === -1) unknown.add('ISO ' + m[1]); else isos.add('ISO ' + m[1]);
  }
  return { laws: [...laws], isos: [...isos], unknown: [...unknown], repealed: [...repealed] };
}

export function decide(scores, cites) {
  const why = [];
  if (!scores) why.push('자동 채점 실패');
  else {
    Object.keys(DIMS).forEach(d => {
      const v = scores[d];
      if (typeof v !== 'number') why.push(d + ' 채점 누락');
      else if (v < MIN_SCORE) why.push(d + ' ' + v + '점');
      else if (HITL_DIMS.indexOf(d) !== -1 && v < HITL_DIM_MIN) why.push(d + ' ' + v + '점(검수 우선 차원)');
    });
  }
  if (cites.repealed.length) why.push('폐지 법령 인용: ' + cites.repealed.join(', '));
  if (cites.unknown.length > MAX_UNKNOWN_LAWS) why.push('확인 필요 인용 ' + cites.unknown.length + '건');
  return { decision: why.length ? 'escalate' : 'pass', reasons: why };
}

async function llmScore(apiKey, ctx, report) {
  const rubric = Object.entries(DIMS).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const prompt = `당신은 중소기업 ESG 컨설팅 보고서를 심사하는 전문가다. 아래 보고서를 EIEC 5차원으로 1~5점(5=매우 우수, 3=보통, 1=매우 미흡) 채점하라.

[대상 기업] 업종: ${ctx.industry || '-'} / 규모: ${ctx.size || '-'} / 진단 등급: ${ctx.grade || '-'}

[채점 기준]
${rubric}

[보고서]
${report}

다음 JSON만 출력하라(설명·코드블록 없이):
{"scores":{"구체성":0,"실행가능성":0,"산업적합성":0,"구조성":0,"추적가능성":0},"reasons":{"구체성":"한 문장","실행가능성":"한 문장","산업적합성":"한 문장","구조성":"한 문장","추적가능성":"한 문장"}}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) return null;
  const text = ((await r.json()).content || []).map(c => c.text || '').join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const out = JSON.parse(json);
    const scores = {};
    Object.keys(DIMS).forEach(d => {
      const v = Math.round(Number(out.scores && out.scores[d]));
      if (v >= 1 && v <= 5) scores[d] = v;
    });
    return { scores, reasons: out.reasons || {} };
  } catch (_) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!allowedOrigin(req)) return res.status(403).json({ error: '허용되지 않은 출처입니다.' });

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.' });

  const b = req.body || {};
  if (!UUID.test(String(b.diagnosis_id || ''))) return res.status(400).json({ error: 'diagnosis_id(uuid)가 필요합니다.' });
  const report = String(b.report_text || '').slice(0, MAX_REPORT_CHARS);
  if (report.length < 200) return res.status(400).json({ error: '판정할 보고서 본문이 없습니다.' });
  const ctx = { industry: String(b.industry || '').slice(0, 50), size: String(b.size || '').slice(0, 50), grade: String(b.grade || '').slice(0, 10) };

  try {
    const cites = checkCitations(report);
    let judged = null;
    if (ANTHROPIC) { try { judged = await llmScore(ANTHROPIC, ctx, report); } catch (_) { /* 채점 실패 → escalate */ } }
    const scores = judged && Object.keys(judged.scores).length ? judged.scores : null;
    const { decision, reasons } = decide(scores, cites);

    const sb = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
    const save = await fetch(`${SUPABASE_URL}/rest/v1/auto_judgments?on_conflict=diagnosis_id`, {
      method: 'POST',
      headers: { ...sb, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        diagnosis_id: b.diagnosis_id, scores, reasons: judged ? judged.reasons : null, citations: cites,
        decision, escalate_reasons: reasons, method: scores ? 'llm' : 'rule', model: scores ? MODEL : null,
      }),
    });
    if (!save.ok) return res.status(502).json({ error: 'auto_judgments 저장 실패: ' + (await save.text()) });

    // escalate → 검수 대기 등록. 이미 검수 기록이 있으면(ignore-duplicates) 그대로 둔다.
    if (decision === 'escalate') {
      await fetch(`${SUPABASE_URL}/rest/v1/hitl_reviews?on_conflict=diagnosis_id`, {
        method: 'POST',
        headers: { ...sb, Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ diagnosis_id: b.diagnosis_id, status: 'pending', trigger_reason: ('자동 판정: ' + reasons.join(' · ')).slice(0, 200) }),
      });
    }
    return res.status(200).json({ ok: true, decision, reasons, scores, citations: cites });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
