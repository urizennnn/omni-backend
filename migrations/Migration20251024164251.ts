import { Migration } from "@mikro-orm/migrations";

export class Migration20251024164251 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" add constraint "conversations_name_unique" unique ("name");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint "conversations_name_unique";`,
    );
  }
}
