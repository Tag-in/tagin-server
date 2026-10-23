import { Module } from '@nestjs/common';
import { StorageModule } from '../../core/storage/storage.module.js';
import { UsersModule } from '../users/users.module.js';
import { DriveBrowseController } from './controllers/drive-browse.controller.js';
import { DriveDownloadController } from './controllers/drive-download.controller.js';
import { DriveMoveController } from './controllers/drive-move.controller.js';
import { DriveRecentController } from './controllers/drive-recent.controller.js';
import { DriveSearchController } from './controllers/drive-search.controller.js';
import { DriveStarController } from './controllers/drive-star.controller.js';
import { DriveStorageController } from './controllers/drive-storage.controller.js';
import { DriveTrashController } from './controllers/drive-trash.controller.js';
import { DriveUploadController } from './controllers/drive-upload.controller.js';
import { DriveBrowseService } from './services/drive-browse.service.js';
import { DriveDownloadService } from './services/drive-download.service.js';
import { DriveDummySeeder } from './services/drive-dummy-seeder.service.js';
import { DriveMoveService } from './services/drive-move.service.js';
import { DriveRecentService } from './services/drive-recent.service.js';
import { DriveSearchService } from './services/drive-search.service.js';
import { DriveStarService } from './services/drive-star.service.js';
import { DriveStorageService } from './services/drive-storage.service.js';
import { DriveTrashService } from './services/drive-trash.service.js';
import { DriveUploadService } from './services/drive-upload.service.js';
import { EmbeddingService } from './services/embedding.service.js';
import { TrashPurgeService } from './services/trash-purge.service.js';

@Module({
  // 저장 용량 한도는 users가 가진다 (drive → users 한 방향 참조).
  imports: [StorageModule, UsersModule],
  controllers: [
    DriveBrowseController,
    DriveUploadController,
    DriveSearchController,
    DriveMoveController,
    DriveTrashController,
    DriveDownloadController,
    DriveRecentController,
    DriveStarController,
    DriveStorageController,
  ],
  providers: [
    DriveBrowseService,
    DriveUploadService,
    DriveSearchService,
    DriveMoveService,
    DriveTrashService,
    DriveDownloadService,
    DriveRecentService,
    DriveStarService,
    DriveStorageService,
    TrashPurgeService,
    EmbeddingService,
    DriveDummySeeder,
  ],
  exports: [EmbeddingService],
})
export class DriveModule {}
