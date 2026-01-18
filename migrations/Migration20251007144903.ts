import { Migration } from "@mikro-orm/migrations";

export class Migration20251007144903 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "system_preferences" alter column "id" type int using ("id"::int);`,
    );
    this.addSql(
      `alter table "system_preferences" alter column "id" set default 1;`,
    );

    this.addSql(`alter table "users" add column "phone_number" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "system_preferences" alter column "id" drop default;`,
    );
    this.addSql(
      `alter table "system_preferences" alter column "id" type int using ("id"::int);`,
    );

    this.addSql(`alter table "users" drop column "phone_number";`);
  }
}
