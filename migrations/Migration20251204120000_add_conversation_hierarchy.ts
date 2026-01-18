import { Migration } from '@mikro-orm/migrations';

export class Migration20251204120000_add_conversation_hierarchy extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "conversations" add column "parent_conversation_id" varchar(255) null, add column "conversation_type" varchar(20) null, add column "domain" varchar(255) null;`);
    this.addSql(`alter table "conversations" add constraint "conversations_parent_conversation_id_foreign" foreign key ("parent_conversation_id") references "conversations" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "conversations_parent_conversation_id_index" on "conversations" ("parent_conversation_id");`);
    this.addSql(`create index "conversations_domain_index" on "conversations" ("domain");`);
    this.addSql(`create index "conversations_conversation_type_index" on "conversations" ("conversation_type");`);
    this.addSql(`create index "conversations_user_platform_domain_index" on "conversations" ("user_id", "platform", "domain");`);
    this.addSql(`alter table "conversations" drop constraint if exists "conversations_platform_name_user_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "conversations_parent_conversation_id_index";`);
    this.addSql(`drop index "conversations_domain_index";`);
    this.addSql(`drop index "conversations_conversation_type_index";`);
    this.addSql(`drop index "conversations_user_platform_domain_index";`);
    this.addSql(`alter table "conversations" drop constraint "conversations_parent_conversation_id_foreign";`);
    this.addSql(`alter table "conversations" drop column "parent_conversation_id", drop column "conversation_type", drop column "domain";`);
  }

}
