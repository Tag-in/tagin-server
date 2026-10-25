import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('local', 'development', 'production', 'test')
    .default('local'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('*'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
  SWAGGER_ENABLED: Joi.boolean().default(false),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.number().integer().positive().default(900),
  JWT_REFRESH_EXPIRES_IN: Joi.number().integer().positive().default(1_209_600),

  // TEMP(test): 인증 가드를 끈 동안 모든 요청에 사용할 사용자 id (Tag-in/tagin-server#18). 배포 전 제거.
  TEST_USER_ID: Joi.string().uuid().allow('').default(''),

  GOOGLE_WEB_CLIENT_ID: Joi.string().required(),
  GOOGLE_IOS_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_ANDROID_CLIENT_ID: Joi.string().allow('').default(''),

  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  AWS_S3_ENDPOINT: Joi.string().uri().allow('').default(''),
  AWS_S3_BUCKET_NAME: Joi.string().allow('').default(''),
  // 클라이언트가 직접 접근하는 스토리지 주소 (presigned URL 서명용). 비우면 AWS_S3_ENDPOINT를 쓴다.
  AWS_S3_PUBLIC_ENDPOINT: Joi.string().uri().allow('').default(''),

  EMBEDDING_API_KEY: Joi.string().allow('').default(''),
  EMBEDDING_BASE_URL: Joi.string()
    .uri()
    .default('https://openrouter.ai/api/v1'),
  EMBEDDING_MODEL: Joi.string().default('openai/text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().integer().positive().default(1536),
  // TEMP(test): 기동 시 test/fixtures/dummy-files를 테스트 사용자 드라이브에 업로드 (production에서는 무시). 배포 전 제거.
  SEED_DUMMY_DRIVE: Joi.boolean().default(true),
  DRIVE_SIMILARITY_THRESHOLD: Joi.number().min(0).max(1).default(0.55),
  // 휴지통 보관 일수. 이 기간이 지나면 매일 새벽 자동 영구 삭제된다.
  // ZIP 다운로드 한도 (서버가 직접 스트리밍하므로 제한한다)
  DOWNLOAD_ZIP_MAX_BYTES: Joi.number().integer().positive().default(2147483648),
  DOWNLOAD_ZIP_MAX_FILES: Joi.number().integer().positive().default(5000),
  TRASH_RETENTION_DAYS: Joi.number().integer().min(1).default(30),
});
