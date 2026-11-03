-- ============================================================================
-- Stage 4 자동 판정 — 컨설팅 보고서 EIEC 5차원 자동 채점 + 법규·인증 인용 검증
-- 보고서 생성 직후 api/auto-judge.js가 기록한다. decision=escalate면 hitl_reviews에
-- 검수 대기로 등록되어 전문가 검수(HITL)를 받는다(논문 7.5절 3단계 다층 검증).
-- 이 파일은 Supabase에 적용된 스키마를 리포지토리에 동기화(버전관리)하기 위한 것.
-- ============================================================================

create table if not exists public.auto_judgments (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  diagnosis_id     uuid not null unique references public.diagnosis_results(id) on delete cascade,
  scores           jsonb,                          -- {"구체성":4, ...} 1~5점 (채점 실패 시 null)
  reasons          jsonb,                          -- {"구체성":"근거 한 줄", ...}
  citations        jsonb not null default '{}',    -- {"laws":[..],"isos":[..],"unknown":[..],"repealed":[..]}
  decision         text not null check (decision in ('pass','escalate')),
  escalate_reasons text[] not null default '{}',
  method           text not null,                  -- llm | rule(채점 실패 시 규칙만)
  model            text
);

comment on table public.auto_judgments is
  'Stage 4 자동 판정: 컨설팅 보고서 EIEC 5차원 자동 채점과 법규·ISO 인용 검증. escalate 건은 hitl_reviews 검수 대기로 등록';

-- RLS: 읽기만 공개(anon/authenticated). 쓰기는 service_role 전용(api/auto-judge.js).
alter table public.auto_judgments enable row level security;

drop policy if exists "auto_judgments_read" on public.auto_judgments;
create policy "auto_judgments_read"
  on public.auto_judgments
  for select
  using (true);
