import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 1. S3 Client 초기화
export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // --- 로컬 S3(MinIO) 핵심 옵션 ---
  endpoint: process.env.AWS_S3_ENDPOINT, // http://localhost:9000
  forcePathStyle: true,                   // MinIO 필수 (localhost:9000/bucket-name)
});

// 2. 파일 업로드 함수 예시
export async function uploadFileToLocalS3(fileBuffer, fileName, mimeType) {
  const fileKey = `uploads/${Date.now()}_${fileName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileKey,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  // DB(PostgreSQL) 'files' 테이블에 저장할 데이터 반환
  return {
    bucketKey: fileKey,
    fileUrl: `${process.env.AWS_S3_ENDPOINT}/${process.env.AWS_S3_BUCKET_NAME}/${fileKey}`
  };
}