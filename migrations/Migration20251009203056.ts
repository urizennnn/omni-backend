import { Migration } from "@mikro-orm/migrations";

export class Migration20251009203056 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" add column "text" varchar(255) null;`,
    );

    this.addSql(`alter table "messages" add column "text" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "conversations" drop column "text";`);

    this.addSql(`alter table "messages" drop column "text";`);
  }
}
