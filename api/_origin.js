// LLM을 호출하는 API(consulting, auto-judge) 공용 출처 검사. 파일명이 _로 시작해 라우트로 노출되지 않는다.
// 허용 출처: 본 플랫폼(운영·Vercel 미리보기)과 로컬 개발. 다른 사이트·스크립트가
// ANTHROPIC_API_KEY로 임의 프롬프트를 호출하지 못하게 한다. 추가 도메인은 ALLOWED_ORIGINS(쉼표 구분)로.
const ALLOWED_HOST = /^(esg-platform-v8(-[a-z0-9-]+)?\.vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;

export function allowedOrigin(req) {
  const src = req.headers.origin || req.headers.referer || '';
  let host = '';
  try { host = new URL(src).host; } catch (_) { return false; }
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ALLOWED_HOST.test(host) || extra.indexOf(host) !== -1;
}
