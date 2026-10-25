import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 업로드 파일 모델을 drive_items(+drive_folders)로 일원화하면서 사용처 없는 files 테이블을 제거한다.
 * files에는 쓰는 코드가 없었다. 운영에 데이터가 있다면 임베딩이 없어 drive_items로 옮길 수 없으므로 먼저 확인할 것.
 */
export class DropFiles1792800000000 implements MigrationInterface {
  name = 'DropFiles1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_858dd7d1a5f2680af8d2fc3d9b"`,
    );
    await queryRunner.query(`DROP TABLE "files"`);
    await queryRunner.query(`DROP TYPE "public"."files_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."files_status_enum" AS ENUM('UPLOADING', 'READY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "name" character varying NOT NULL, "extension" character varying, "mime_type" character varying NOT NULL, "size_bytes" bigint NOT NULL, "storage_key" character varying NOT NULL, "checksum_sha256" character(64), "status" "public"."files_status_enum" NOT NULL DEFAULT 'UPLOADING', "uploaded_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e916afbf2015d561fd0842ff898" UNIQUE ("storage_key"), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_858dd7d1a5f2680af8d2fc3d9b" ON "files"  ("owner_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
