import { Migration } from '@mikro-orm/migrations';

export class Migration20251205120000_email_grouping_by_sender extends Migration {

  override async up(): Promise<void> {
    // Drop old domain indexes
    this.addSql(`drop index if exists "conversations_domain_index";`);
    this.addSql(`drop index if exists "conversations_user_platform_domain_index";`);

    // Rename domain column to sender_email
    this.addSql(`alter table "conversations" rename column "domain" to "sender_email";`);

    // Create new indexes for sender_email
    this.addSql(`create index "conversations_sender_email_index" on "conversations" ("sender_email");`);
    this.addSql(`create index "conversations_user_platform_sender_index" on "conversations" ("user_id", "platform", "sender_email");`);

    // Delete old domain-based parent conversations for email platform
    this.addSql(`delete from "conversations" where "conversation_type" = 'parent' and "platform" = 'email';`);

    // Nullify parent references for orphaned child conversations
    this.addSql(`update "conversations" set "parent_conversation_id" = null where "conversation_type" = 'child' and "platform" = 'email' and "parent_conversation_id" is not null;`);
  }

  override async down(): Promise<void> {
    // Drop new indexes
    this.addSql(`drop index if exists "conversations_sender_email_index";`);
    this.addSql(`drop index if exists "conversations_user_platform_sender_index";`);

    // Rename sender_email back to domain
    this.addSql(`alter table "conversations" rename column "sender_email" to "domain";`);

    // Recreate old domain indexes
    this.addSql(`create index "conversations_domain_index" on "conversations" ("domain");`);
    this.addSql(`create index "conversations_user_platform_domain_index" on "conversations" ("user_id", "platform", "domain");`);
  }

}
