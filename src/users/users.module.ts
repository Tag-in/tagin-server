import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserIdentity } from './user-identity.entity.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
