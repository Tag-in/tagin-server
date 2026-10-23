import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity.js';

// 값 추가만으로 확장되도록 DB enum 대신 varchar로 저장한다.
export enum AuthProvider {
  GOOGLE = 'google',
}

/** 사용자와 소셜 로그인 계정의 연결 (한 사용자가 여러 provider를 가질 수 있다) */
@Entity('user_identities')
@Unique(['provider', 'providerUserId'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  provider: AuthProvider;

  /** provider가 발급한 사용자 고유 ID (Google: sub) */
  @Column()
  providerUserId: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
