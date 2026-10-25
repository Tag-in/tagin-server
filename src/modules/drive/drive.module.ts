import { Module } from '@nestjs/common';
import { StorageModule } from '../../core/storage/storage.module.js';
import { DriveDownloadController } from './controllers/drive-download.controller.js';
import { DriveMoveController } from './controllers/drive-move.controller.js';
import { DriveSearchController } from './controllers/drive-search.controller.js';
import { DriveTrashController } from './controllers/drive-trash.controller.js';
import { DriveDownloadService } from './services/drive-download.service.js';
import { DriveDummySeeder } from './services/drive-dummy-seeder.service.js';
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
    DriveDownloadController,
  ],
  providers: [
    DriveSearchService,
    DriveMoveService,
    DriveTrashService,
    DriveDownloadService,
    TrashPurgeService,
    EmbeddingService,
    DriveDummySeeder,
  ],
  exports: [EmbeddingService],
})
export class DriveModule {}
