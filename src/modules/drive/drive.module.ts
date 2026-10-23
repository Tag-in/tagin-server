import { Module } from '@nestjs/common';
import { DriveSearchController } from './controllers/drive-search.controller.js';
import { DriveSearchService } from './services/drive-search.service.js';
import { EmbeddingService } from './services/embedding.service.js';

@Module({
  controllers: [DriveSearchController],
  providers: [DriveSearchService, EmbeddingService],
  exports: [EmbeddingService],
})
export class DriveModule {}
