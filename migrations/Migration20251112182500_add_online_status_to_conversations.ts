import { Migration } from "@mikro-orm/migrations";

export class Migration20251112182500_add_online_status_to_conversations extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" add column "online" boolean null default false, add column "last_seen" timestamptz null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop column "online", drop column "last_seen";`,
    );
  }
}
