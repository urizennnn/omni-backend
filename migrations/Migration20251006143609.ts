import { Migration } from "@mikro-orm/migrations";

export class Migration20251006143609 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "system_preferences" ("id" serial primary key, "active_platforms" jsonb not null);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "system_preferences" cascade;`);
  }
}
