import { Module } from '@nestjs/common';
import { StorageModule } from '../../core/storage/storage.module.js';
import { DriveMoveController } from './controllers/drive-move.controller.js';
import { DriveSearchController } from './controllers/drive-search.controller.js';
import { DriveTrashController } from './controllers/drive-trash.controller.js';
import { DriveMoveService } from './services/drive-move.service.js';
import { DriveSearchService } from './services/drive-search.service.js';
import { DriveTrashService } from './services/drive-trash.service.js';
import { EmbeddingService } from './services/embedding.service.js';
import { TrashPurgeService } from './services/trash-purge.service.js';

@Module({
  imports: [StorageModule],
  controllers: [
    DriveSearchController,
    DriveMoveController,
    DriveTrashController,
  ],
  providers: [
    DriveSearchService,
    DriveMoveService,
    DriveTrashService,
    TrashPurgeService,
    EmbeddingService,
  ],
  exports: [EmbeddingService],
})
export class DriveModule {}
