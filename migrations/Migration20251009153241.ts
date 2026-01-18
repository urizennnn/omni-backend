import { Migration } from "@mikro-orm/migrations";

export class Migration20251009153241 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "contacts" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "platform" text check ("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram')) not null, "external_id" text not null, "username" text null, "display_name" text null, "platform_data" jsonb null, constraint "contacts_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "contacts_user_id_platform_external_id_index" on "contacts" ("user_id", "platform", "external_id");`,
    );

    this.addSql(
      `alter table "contacts" add constraint "contacts_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "contacts" cascade;`);
  }
}
