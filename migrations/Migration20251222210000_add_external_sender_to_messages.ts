import { Migration } from '@mikro-orm/migrations';

export class Migration20251222210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "external_sender_email" text null;`);
    this.addSql(`alter table "messages" add column "external_sender_name" text null;`);
    
    this.addSql(`create index "messages_external_sender_email_index" on "messages" ("external_sender_email");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "messages_external_sender_email_index";`);
    this.addSql(`alter table "messages" drop column "external_sender_email";`);
    this.addSql(`alter table "messages" drop column "external_sender_name";`);
  }

}