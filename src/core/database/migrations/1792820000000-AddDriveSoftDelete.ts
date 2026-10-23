import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 휴지통(soft delete)용 deleted_at.
 * - 폴더를 지우면 하위 폴더·항목에도 같은 deleted_at을 찍는다. 같은 값이라는 사실로 "폴더와 함께 지워진 것"을
 *   구분하고, 폴더를 복원할 때 함께 지워진 것만 되살린다. 따로 먼저 지운 항목은 값이 달라 그대로 휴지통에 남는다.
 * - 휴지통의 폴더는 이름 유일 제약에서 빠져야 같은 이름의 폴더를 다시 만들 수 있다.
 * - 보관 기간이 지난 행을 자동 삭제할 때 쓰는 부분 인덱스를 둔다.
 */
export class AddDriveSoftDelete1792820000000 implements MigrationInterface {
  name = 'AddDriveSoftDelete1792820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_folders" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_items" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(`DROP INDEX "public"."UQ_drive_folders_root_name"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_drive_folders_child_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_root_name" ON "drive_folders" ("owner_id", "name") WHERE "parent_id" IS NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_child_name" ON "drive_folders" ("owner_id", "parent_id", "name") WHERE "parent_id" IS NOT NULL AND "deleted_at" IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_drive_folders_deleted_at" ON "drive_folders" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_items_deleted_at" ON "drive_items" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_drive_items_deleted_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_drive_folders_deleted_at"`,
    );

    // 휴지통 폴더와 같은 이름의 폴더가 이미 있으면 유니크 인덱스 생성이 실패한다. 데이터를 지우지 않고 중단하므로
    // 휴지통을 비우거나 이름을 정리한 뒤 다시 롤백할 것. (휴지통에 있던 행은 롤백 후 일반 항목으로 보이게 된다.)
    await queryRunner.query(
      `DROP INDEX "public"."UQ_drive_folders_child_name"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_drive_folders_root_name"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_root_name" ON "drive_folders" ("owner_id", "name") WHERE "parent_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_drive_folders_child_name" ON "drive_folders" ("owner_id", "parent_id", "name") WHERE "parent_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_items" DROP COLUMN "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_folders" DROP COLUMN "deleted_at"`,
    );
  }
}
