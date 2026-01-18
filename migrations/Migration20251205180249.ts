import { Migration } from "@mikro-orm/migrations";

export class Migration20251205180249 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint "conversations_platform_name_user_id_unique";`,
    );

    this.addSql(
      `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'conversations_parent_conversation_id_foreign') then
          alter table "conversations" add constraint "conversations_parent_conversation_id_foreign" foreign key ("parent_conversation_id") references "conversations" ("id") on update cascade on delete set null;
        end if;
      end $$;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint "conversations_parent_conversation_id_foreign";`,
    );

    this.addSql(
      `alter table "conversations" drop column "parent_conversation_id", drop column "conversation_type";`,
    );

    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_name_user_id_unique" unique ("platform", "name", "user_id");`,
    );
  }
}
