import { Migration } from "@mikro-orm/migrations";

export class Migration20251001160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "user_social_sessions" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "platform" text check ("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram')) not null, "access_token" text null, "refresh_token" text null, "session_token" text null, "expires_at" timestamptz null, constraint "user_social_sessions_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "user_social_sessions_user_id_platform_idx" on "user_social_sessions" ("user_id", "platform");`,
    );
    this.addSql(
      `alter table "user_social_sessions" add constraint "user_social_sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "user_social_sessions" drop constraint "user_social_sessions_user_id_foreign";`,
    );
    this.addSql(`drop table if exists "user_social_sessions" cascade;`);
  }
}
