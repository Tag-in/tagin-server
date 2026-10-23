import { Module } from '@nestjs/common';
import { DriveMoveController } from './controllers/drive-move.controller.js';
import { DriveSearchController } from './controllers/drive-search.controller.js';
import { DriveMoveService } from './services/drive-move.service.js';
import { DriveSearchService } from './services/drive-search.service.js';
import { EmbeddingService } from './services/embedding.service.js';

@Module({
  controllers: [DriveSearchController, DriveMoveController],
  providers: [DriveSearchService, DriveMoveService, EmbeddingService],
  exports: [EmbeddingService],
})
export class DriveModule {}
