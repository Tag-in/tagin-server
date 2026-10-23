import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1792757996842 implements MigrationInterface {
  name = 'CreateUsers1792757996842';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('ACTIVE', 'SUSPENDED', 'WITHDRAWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying NOT NULL, "nickname" character varying NOT NULL, "profile_image_url" character varying, "status" "public"."users_status_enum" NOT NULL DEFAULT 'ACTIVE', "role" "public"."users_role_enum" NOT NULL DEFAULT 'USER', "email_verified_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "terms_agreed_at" TIMESTAMP WITH TIME ZONE, "privacy_agreed_at" TIMESTAMP WITH TIME ZONE, "marketing_agreed_at" TIMESTAMP WITH TIME ZONE, "storage_used_bytes" bigint NOT NULL DEFAULT '0', "storage_limit_bytes" bigint NOT NULL DEFAULT '5368709120', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_identities" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "provider" character varying NOT NULL, "provider_user_id" character varying NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_bd1b586943a2a13643a6d1878e8" UNIQUE ("provider", "provider_user_id"), CONSTRAINT "PK_e23bff04e9c3e7b785e442b262c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf5fe01eb8cad7114b4c371cdc" ON "user_identities"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_identities" ADD CONSTRAINT "FK_bf5fe01eb8cad7114b4c371cdc7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_identities" DROP CONSTRAINT "FK_bf5fe01eb8cad7114b4c371cdc7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf5fe01eb8cad7114b4c371cdc"`,
    );
    await queryRunner.query(`DROP TABLE "user_identities"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
  }
}
