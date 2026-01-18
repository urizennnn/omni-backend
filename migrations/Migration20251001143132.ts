import { Migration } from "@mikro-orm/migrations";

export class Migration20251001143132 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "users" add column "two_factor_secret" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "two_factor_secret";`);
  }
}
