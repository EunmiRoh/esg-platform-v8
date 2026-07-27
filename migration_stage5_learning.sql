-- ============================================================================
-- Stage 4 HITL 수정·재생성 — 학습 디렉티브 이력 테이블
-- 전문가 피드백(survey_responses) → LLM 튜닝 디렉티브 → Agent2(컨설팅) 프롬프트 반영
-- 이 파일은 Supabase에 적용된 스키마를 리포지토리에 동기화(버전관리)하기 위한 것.
-- 적용: Supabase SQL Editor 또는 CLI(supabase db push)에서 실행.
-- ============================================================================

create table if not exists public.stage5_learning (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  n_experts          int  not null,                 -- 학습에 사용된 유효 전문가 수(테스트 제외)
  dims               jsonb not null,                -- 차원별 평균/불일치(SD)/일치도 스냅샷
  priority_dimension text not null,                 -- 우선 개선 차원 (예: 실행가능성)
  priority_mean      numeric(4,2),
  priority_sd        numeric(4,2),
  tuning_directive   text not null,                 -- Agent2 프롬프트에 주입할 지시문
  status             text not null default 'proposed'
                     check (status in ('proposed','applied','validated'))
);

comment on table public.stage5_learning is
  'Stage 4 HITL 수정·재생성: 전문가 피드백 기반 Agent2(RAG+KG) 프롬프트/임계값 튜닝 디렉티브 이력 (Stage 5 종단 재학습은 후속 연구)';

-- RLS: 읽기만 공개(anon/authenticated). 쓰기(insert)는 service_role 전용(api/learn.js).
alter table public.stage5_learning enable row level security;

drop policy if exists "stage5_learning_read" on public.stage5_learning;
create policy "stage5_learning_read"
  on public.stage5_learning
  for select
  using (true);
