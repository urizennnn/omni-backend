import { Migration } from "@mikro-orm/migrations";

export class Migration20251014212202 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create index "conversations_platform_name_index" on "conversations" ("platform", "name");`,
    );
    this.addSql(
      `create index "conversations_external_id_platform_account_id_index" on "conversations" ("external_id", "platform", "account_id");`,
    );
    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_external_id_unique" unique ("platform", "external_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "conversations_platform_name_index";`);
    this.addSql(
      `drop index "conversations_external_id_platform_account_id_index";`,
    );
    this.addSql(
      `alter table "conversations" drop constraint "conversations_platform_external_id_unique";`,
    );
  }
}
