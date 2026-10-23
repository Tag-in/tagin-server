# tagin-server

TAG→IN 서버 (NestJS)

## 요구 사항

- Node.js 22 이상 (`.nvmrc` 참고)
- npm
- Docker / Docker Compose

## 시작하기

```bash
npm install
cp .env.example .env      # 필요 시 값 수정
npm run db:up             # PostgreSQL, Redis 실행 (healthy 상태까지 대기)
npm run start:dev
```

- API: `http://localhost:3000/api`
- 헬스체크: `GET /api/health` (DB, Redis 연결 확인)
- Swagger: `http://localhost:3000/docs` (production 환경에서는 비활성화)

인프라 종료는 `npm run db:down`, 데이터까지 삭제하려면 `docker compose down -v`.

## 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm run start:dev` | 개발 서버 (watch) |
| `npm run build` / `npm run start:prod` | 빌드 / 운영 실행 |
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run test:e2e` | e2e 테스트 (`npm run db:up` 선행 필요) |
| `npm run migration:generate -- src/database/migrations/<Name>` | 엔티티 변경 사항으로 마이그레이션 생성 |
| `npm run migration:create -- src/database/migrations/<Name>` | 빈 마이그레이션 생성 |
| `npm run migration:run` / `npm run migration:revert` | 마이그레이션 적용 / 롤백 |

> 마이그레이션 명령은 빌드 결과물(`dist/database/data-source.js`)을 기준으로 동작하며, 스크립트가 빌드를 먼저 수행합니다.

## 구조

```
src/
├── main.ts               # 부트스트랩 (helmet, CORS, ValidationPipe, Swagger, prefix: /api)
├── app.module.ts         # Config, Logger(pino), Throttler(전역 가드) 등록
├── config/               # 환경변수 검증 스키마 (Joi)
├── database/             # TypeORM 설정, CLI용 data-source, migrations
├── redis/                # 전역 Redis 클라이언트 (@Inject(REDIS_CLIENT))
├── auth/                 # Passport JWT 전략, JwtAuthGuard
└── health/               # Terminus 헬스체크
```

## 규칙

- 엔티티 파일명은 `*.entity.ts`. 모듈에서 `TypeOrmModule.forFeature([...])`로 등록하면 자동 로드된다.
- `synchronize`는 비활성화되어 있으므로 스키마 변경은 반드시 마이그레이션으로 반영한다.
- 보호가 필요한 라우트에는 `@UseGuards(JwtAuthGuard)`를 사용한다.
