import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserIdentity } from './entities/user-identity.entity.js';
import { User } from './entities/user.entity.js';
import { TestUserSeeder } from './services/test-user.seeder.js';
import { UsersService } from './services/users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity])],
  providers: [UsersService, TestUserSeeder],
  exports: [UsersService],
})
export class UsersModule {}
