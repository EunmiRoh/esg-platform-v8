# ESG 자가진단 컨설팅 플랫폼 v8.0

중소기업 ESG 자가진단 + Agentic AI 맞춤형 컨설팅 보고서 + PDF 자동 생성·저장.

## ✨ v7 → v8 주요 변경점

지도교수 6차 피드백 (2026.04.04 / 04.25) 반영:

| # | 피드백 | v8 반영 |
|---|---|---|
| 1 | 평가대상 기업 / 컨설턴트 시작 분기 | ✅ 랜딩 화면에 사용자 유형 선택 카드 |
| 2 | 자가진단 보고서 빈약 → 서술 보강 | ✅ 영역별 분석 문단 + 산업 맥락 + 5점 차원 평가 기준 |
| 3 | 컨설팅 보고서 표만 → 서술적 설명 | ✅ AI 프롬프트 재설계 (5점 차원 충족 강제) |
| 4 | 워드 → PDF 전환 | ✅ jsPDF + html2canvas로 PDF 직접 생성 |
| 5 | 평가등급 엑셀 제거 | ✅ CSV 다운로드 기능 완전 제거 |
| 6 | 증빙자료 서명란 표 깨짐 | ✅ PDF 직접 생성으로 자동 해결 |

## 🛠 기술 스택

- **프론트엔드**: 단일 HTML (빌드 도구 X) — Tailwind 없음, 자체 디자인 시스템
- **PDF 생성**: jsPDF 2.5.1 + html2canvas 1.4.1 (CDN)
- **AI**: Claude Sonnet 4 (`/api/consulting` Vercel serverless function)
- **DB / Storage**: Supabase (Singapore)
  - `diagnosis_results` 테이블 (점수 + PDF 경로)
  - `esg-reports` Storage 버킷 (PDF 저장)
- **배포**: Vercel (정적 호스팅 + serverless API)

## 📁 파일 구조

```
esg-platform-v8/
├── index.html                      ← 메인 (단일 파일, 모든 화면 + 로직)
├── api/
│   └── consulting.js               ← AI 호출 프록시 (v7 그대로 유지)
├── public/
│   └── (favicon 등)
├── package.json                    ← (api/consulting.js만 있으면 OK, deps 없음)
├── vercel.json                     ← (선택: rewrite 설정)
├── migration_v9_storage.sql        ← Supabase 마이그레이션
└── README.md
```

## 🚀 배포 가이드

### 1단계 — Supabase 마이그레이션 실행

1. Supabase 대시보드 → SQL Editor → `+ New query`
2. `migration_v9_storage.sql` 전체 복사 → 붙여넣기 → **Run**
3. 검증: 
   - Table Editor → `diagnosis_results` → 컬럼에 `user_type`, `self_assessment_pdf`, `consulting_pdf`, `evidence_pdfs` 추가됨
   - Storage → `esg-reports` 버킷 보임

### 2단계 — GitHub repo 생성

1. https://github.com/new 접속
2. Repository name: `esg-platform-v8`
3. Public, README 체크 해제 (우리가 쓸 거)
4. `Create repository`

### 3단계 — 파일 업로드

새 repo 페이지에서 **`uploading an existing file`** 링크 클릭:
1. `index.html` 드래그
2. `migration_v9_storage.sql` 드래그
3. `README.md` 드래그
4. (v7에서 복사) `api/consulting.js` 폴더 통째 드래그
5. (v7에서 복사) `package.json`, `vercel.json` 드래그
6. Commit message: `feat: v8.0 initial release`
7. **Commit changes**

### 4단계 — Vercel 배포

1. Vercel 대시보드 → `Add New...` → `Project`
2. GitHub `esg-platform-v8` 선택 → **Import**
3. Framework Preset: **Other** (정적 + serverless)
4. Environment Variables 추가:
   - `ANTHROPIC_API_KEY`: (v7과 동일한 키)
5. **Deploy** 클릭
6. 배포 완료 후 도메인 확인 (예: `esg-platform-v8.vercel.app`)

### 5단계 — 동작 테스트

1. 배포된 URL 접속
2. 평가대상 기업 선택 → 한성테크 → 30문항 모두 응답 → 분석
3. PDF 3개 다운로드 + Storage 저장 확인:
   - Supabase Storage `esg-reports` 버킷 → 새 폴더 (UUID) → PDF 파일들

### 6단계 — v7 대체 (선택, 안전 검증 후)

v8이 안정적으로 동작하면 도메인을 갈아끼움:
- v7 도메인을 v8 프로젝트로 옮기거나
- 어드민의 진단 사이트 링크를 v8 URL로 업데이트

v7 repo는 1~2주 백업으로 유지.

## ⚙️ 사용자 유형별 차이

| 항목 | 평가대상 기업 (CASE 1) | 컨설턴트 (CASE 2) |
|---|---|---|
| 자가진단 보고서 | ✅ 제공 | ✅ 제공 |
| 컨설팅 보고서 | ✅ 제공 | ✅ 제공 |
| 증빙자료 PDF | ⚠ 프리뷰 + 동의 후 다운로드 | ✅ 즉시 다운로드 |
| AI 안내 문구 | "참고 초안" 안내 | "전문가 검토 후 사용 권장" |

## 🗄️ Supabase 데이터 구조

### `diagnosis_results` (확장된 컬럼)
- `user_type` — `company` | `consultant`
- `self_assessment_pdf` — Storage 경로 (`{진단ID}/self-assessment.pdf`)
- `consulting_pdf` — Storage 경로
- `evidence_pdfs` — JSONB 배열 `[{code, filename, path}, ...]`

### Storage 버킷 `esg-reports/`
```
{diagnosis_id}/
├── self-assessment.pdf
├── consulting.pdf
└── evidence/
    ├── E-04.pdf
    ├── S-03.pdf
    └── ...
```

## 🔑 환경 변수

Vercel 프로젝트 → Settings → Environment Variables:
- `ANTHROPIC_API_KEY` — Claude API 키

Supabase URL/anon key는 `index.html`에 하드코딩됨 (어드민과 동일).

## 📊 어드민 연동

어드민 v9.0 (`https://esg-admin-delta.vercel.app/`) 에서:
- 진단 결과 자동 표시
- PDF 경로를 통해 보고서 직접 다운로드 가능
- `검증 링크 관리` 메뉴에서 샘플 선택 → 전문가 평가 설문 발급

---

© 2026 한성대학교 박사학위 연구 (노은미)
