import { join } from 'node:path';
import { registerAs } from '@nestjs/config';
import type { DataSourceOptions } from 'typeorm';

// Nest 런타임(DatabaseModule)과 TypeORM CLI(data-source.ts)가 같은 설정을 공유한다.
export const databaseConfig = registerAs('database', (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [join(import.meta.dirname, '..', '**', '*.entity.js')],
  migrations: [join(import.meta.dirname, 'migrations', '*.js')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'local' ? ['error', 'warn'] : ['error'],
}));
