import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import { attachmentDisposition } from '../../common/utils/content-disposition.util.js';
import { errorMessage } from '../../common/utils/error-message.util.js';

/** DeleteObjects 한 번에 보낼 수 있는 최대 키 수 (S3 제한) */
const DELETE_BATCH_SIZE = 1000;

/** S3 호환 오브젝트 스토리지(AWS S3 / MinIO). 버킷은 환경변수로 고정한다. */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  /** presigned URL 서명용. 클라이언트가 접근하는 주소(AWS_S3_PUBLIC_ENDPOINT)로 서명해야 URL이 유효하다. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET_NAME');
    const endpoint = config.get<string>('AWS_S3_ENDPOINT') || undefined;
    const publicEndpoint =
      config.get<string>('AWS_S3_PUBLIC_ENDPOINT') || endpoint;
    const create = (endpoint: string | undefined) =>
      new S3Client({
        region: config.getOrThrow<string>('AWS_REGION'),
        credentials: {
          accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
        },
        endpoint,
        forcePathStyle: true, // MinIO 필수
      });
    this.client = create(endpoint);
    this.presignClient =
      publicEndpoint === endpoint ? this.client : create(publicEndpoint);
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

  /** 객체를 내려받는 임시 URL. 받을 때 파일명은 filename으로 저장되도록 응답 헤더를 지정한다. */
  getDownloadUrl(
    key: string,
    filename: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: attachmentDisposition(filename),
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** 객체를 스트림으로 읽는다 (서버가 ZIP으로 묶을 때 사용). 호출 측이 끝까지 읽거나 destroy해야 연결이 반환된다. */
  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body as Readable;
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
        this.logger.error(`객체 일괄 삭제 실패: ${errorMessage(e)}`);
        failed.push(...batch);
      }
    }
    return failed;
  }
}
