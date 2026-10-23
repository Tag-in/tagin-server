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
- Swagger UI: `http://localhost:3000/docs` / OpenAPI JSON: `http://localhost:3000/docs/json` (`SWAGGER_ENABLED=true`일 때만 노출)

인프라 종료는 `npm run db:down`, 데이터까지 삭제하려면 `docker compose down -v`.

## 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm run start:dev` | 개발 서버 (watch) |
| `npm run build` / `npm run start:prod` | 빌드 / 운영 실행 |
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run test:e2e` | e2e 테스트 (`npm run db:up` 선행 필요) |
| `npm run migration:generate -- src/core/database/migrations/<Name>` | 엔티티 변경 사항으로 마이그레이션 생성 |
| `npm run migration:create -- src/core/database/migrations/<Name>` | 빈 마이그레이션 생성 |
| `npm run migration:run` / `npm run migration:revert` | 마이그레이션 적용 / 롤백 |

> 마이그레이션 명령은 빌드 결과물(`dist/core/database/data-source.js`)을 기준으로 동작하며, 스크립트가 빌드를 먼저 수행합니다.

## 구조

```
src/
├── main.ts                    # 부트스트랩 (helmet, CORS, ValidationPipe, Swagger, prefix: /api)
├── app.module.ts              # Config, Logger(pino), Throttler(전역 가드), core/도메인 모듈 등록
├── core/                      # 앱 전역 인프라. AppModule에서 한 번만 등록
│   ├── config/                # 환경변수 검증 스키마 (Joi)
│   ├── database/              # TypeORM 설정, CLI용 data-source, migrations, transformers, utils
│   ├── storage/               # 오브젝트 스토리지(S3/MinIO) 클라이언트 (업로드·삭제)
│   ├── redis/                 # 전역 Redis 클라이언트 (@Inject(REDIS_CLIENT))
│   └── health/                # Terminus 헬스체크 (indicators/)
├── common/                    # 상태 없는 공용 코드 (어느 도메인에도 속하지 않음)
│   ├── guards/                # JwtAuthGuard
│   └── swagger/               # Swagger 설정, 문서화 공통 데코레이터/DTO
└── modules/                   # 비즈니스 도메인
    ├── auth/                  # Google 로그인·가입(ID Token), Access JWT + Refresh Token(Redis)
    ├── drive/                 # 파일·링크·폴더(계층). 임베딩 기반 의미 검색·자동 분류(pgvector), 이동, 휴지통(삭제·복원·자동 영구 삭제)
    └── users/                 # User·UserIdentity 엔티티, 사용자 계정 규칙
```

도메인 모듈 내부는 계층별 폴더로 나눈다. 필요한 폴더만 만든다.

```
modules/<domain>/
├── <domain>.module.ts
├── controllers/   # HTTP 진입점 (요청 검증·응답 매핑만, 로직 없음)
├── services/      # 유스케이스·도메인 로직, 외부 API 어댑터
├── entities/      # TypeORM 엔티티 (*.entity.ts)
├── dto/           # 요청/응답 DTO (*.dto.ts)
├── strategies/    # Passport 전략
├── types/         # 인터페이스·타입
├── utils/         # 도메인 순수 함수
└── constants/     # 도메인 상수
```

## 규칙

- 의존 방향은 `modules → common, core`, `common → core`만 허용한다. `core`·`common`은 `modules`를 import하지 않는다.
- 도메인 간 참조는 한 방향으로만 한다 (현재 `auth → users`). 다른 도메인은 대상 모듈이 `exports`한 서비스와 `entities`/`types`/`utils`만 사용하고, 상대 도메인의 controller·내부 서비스는 직접 쓰지 않는다. 순환이 생기면 공통 부분을 상위로 분리한다.
- 두 개 이상의 도메인이 쓰는 코드(가드, 데코레이터, DB 유틸 등)는 특정 도메인에 두지 않고 `common/` 또는 `core/`로 올린다.
- 엔티티 파일명은 `*.entity.ts`. 모듈에서 `TypeOrmModule.forFeature([...])`로 등록하면 자동 로드된다.
- `synchronize`는 비활성화되어 있으므로 스키마 변경은 반드시 마이그레이션으로 반영한다.
- 보호가 필요한 라우트에는 `common/guards`의 `@UseGuards(JwtAuthGuard)`를 사용한다.

## API 문서화 (Swagger)

`@nestjs/swagger` CLI 플러그인이 `*.dto.ts`, `*.entity.ts`의 타입·`class-validator` 데코레이터·JSDoc 주석을 읽어 문서를 자동 생성한다. `@ApiProperty`는 플러그인으로 표현이 안 되는 경우(union 타입 등)에만 사용한다.

```ts
// create-user.dto.ts
export class CreateUserDto {
  /**
   * 닉네임
   * @example '태그인'
   */
  @IsString()
  @MaxLength(20)
  nickname: string;
}
```

```ts
// users.controller.ts
@ApiTags('Users')
@Controller('users')
export class UsersController {
  /** 회원 정보 수정 */          // → operation summary
  @ApiAuth()                     // Bearer 인증 표시 + 401 응답
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  update(@Body() dto: UpdateUserDto): Promise<UserResponseDto> { ... }
}
```

- 컨트롤러에는 `@ApiTags`를 지정한다.
- 인증이 필요한 API는 `@ApiAuth()`(문서)와 `@UseGuards(JwtAuthGuard)`(실제 인증)를 함께 사용한다.
- 에러 응답은 `@ApiErrorResponse(status, description)`로 명시한다. 응답 스키마는 Nest 기본 에러 형태(`ErrorResponseDto`)다.
- 응답 스키마는 메서드 반환 타입(DTO)을 명시하면 자동 반영된다.
- Swagger UI의 Authorize에 입력한 토큰은 새로고침 후에도 유지된다(`persistAuthorization`).
