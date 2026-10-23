import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** DeleteObjects 한 번에 보낼 수 있는 최대 키 수 (S3 제한) */
const DELETE_BATCH_SIZE = 1000;

/** S3 호환 오브젝트 스토리지(AWS S3 / MinIO). 버킷은 환경변수로 고정한다. */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET_NAME');
    this.client = new S3Client({
      region: config.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
      endpoint: config.get<string>('AWS_S3_ENDPOINT') || undefined,
      forcePathStyle: true, // MinIO 필수
    });
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  }

  /**
   * 객체를 지우고 지우지 못한 키를 반환한다. 없는 키를 지우는 것은 S3에서 성공이라 재시도해도 안전하다.
   * 호출 측은 반환된 키의 DB 행을 남겨 다음 실행에서 다시 시도해야 한다.
   */
  async deleteMany(keys: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      try {
        const res = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        for (const error of res.Errors ?? []) {
          this.logger.warn(`객체 삭제 실패 ${error.Key}: ${error.Code}`);
          if (error.Key) failed.push(error.Key);
        }
      } catch (e) {
        this.logger.error(`객체 일괄 삭제 실패: ${(e as Error).message}`);
        failed.push(...batch);
      }
    }
    return failed;
  }
}
