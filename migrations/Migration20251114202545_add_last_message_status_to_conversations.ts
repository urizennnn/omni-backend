import { Migration } from "@mikro-orm/migrations";

export class Migration20251114202545_add_last_message_status_to_conversations extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" add column "last_message_status" varchar(255) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop column "last_message_status";`,
    );
  }
}
