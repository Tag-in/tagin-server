import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../core/database/transformers/bigint.transformer.js';
import { User } from '../../users/entities/user.entity.js';

export enum FileStatus {
  /** 메타데이터만 생성되고 오브젝트 스토리지 업로드가 끝나지 않은 상태 */
  UPLOADING = 'UPLOADING',
  /** 업로드가 확인되어 조회·다운로드·분류 대상이 되는 상태 */
  READY = 'READY',
}

/**
 * 사용자가 업로드한 파일의 메타데이터. 실제 바이너리는 오브젝트 스토리지(S3/MinIO)에 있다.
 * 분류·태그 등 부가 정보는 이 테이블에 섞지 않고 file_id를 참조하는 별도 테이블로 둔다.
 */
@Entity('files')
@Index(['ownerId', 'createdAt'])
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  /** 사용자에게 보이는 파일명 (확장자 포함). 이름 변경 시 갱신된다. */
  @Column()
  name: string;

  /** 소문자, 점 제외 (예: 'pdf'). 확장자가 없으면 null */
  @Column({ type: 'varchar', nullable: true })
  extension: string | null;

  @Column()
  mimeType: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  sizeBytes: number;

  /** 오브젝트 스토리지의 객체 키. 버킷은 환경변수로 고정한다. */
  @Column({ unique: true })
  storageKey: string;

  /** 업로드 완료 후 계산한 SHA-256 (hex). 중복 감지·분류 캐시에 사용한다. */
  @Column({ type: 'char', length: 64, nullable: true })
  checksumSha256: string | null;

  @Column({ type: 'enum', enum: FileStatus, default: FileStatus.UPLOADING })
  status: FileStatus;

  @Column({ type: 'timestamptz', nullable: true })
  uploadedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /** 휴지통 이동 시 soft delete. 실제 객체 삭제는 별도 정리 작업에서 한다. */
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
