# AI 맞춤형 구술면접 시뮬레이터 — 빌드 플랜

## 1. 전체 아키텍처

- **프론트**: TanStack Start + React + Tailwind, shadcn/ui
- **백엔드**: TanStack `createServerFn` + 서버 라우트 (`/api/*`)
- **DB/Auth/Storage**: Lovable Cloud (이메일 로그인, 사용자·세션·답변 저장, PDF 업로드)
- **AI**:
  - Groq Whisper Large v3 Turbo (STT) + Whisper Large v3 폴백
  - Groq LPU (`llama-3.3-70b-versatile`) — 학교 분석
  - Cerebras `gpt-oss-120b` × 3 키 — 면접관 A/B/C 병렬
- **아바타**: Three.js + Ready Player Me (반신 3D 아바타 3구)
- 아바타의 모습은 사용자가 슈정할 수 있고 커스텀 갸능하게
- **TTS**: 브라우저 Web Speech API (성별/속도/피치 커스텀), 확장 여지로 서버 TTS 후일 교체 가능

## 2. 시크릿 (add_secret로 요청)

- `GROQ_API_KEY_1`
- GROQ_API_KEY_2
- `CEREBRAS_API_KEY_1`, `CEREBRAS_API_KEY_2`, `CEREBRAS_API_KEY_3`

## 3. 데이터 모델 (마이그레이션)

- `profiles(id→auth.users, email, display_name, target_school, school_type, agreed_ai_training, created_at)`
- `app_role` enum: `admin | user` + `user_roles(user_id, role)` + `has_role()` SECURITY DEFINER
- `documents(id, user_id, kind[jaso|saengbu], source[pdf|text], storage_path, extracted_text, created_at)`
- `interview_sessions(id, user_id, mode[full|pressure], target_school, school_analysis_json, per_question_time_sec, status, started_at, ended_at)`
- `interview_questions(id, session_id, interviewer[A|B|C], question_text, order_idx, created_at)`
- `interview_answers(id, question_id, transcript, audio_path?, duration_sec, silence_events, created_at)`
- `interview_reports(id, session_id, summary, fit_score, logic_score, attitude_score, strengths, weaknesses, full_json, created_at)`
- 모든 테이블: `public` GRANT + RLS (본인만 CRUD, admin은 `has_role` 기반 전체 접근)
- Storage 버킷: `documents` (private, PDF 업로드), `interview-audio` (private, 옵션)

## 4. 라우트 구조

```
/                    랜딩 (서비스 소개 + 로그인 CTA)
/auth                이메일 로그인/회원가입 (필수 동의 체크박스)
/_authenticated/
  dashboard          내 세션 목록, 새 세션 시작
  onboarding         목표 학교 입력 → Groq 분석
  documents          자소서/생기부 업로드·붙여넣기
  interview/$id      면접 몰입 화면 (아바타 3인 + 우측 PIP + 우측 컨트롤)
  report/$id         AI 수석사정관 종합 리포트
  practice           Mode 2 압박 적응 훈련
  admin              (admin only) 사용자·세션·문서 열람
```

## 5. 서버 함수 / 라우트

- `analyzeSchool(schoolName)` — Groq 실시간 학교 성향 분석 (JSON)
- `parsePdf(storagePath)` — 서버에서 PDF → 텍스트
- `startSession(input)` — 세션 레코드 생성
- `generateNextQuestion(sessionId, lastAnswer?)` — 지원자 자소서·생기부·이전 답변·중복 회피 컨텍스트를 3 Cerebras 키에 병렬 발사, 다음 라운드에 낼 A/B/C 각 후보 문항을 뽑고 로직상 다음 인터뷰어 선정, DB 저장
  - 중복 방지: 세션 내 기존 질문 임베딩/키워드 회피 로직 + 시스템 프롬프트 규칙
  - 꼬리질문 여부는 마지막 답변의 논리 허점 점수로 결정
- `endSession(sessionId)` — 종료 처리
- `generateReport(sessionId)` — 전체 문답을 Cerebras로 종합 분석 → 리포트 JSON 저장
- `/api/stt` (서버 라우트) — 브라우저 오디오 청크를 받아 Groq Whisper Turbo 호출, 실패 시 Large v3로 폴백, JSON `{text}` 반환

## 6. 면접 몰입 화면 (`/interview/$id`)

레이아웃: 사이드바/네비 없음, 전체 화면 캔버스.

- **중앙**: Three.js `<Canvas>` — Ready Player Me GLB 3인 반신 아바타. 발화 중인 면접관 강조(가벼운 head bob + lipsync 근사), 나머지는 idle. 시선은 카메라 방향 유지, 답변 중 무작위 시선 이동.
- **우상단 PIP**: `getUserMedia` 지원자 웹캠 (drag 가능, 고정 기본 위치)
- **우측 Drawer (상시)**:
  - 문항당 제한 시간: 사용자가 자율적으로 설정 가능/최소 30초 (라이브 반영, 진행 중 남은 시간 카운트다운)/on off 가능/ 시간 끝날시 면접관이 '거기까지 할게요~"와 같이 말 끊고 개입
  - 면접관 A/B/C 각각 성별/톤/속도/피치 슬라이더 (Web Speech TTS 매핑)
  - "면접 종료" 큰 버튼 → `endSession` → `/report/$id`
- **하단 상태 표시줄**: 현재 발화자, 실시간 STT 자막
- **오디오 반응 엔진** (클라이언트 훅):
  - 답변 3초 정적 → 종이 넘김 SFX
  - 답변 20초 초과 + 논리 흐름 저조 → 한숨 SFX
  - 웅얼거림 감지(볼륨 낮음 지속) → 헛기침 SFX
  - 핵심 키워드(질문 프롬프트에서 미리 뽑아온 키워드 목록 매칭) → 사각사각 펜 SFX
  - SFX는 `/public/sfx/*.mp3` 로컬 자산 (짧은 무료 톤)
    =>위는 전반적인 예시에 불구하고, 렌덤성을 어느 정도 넣어야 하고, 소리가 들릴 정도되, 너무 크면 안굄.

플로우: 마운트 시 첫 질문 fetch → TTS 재생 → 타이머 시작 → mic 녹음 → 500ms 청크로 `/api/stt` 스트리밍 → 답변 종료(타이머 만료 또는 사용자 "다음") → `generateNextQuestion` → 반복.

## 7. 리포트 (`/report/$id`)

Cerebras `gpt-oss-120b` 한 회로에 전체 QA 컨텍스트 투입 → 구조화 JSON 반환:
합격 기준 부합도, 논리 허점, 태도 분석, 면접관별 코멘트, 개선 액션 3개. Recharts로 점수 시각화.

## 8. Mode 2 압박 훈련

풀 리포트 생략, 세션 종료 후 간단 요약만. 컨트롤 패널 동일.

## 9. 관리자 대시보드 (`/admin`)

- `has_role(uid, 'admin')` 게이트
- 사용자 리스트/검색, 클릭 시 세션·문서·답변 조회
- 첫 어드민 승격은 SQL로 수동 (사용자 이메일로 안내)

## 10. 회원가입 필수 동의

Zod 스키마에 `agreed_ai_training: z.literal(true)` — 미체크 시 제출 불가, profiles에 저장.

## 11. 기술 노트

- Three.js/Ready Player Me: 클라이언트 전용 로더, `<ClientOnly>` + `React.lazy`
- Web Audio API로 볼륨/무음 감지 (`AnalyserNode`)
- MediaRecorder → WAV로 재인코딩 후 `/api/stt` 전송 (Groq Whisper 요구사항 준수)
- 서버 시크릿은 handler 내부에서만 `process.env`
- SEO head는 랜딩/각 페이지에 개별 title/description
- 디자인 토큰: `src/styles.css` semantic tokens (몰입 다크 톤 + 시험장 조명감)

## 12. 빌드 순서

1. Cloud 활성화 + secrets 요청 (Groq, Cerebras×3)
2. 마이그레이션 (테이블·enum·RLS·GRANT·트리거)
3. Auth 페이지 + 동의 체크 + profiles 자동 생성
4. 랜딩 + 대시보드 + 온보딩(학교 분석)
5. 문서 업로드 (PDF 파싱)
6. 서버 함수: startSession, generateNextQuestion(3키 병렬), endSession, generateReport, /api/stt
7. 면접 화면: Three.js 아바타, PIP, 컨트롤 드로어, TTS, STT 스트림, 반응형 SFX
8. 리포트 화면
9. Mode 2 훈련 모드
10. 관리자 대시보드
11. 헤드 메타 + 디자인 톤 마감 QA
12. 전반적으로 점검/오류 발견시 즉시 수정

시크릿과 마이그레이션부터 시작하겠습니다.