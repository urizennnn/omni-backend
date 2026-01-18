import { Migration } from "@mikro-orm/migrations";

export class Migration20251023081347 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" add column "platform_data" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "conversations" drop column "platform_data";`);
  }
}
