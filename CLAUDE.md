# CLAUDE.md

tagin-server 작업 시 항상 따르는 규칙. 실행 방법과 구조는 `README.md`를 참고한다.

## 스택

NestJS 12 · TypeORM(PostgreSQL 17) · ioredis(Redis 7.4) · Joi · Vitest · oxlint · prettier · Node 22 · ESM

## Git 워크플로우

### 브랜치

| 브랜치 | 역할 |
| --- | --- |
| `main` | 배포(최종) 브랜치. 직접 push 금지, `develop`에서 PR로만 반영 |
| `develop` | 통합 브랜치. 모든 작업의 기준(base) |
| `<type>/<설명>` | 작업 브랜치. 항상 최신 `develop`에서 분기해 `develop`으로 PR (예: `feat/user-withdrawal`) |

- 작업 시작 전 `git fetch origin` 후 최신 `develop` 기준으로 브랜치를 만든다.
- 한 브랜치는 한 PR만 담당한다. **머지된 브랜치는 재사용하지 않는다.** 후속 작업은 `develop`에서 새 브랜치를 딴다.
- 이름이 지정된 세션 브랜치가 이미 머지된 상태라면 같은 이름을 덮어쓰지 말고 새 브랜치명을 사용자에게 확인한다.

### 금지 사항

- `git push --force`, `--force-with-lease`, `reset --hard` 후 강제 푸시 등 **원격 이력 덮어쓰기 금지.** 이력이 어긋나면 `git merge origin/develop`으로 합치거나 새 브랜치를 딴다.
- 이미 푸시한 커밋의 `amend` / `rebase` 금지. 수정은 새 커밋으로 추가한다.
- `main`, `develop` 직접 push 금지. 사용자가 명시적으로 요청한 경우만 예외.
- 사용자 요청 없이 PR 생성, 머지, 브랜치 삭제 금지.
- `.env`, 비밀키, 토큰 커밋 금지. 환경변수 추가는 `.env.example`에만 반영한다.

### 커밋

`<type>: <한글 요약>` 형식. 한 커밋은 하나의 논리적 변경만 담는다.

- type: `feat` `fix` `refactor` `perf` `test` `docs` `chore` `ci`
- 요약은 명령형/명사형으로 짧게, 마침표 없음. 예: `feat: Google ID Token 로그인 추가`
- 마이그레이션 파일은 변경한 엔티티와 같은 커밋(또는 같은 PR)에 포함한다.

### PR

- base는 `develop`. `develop` → `main`은 릴리스 PR로 올린다.
- 제목은 커밋과 같은 형식. 본문에는 변경 내용, 배포 시 주의사항(마이그레이션, 환경변수), 검증 방법을 적는다.
- 머지 방식은 **Create a merge commit**을 사용한다. squash / rebase 머지는 로컬·원격 브랜치의 해시가 어긋나 이력 충돌을 만들므로 쓰지 않는다.
- PR 전에 아래 검증을 모두 통과시킨다.

```bash
npm run build && npm run lint && npm test
```

## 코드 규칙

- ESM 프로젝트다. 상대 경로 import는 `.js` 확장자를 붙인다 (`from './users.service.js'`).
- 디렉터리 구조와 의존 방향은 `README.md`의 구조·규칙 섹션을 따른다. 요약: 인프라는 `src/core`, 상태 없는 공용 코드는 `src/common`, 도메인은 `src/modules/<domain>/{controllers,services,entities,dto,...}`. `core`/`common`은 `modules`를 import하지 않고, 도메인 간 참조는 한 방향(`auth → users`)만 허용한다.
- 여러 도메인에서 쓰는 코드는 도메인 폴더에 두지 않는다. 가드·데코레이터는 `common/`, DB 관련 공용 코드(transformer, 에러 판별)는 `core/database/`에 둔다.
- 스키마 변경은 반드시 마이그레이션으로 반영한다 (`synchronize` 비활성). 엔티티 수정 후 `npm run migration:generate -- src/core/database/migrations/<Name>`으로 생성하고, 생성된 SQL을 직접 검토한 뒤 `prettier`로 포맷한다.
- 마이그레이션은 `run` → `revert` → `run` 순서로 로컬에서 확인하고, 이후 `migration:generate`가 "No changes"인지 확인한다. 이미 머지된 마이그레이션은 수정하지 않고 새로 추가한다.
- 컬럼은 snake_case(`SnakeNamingStrategy`), 시간은 `timestamptz`, UUID 기본값은 `gen_random_uuid()`(pgcrypto 불필요). `uuid-ossp` 확장은 쓰지 않는다.
- `bigint` 컬럼은 number 변환 transformer(`core/database/transformers/bigint.transformer.ts`)를 사용한다.
- 환경변수를 추가하면 `src/config/env.validation.ts`(Joi)와 `.env.example`을 함께 수정한다.
- 새 기능에는 단위 테스트를 같이 작성한다 (`*.spec.ts`, 소스 옆에 위치). 외부 의존(Google, Redis)은 mock한다.
- API 문서화 규칙은 `README.md`의 Swagger 섹션을 따른다. 보호 라우트는 `@ApiAuth()` + `@UseGuards(JwtAuthGuard)`를 함께 쓴다.

## 인증 도메인 핵심

- 로그인은 클라이언트가 받은 **Google ID Token**을 서버가 검증하는 방식이다. 콜백 URL / 서버 세션은 사용하지 않는다.
- 허용 audience는 `GOOGLE_WEB_CLIENT_ID`(필수), `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`(선택, 비우면 무시). 현재는 웹 로그인만 사용한다.
- Google의 `email_verified`가 true인 경우에만 가입/로그인을 허용한다.
- Access Token은 JWT(`sub` = user id, 기본 15분). Refresh Token은 불투명 랜덤 값이며 Redis에는 SHA-256 해시만 저장한다.
- Refresh Token은 1회용이다. 재발급 시 교체(rotation)하고, 사용된 토큰이 다시 오면 같은 로그인 세션(family) 전체를 폐기한다.
- 소셜 계정은 `users`와 분리된 `user_identities`(`provider`, `provider_user_id` 유니크)에 저장한다. `provider`는 DB enum이 아니라 문자열이라 Apple 등을 추가해도 마이그레이션이 필요 없다.
- 계정 상태가 `ACTIVE`가 아니거나 soft delete(`deleted_at`)된 사용자는 로그인과 토큰 재발급이 모두 거부된다.
- 로그인(`POST /auth/google`)은 계정을 만들지 않는다. 미가입이면 `200 { status: 'SIGNUP_REQUIRED', profile }`을 반환하고, 클라이언트가 가입 화면에서 약관 동의를 받아 `POST /auth/google/signup`(ID Token 재전송)을 호출하면 가입과 동시에 토큰을 발급한다. 프로필은 가입 시 ID Token에서 서버가 다시 읽는다.
- 가입 시 이용약관·개인정보 동의는 필수(`true`만 허용), 마케팅 동의는 선택이며 동의 시각을 각각 기록한다.
- 가입 요청이 동시에 와도 사용자가 하나만 생성되어야 한다 (유니크 충돌 시 `409`). 이미 가입된 계정(탈퇴 포함)의 가입 요청도 `409`다.

## 미결 사항 (확정 전 임의로 정하지 말 것)

- `storage_limit_bytes` 기본값 5GiB는 임시 값이다. 요금제 정책 확정 후 수정한다.
- 약관 버전 관리: 가입 시 동의 시각만 기록하고 어떤 버전에 동의했는지는 저장하지 않는다. 약관 개정/재동의 정책 확정 후 추가한다.
- 탈퇴 회원의 재가입 정책: 현재는 탈퇴 이력이 있는 소셜 계정으로 로그인하면 `403`, 가입하면 `409`다.
- 회원 탈퇴 API(`status=WITHDRAWN` + soft delete)와 저장 용량 한도 검증은 미구현이다.
- 드라이브 휴지통: 삭제는 soft delete이고 `TRASH_RETENTION_DAYS`(기본 30일)가 지나면 매일 03:00에 스토리지 객체와 DB 행을 영구 삭제한다. 영구 삭제 시 `users.storage_used_bytes`는 차감하지 않는다(업로드가 이 값을 아직 올리지 않으므로 용량 정책과 함께 정한다). 휴지통 목록(`GET /drive/trash`)은 페이지네이션이 없다.
- Apple 로그인은 구현하지 않았다. iOS 앱을 App Store에 출시할 때는 가이드라인 4.8(타사 로그인 제공 시 Apple 로그인 필수)에 걸리므로, 그 전에 추가해야 한다. 추가 시 Apple JWKS 검증, `aud`(`com.tagin.app`), 비공개 릴레이 이메일의 계정 연결 정책, 이름이 최초 1회만 전달되는 점을 고려한다.
- iOS/Android Google 클라이언트와 Android SHA-1은 네이티브 앱 출시 시점에 발급한다.
- 실제 Google 토큰 검증과 Redis 연동은 mock 단위 테스트로만 검증됐다. 스테이징에서 실제 토큰으로 확인이 필요하다.
