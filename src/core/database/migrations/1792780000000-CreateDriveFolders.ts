import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 드라이브 폴더/항목과 벡터 검색용 테이블. 벡터 차원(1536)은 EMBEDDING_DIMENSIONS와 같아야 한다.
 * pgvector 확장이 필요하다 (docker-compose의 pgvector/pgvector 이미지에 포함).
 */
export class CreateDriveFolders1792780000000 implements MigrationInterface {
  name = 'CreateDriveFolders1792780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(
      `CREATE TABLE "drive_folders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "name" character varying NOT NULL, "centroid" vector(1536) NOT NULL, "item_count" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_drive_folders" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_folders_owner" ON "drive_folders" ("owner_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ADD CONSTRAINT "FK_drive_folders_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "folder_id" uuid NOT NULL, "kind" character varying NOT NULL, "name" character varying NOT NULL, "mime_type" character varying, "size_bytes" bigint, "storage_key" character varying, "url" text, "checksum_sha256" character(64), "summary" text, "embedding" vector(1536) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_drive_items_storage_key" UNIQUE ("storage_key"), CONSTRAINT "PK_drive_items" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_items_folder" ON "drive_items" ("folder_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_items" ADD CONSTRAINT "FK_drive_items_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_items" ADD CONSTRAINT "FK_drive_items_folder" FOREIGN KEY ("folder_id") REFERENCES "drive_folders"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drive_items"`);
    await queryRunner.query(`DROP TABLE "drive_folders"`);
    // vector 확장은 다른 곳에서 쓸 수 있어 남겨둔다.
  }
}
