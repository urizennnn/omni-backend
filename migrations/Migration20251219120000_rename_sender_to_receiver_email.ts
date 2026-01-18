import { Migration } from '@mikro-orm/migrations';

export class Migration20251219120000 extends Migration {

  override async up(): Promise<void> {
    // Drop old indexes
    this.addSql(`drop index if exists "conversations_sender_email_index";`);
    this.addSql(`drop index if exists "conversations_user_platform_sender_index";`);

    // Rename column
    this.addSql(`alter table "conversations" rename column "sender_email" to "receiver_email";`);

    // Create new indexes
    this.addSql(`create index "conversations_receiver_email_index" on "conversations" ("receiver_email");`);
    this.addSql(`create index "conversations_user_platform_receiver_index" on "conversations" ("user_id", "platform", "receiver_email");`);

    // Clear old data as it's incorrect (stored sender instead of receiver)
    this.addSql(`update "conversations" set "receiver_email" = null where "platform" = 'email';`);
  }

  override async down(): Promise<void> {
    // Drop new indexes
    this.addSql(`drop index if exists "conversations_receiver_email_index";`);
    this.addSql(`drop index if exists "conversations_user_platform_receiver_index";`);

    // Rename column back
    this.addSql(`alter table "conversations" rename column "receiver_email" to "sender_email";`);

    // Recreate old indexes
    this.addSql(`create index "conversations_sender_email_index" on "conversations" ("sender_email");`);
    this.addSql(`create index "conversations_user_platform_sender_index" on "conversations" ("user_id", "platform", "sender_email");`);
  }

}
