import { Migration } from "@mikro-orm/migrations";

export class Migration20250929221244 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "conversations" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "external_id" varchar(255) not null, "platform" text check ("platform" in ('X', 'Instagram', 'LinkedIn')) not null, "account_id" varchar(255) not null, "unread_count" numeric(10,0) not null default 0, "state" varchar(255) not null default 'open', "name" varchar(255) not null, "user_id" varchar(255) not null, constraint "conversations_pkey" primary key ("id"));`,
    );

    this.addSql(
      `create table "messages" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "conversation_id_id" varchar(255) not null, "external_message_id" varchar(255) not null, "direction" varchar(255) not null, "status" text not null, "role" text null, "provide_original_payload" jsonb not null, constraint "messages_pkey" primary key ("id"));`,
    );

    this.addSql(
      `alter table "conversations" add constraint "conversations_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "messages" add constraint "messages_conversation_id_id_foreign" foreign key ("conversation_id_id") references "conversations" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "user_otps" drop constraint "user_otps_user_id_foreign";`,
    );

    this.addSql(
      `alter table "user_otps" add constraint "user_otps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "messages" drop constraint "messages_conversation_id_id_foreign";`,
    );

    this.addSql(`drop table if exists "conversations" cascade;`);

    this.addSql(`drop table if exists "messages" cascade;`);

    this.addSql(
      `alter table "user_otps" drop constraint "user_otps_user_id_foreign";`,
    );

    this.addSql(
      `alter table "user_otps" add constraint "user_otps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`,
    );
  }
}
