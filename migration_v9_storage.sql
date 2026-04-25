-- ===========================================================================
-- ESG Platform v8 — Storage 버킷 + diagnosis_results 확장
-- 작성일: 2026-04-26
--
-- 적용 방법:
--   1) Supabase 대시보드 > SQL Editor 접속
--   2) 본 파일 전체 복사 → 실행
--   3) Storage 페이지에서 'esg-reports' 버킷 생성 확인
--
-- 사전조건: migration_v9_survey_tables.sql 이미 실행되어 있어야 함
-- ===========================================================================

-- ─── 1. diagnosis_results에 PDF 경로/사용자 유형 컬럼 추가 ───
-- 기존 데이터 손실 없이 nullable로 추가
alter table public.diagnosis_results
  add column if not exists user_type            text,        -- 'company' | 'consultant'
  add column if not exists self_assessment_pdf  text,        -- Storage 경로
  add column if not exists consulting_pdf       text,        -- Storage 경로
  add column if not exists evidence_pdfs        jsonb        -- [{code, filename, path}, ...]
;

comment on column public.diagnosis_results.user_type is '진단 시점 사용자 유형: company(평가대상 기업) | consultant(컨설턴트)';
comment on column public.diagnosis_results.self_assessment_pdf is 'Supabase Storage 경로 (자가진단 보고서 PDF)';
comment on column public.diagnosis_results.consulting_pdf is 'Supabase Storage 경로 (컨설팅 보고서 PDF)';
comment on column public.diagnosis_results.evidence_pdfs is '증빙자료 PDF 메타 배열';


-- ─── 2. Storage 버킷 생성 (esg-reports) ───
-- 이미 존재하면 에러 없이 무시
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'esg-reports',
  'esg-reports',
  true,                                          -- 공개 (어드민/설문 사이트가 직접 다운로드)
  10485760,                                      -- 10MB per file
  array['application/pdf']                       -- PDF만 허용
)
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];


-- ─── 3. Storage RLS 정책 ───
-- anon key로 업로드/조회 가능 (진단 사이트가 직접 업로드)
-- ※ 운영 보안 강화 시 service_role 분리 권장

-- 누구나 읽기 가능 (public 버킷이지만 명시적 정책)
drop policy if exists "esg-reports public read" on storage.objects;
create policy "esg-reports public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'esg-reports');

-- anon이 업로드 가능 (진단 사이트가 PDF 업로드)
drop policy if exists "esg-reports anon upload" on storage.objects;
create policy "esg-reports anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'esg-reports');

-- anon이 업데이트 가능 (덮어쓰기 허용)
drop policy if exists "esg-reports anon update" on storage.objects;
create policy "esg-reports anon update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'esg-reports')
  with check (bucket_id = 'esg-reports');

-- anon이 삭제 가능 (재진단 시 기존 파일 정리)
drop policy if exists "esg-reports anon delete" on storage.objects;
create policy "esg-reports anon delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'esg-reports');


-- ===========================================================================
-- 검증 쿼리
-- ===========================================================================
-- select id, name, public, file_size_limit from storage.buckets where id = 'esg-reports';
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='diagnosis_results' and column_name like '%pdf%' or column_name='user_type';
