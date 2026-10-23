import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { File } from './entities/file.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([File])],
})
export class FilesModule {}
