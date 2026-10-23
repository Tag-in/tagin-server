import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 중요 표시(별표)용 starred_at. 값이 있으면 중요 항목이고 표시한 시각이다.
 * - 휴지통으로 보내도 값은 유지하고, 중요 목록에서만 휴지통 항목을 뺀다 (복원하면 다시 보인다).
 * - 중요 목록(사용자별 starred_at 순)과 최근 파일(사용자별 created_at 순) 조회용 부분 인덱스를 둔다.
 */
export class AddDriveStarred1792830000000 implements MigrationInterface {
  name = 'AddDriveStarred1792830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ADD "starred_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_items" ADD "starred_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_folders_starred" ON "drive_folders" ("owner_id", "starred_at") WHERE "starred_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_items_starred" ON "drive_items" ("owner_id", "starred_at") WHERE "starred_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_items_owner_created" ON "drive_items" ("owner_id", "created_at" DESC) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_drive_items_owner_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_drive_items_starred"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_drive_folders_starred"`);
    await queryRunner.query(
      `ALTER TABLE "drive_items" DROP COLUMN "starred_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" DROP COLUMN "starred_at"`,
    );
  }
}
