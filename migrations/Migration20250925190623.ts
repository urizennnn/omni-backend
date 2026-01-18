import { Migration } from "@mikro-orm/migrations";

export class Migration20250925190623 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "users" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "email" text not null, "email_verified_at" timestamptz null, constraint "users_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "users" add constraint "users_email_unique" unique ("email");`,
    );

    this.addSql(
      `create table "user_otps" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "code" varchar not null, "expires_at" timestamptz not null, "verified_at" timestamptz null, constraint "user_otps_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "user_otps_user_id_idx" on "user_otps" ("user_id");`,
    );

    this.addSql(
      `alter table "user_otps" add constraint "user_otps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "user_otps" drop constraint "user_otps_user_id_foreign";`,
    );

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop table if exists "user_otps" cascade;`);
  }
}
