import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * drive_folders를 계층 구조로 확장한다.
 * - parent_id: 상위 폴더 (null이면 최상위). 상위가 hard delete되면 하위도 함께 지워진다.
 * - centroid: 직속 항목이 없는 폴더(빈 폴더, 항목을 모두 옮긴 폴더)는 대표 벡터가 없으므로 nullable로 바꾼다.
 *   centroid는 폴더 직속 항목 벡터의 합이며 하위 폴더 항목은 포함하지 않는다. 그래서 폴더를 옮겨도 갱신할 필요가 없다.
 * - 같은 위치에서 폴더명은 유일하다. NULL(최상위)은 unique에서 서로 다른 값이라 인덱스를 둘로 나눈다.
 */
export class AddDriveFolderHierarchy1792810000000 implements MigrationInterface {
  name = 'AddDriveFolderHierarchy1792810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drive_folders" ADD "parent_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ALTER COLUMN "centroid" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ADD CONSTRAINT "FK_drive_folders_parent" FOREIGN KEY ("parent_id") REFERENCES "drive_folders"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_folders_parent" ON "drive_folders" ("parent_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_root_name" ON "drive_folders" ("owner_id", "name") WHERE "parent_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_child_name" ON "drive_folders" ("owner_id", "parent_id", "name") WHERE "parent_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_drive_folders_child_name"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_drive_folders_root_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_drive_folders_parent"`);
    await queryRunner.query(
      `ALTER TABLE "drive_folders" DROP CONSTRAINT "FK_drive_folders_parent"`,
    );
    // NOT NULL로 되돌리기 위해 대표 벡터가 없는 폴더는 영벡터(1536차원)로 채운다.
    await queryRunner.query(
      `UPDATE "drive_folders" SET "centroid" = array_fill(0, ARRAY[1536])::vector WHERE "centroid" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ALTER COLUMN "centroid" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" DROP COLUMN "parent_id"`,
    );
  }
}
