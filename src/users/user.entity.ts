import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

// TODO: 요금제 정책 확정 후 조정 (임시 기본값 5GiB)
export const DEFAULT_STORAGE_LIMIT_BYTES = 5 * 1024 ** 3;

// bigint는 드라이버가 문자열로 반환하므로 number로 변환한다. (Number.MAX_SAFE_INTEGER ≈ 9PB)
const bigintToNumber = {
  to: (value?: number) => value,
  from: (value?: string | null) =>
    value === undefined || value === null ? value : Number(value),
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 소문자로 정규화해서 저장한다. */
  @Column({ unique: true })
  email: string;

  @Column()
  nickname: string;

  @Column({ type: 'varchar', nullable: true })
  profileImageUrl: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  termsAgreedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  privacyAgreedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  marketingAgreedAt: Date | null;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  storageUsedBytes: number;

  @Column({
    type: 'bigint',
    default: DEFAULT_STORAGE_LIMIT_BYTES,
    transformer: bigintToNumber,
  })
  storageLimitBytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /** 탈퇴 시 soft delete. 이후 유예 기간/데이터 정리 작업의 기준이 된다. */
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
