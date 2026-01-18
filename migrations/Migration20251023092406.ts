import { Migration } from "@mikro-orm/migrations";

export class Migration20251023092406 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" alter column "text" type text using "text"::text;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" alter column "text" type varchar(255) using "text"::varchar(255);`,
    );
  }
}
