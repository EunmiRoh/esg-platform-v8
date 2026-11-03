-- ============================================================================
-- Stage 4 HITL 검수 처리 — 진단·컨설팅 산출물별 전문가 검수 결과
-- 어드민 HITL 큐(점수<50 또는 C·D 등급)에서 승인/수정 요청/반려를 기록하고,
-- 수정 요청·반려 의견은 api/learn.js가 다음 학습 디렉티브에 반영한다.
-- 이 파일은 Supabase에 적용된 스키마를 리포지토리에 동기화(버전관리)하기 위한 것.
-- ============================================================================

create table if not exists public.hitl_reviews (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  diagnosis_id   uuid not null unique references public.diagnosis_results(id) on delete cascade,
  trigger_reason text,                                   -- 큐 진입 사유 (예: 점수<50, 등급 D)
  status         text not null default 'pending'
                 check (status in ('pending','approved','revision','rejected')),
  flagged_dims   text[] not null default '{}'            -- 전문가가 지적한 EIEC 차원
                 check (flagged_dims <@ array['구체성','실행가능성','산업적합성','구조성','추적가능성']),
  reviewer       text,
  comment        text,
  decided_at     timestamptz
);

comment on table public.hitl_reviews is
  'Stage 4 HITL 검수: 진단 건별 전문가 검수 결과(승인/수정 요청/반려, 지적 차원, 의견). revision·rejected 의견은 Stage 5 학습에 반영';

create index if not exists hitl_reviews_status_idx on public.hitl_reviews (status);

-- RLS: 읽기만 공개(anon/authenticated). 쓰기는 service_role 전용(api/hitl-review.js).
alter table public.hitl_reviews enable row level security;

drop policy if exists "hitl_reviews_read" on public.hitl_reviews;
create policy "hitl_reviews_read"
  on public.hitl_reviews
  for select
  using (true);
