import { Migration } from "@mikro-orm/migrations";

export class Migration20251007153417 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop table if exists "system_preferences" cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `create table "system_preferences" ("id" serial primary key, "active_platforms" jsonb not null);`,
    );
  }
}
