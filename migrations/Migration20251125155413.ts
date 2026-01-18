import { Migration } from '@mikro-orm/migrations';

export class Migration20251125155413 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "memos" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "conversation_id" varchar(255) not null, "content" text not null, constraint "memos_pkey" primary key ("id"));`);
    this.addSql(`alter table "memos" add constraint "memos_conversation_id_unique" unique ("conversation_id");`);

    this.addSql(`alter table "memos" add constraint "memos_conversation_id_foreign" foreign key ("conversation_id") references "conversations" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "memos" cascade;`);
  }

}
