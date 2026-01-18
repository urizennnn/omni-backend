import { Migration } from "@mikro-orm/migrations";

export class Migration20251007154214 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "connected_accounts" drop column "access_token", drop column "refresh_token";`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "connected_accounts" add column "access_token" varchar(255) not null, add column "refresh_token" varchar(255) null;`,
    );
  }
}
