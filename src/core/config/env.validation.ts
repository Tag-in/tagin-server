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

  GOOGLE_WEB_CLIENT_ID: Joi.string().required(),
  GOOGLE_IOS_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_ANDROID_CLIENT_ID: Joi.string().allow('').default(''),

  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  AWS_S3_ENDPOINT: Joi.string().uri().allow('').default(''),
  AWS_S3_BUCKET_NAME: Joi.string().allow('').default(''),

  EMBEDDING_API_KEY: Joi.string().allow('').default(''),
  EMBEDDING_BASE_URL: Joi.string().uri().default('https://api.openai.com/v1'),
  EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().integer().positive().default(1536),
  DRIVE_SIMILARITY_THRESHOLD: Joi.number().min(0).max(1).default(0.55),
  // 휴지통 보관 일수. 이 기간이 지나면 매일 새벽 자동 영구 삭제된다.
  TRASH_RETENTION_DAYS: Joi.number().integer().min(1).default(30),
});
