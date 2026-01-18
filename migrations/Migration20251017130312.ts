import { Migration } from "@mikro-orm/migrations";

export class Migration20251017130312 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "out" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column "out";`);
  }
}
