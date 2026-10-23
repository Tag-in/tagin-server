import { DataSource } from 'typeorm';
import { databaseConfig } from './database.config.js';

// TypeORM CLI 전용 진입점 (빌드 결과물 dist/database/data-source.js 기준으로 실행)
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 이미 주입된 환경변수를 사용한다.
}

export default new DataSource(databaseConfig());
