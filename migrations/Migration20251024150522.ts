import { Migration } from "@mikro-orm/migrations";

export class Migration20251024150522 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" alter column "text" type text using ("text"::text);`,
    );
    this.addSql(
      `alter table "conversations" add constraint "conversations_external_id_unique" unique ("external_id");`,
    );

    this.addSql(
      `alter table "contacts" add constraint "contacts_external_id_unique" unique ("external_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint "conversations_external_id_unique";`,
    );

    this.addSql(
      `alter table "conversations" alter column "text" type varchar(255) using ("text"::varchar(255));`,
    );

    this.addSql(
      `alter table "contacts" drop constraint "contacts_external_id_unique";`,
    );
  }
}
