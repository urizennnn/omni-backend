import { Migration } from '@mikro-orm/migrations';

export class Migration20251126120019_add_message_threading extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "message_id" varchar(500) null, add column "in_reply_to" varchar(500) null, add column "references" jsonb null, add column "thread_id" varchar(500) null, add column "parent_message_id" varchar(255) null;`);
    this.addSql(`alter table "messages" add constraint "messages_parent_message_id_foreign" foreign key ("parent_message_id") references "messages" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "messages_message_id_index" on "messages" ("message_id");`);
    this.addSql(`create index "messages_in_reply_to_index" on "messages" ("in_reply_to");`);
    this.addSql(`create index "messages_thread_id_index" on "messages" ("thread_id");`);
    this.addSql(`create index "messages_parent_message_id_index" on "messages" ("parent_message_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "messages_message_id_index";`);
    this.addSql(`drop index "messages_in_reply_to_index";`);
    this.addSql(`drop index "messages_thread_id_index";`);
    this.addSql(`drop index "messages_parent_message_id_index";`);
    this.addSql(`alter table "messages" drop constraint "messages_parent_message_id_foreign";`);
    this.addSql(`alter table "messages" drop column "message_id", drop column "in_reply_to", drop column "references", drop column "thread_id", drop column "parent_message_id";`);
  }

}
