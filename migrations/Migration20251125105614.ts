import { Migration } from '@mikro-orm/migrations';

export class Migration20251125105614 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "sent_by" varchar(255) null;`);
    this.addSql(`alter table "messages" alter column "role" type text using ("role"::text);`);
    this.addSql(`alter table "messages" alter column "role" set not null;`);
    this.addSql(`alter table "messages" add constraint "messages_sent_by_foreign" foreign key ("sent_by") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop constraint "messages_sent_by_foreign";`);

    this.addSql(`alter table "messages" drop column "sent_by";`);

    this.addSql(`alter table "messages" alter column "role" type text using ("role"::text);`);
    this.addSql(`alter table "messages" alter column "role" drop not null;`);
  }

}
