import { Migration } from "@mikro-orm/migrations";

export class Migration20251221193000_add_message_actor_mappings extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "message_actor_mappings" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "platform" text not null, "account_id" varchar(255) not null, "message_id" varchar(500) not null, "actor_user_id" varchar(255) not null, "sender_role" text not null, constraint "message_actor_mappings_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "message_actor_mappings_created_at_index" on "message_actor_mappings" ("created_at");`,
    );
    this.addSql(
      `alter table "message_actor_mappings" add constraint "message_actor_mappings_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "message_actor_mappings" add constraint "message_actor_mappings_platform_account_id_message_id_unique" unique ("platform", "account_id", "message_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "message_actor_mappings" drop constraint "message_actor_mappings_actor_user_id_foreign";`,
    );
    this.addSql(
      `drop table if exists "message_actor_mappings" cascade;`,
    );
  }
}
