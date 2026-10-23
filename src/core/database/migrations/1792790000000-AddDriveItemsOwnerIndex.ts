import { MigrationInterface, QueryRunner } from 'typeorm';

/** 폴더를 지정하지 않은 드라이브 검색(owner 전체)이 다른 사용자 항목까지 스캔하지 않도록 한다. */
export class AddDriveItemsOwnerIndex1792790000000 implements MigrationInterface {
  name = 'AddDriveItemsOwnerIndex1792790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_items_owner" ON "drive_items" ("owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_drive_items_owner"`);
  }
}
