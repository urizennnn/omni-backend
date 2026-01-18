import { Migration } from "@mikro-orm/migrations";

export class Migration20251026071727_AddSentAtToMessages extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "messages" add column "sent_at" timestamptz null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column "sent_at";`);
  }
}
