import { Migration } from "@mikro-orm/migrations";

export class Migration20251001092744 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "roles" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" text not null, constraint "roles_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "roles" add constraint "roles_name_unique" unique ("name");`,
    );

    this.addSql(
      `alter table "user_otps" drop constraint "user_otps_user_id_foreign";`,
    );

    this.addSql(
      `alter table "users" add column "first_name" text not null, add column "last_name" text not null, add column "role_id" varchar(255) not null, add column "status" text not null, add column "disabled" boolean null default false, add column "platform_access" jsonb not null;`,
    );
    this.addSql(
      `alter table "users" add constraint "users_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade;`,
    );

    this.addSql(
      `alter table "user_otps" add constraint "user_otps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop constraint "users_role_id_foreign";`);

    this.addSql(`drop table if exists "roles" cascade;`);

    this.addSql(
      `alter table "user_otps" drop constraint "user_otps_user_id_foreign";`,
    );

    this.addSql(
      `alter table "users" drop column "first_name", drop column "last_name", drop column "role_id", drop column "status", drop column "disabled", drop column "platform_access";`,
    );

    this.addSql(
      `alter table "user_otps" add constraint "user_otps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`,
    );
  }
}
