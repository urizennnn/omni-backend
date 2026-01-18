import { Migration } from "@mikro-orm/migrations";

export class Migration20251105151929 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint if exists "conversations_platform_check";`,
    );

    this.addSql(
      `alter table "contacts" drop constraint if exists "contacts_platform_check";`,
    );

    this.addSql(
      `alter table "connected_accounts" drop constraint if exists "connected_accounts_platform_check";`,
    );

    this.addSql(
      `alter table "user_social_sessions" drop constraint if exists "user_social_sessions_platform_check";`,
    );

    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram', 'Email'));`,
    );

    this.addSql(
      `alter table "contacts" add constraint "contacts_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram', 'Email'));`,
    );

    this.addSql(
      `alter table "connected_accounts" add constraint "connected_accounts_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram', 'Email'));`,
    );

    this.addSql(
      `alter table "user_social_sessions" add constraint "user_social_sessions_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram', 'Email'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "conversations" drop constraint if exists "conversations_platform_check";`,
    );

    this.addSql(
      `alter table "contacts" drop constraint if exists "contacts_platform_check";`,
    );

    this.addSql(
      `alter table "connected_accounts" drop constraint if exists "connected_accounts_platform_check";`,
    );

    this.addSql(
      `alter table "user_social_sessions" drop constraint if exists "user_social_sessions_platform_check";`,
    );

    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );

    this.addSql(
      `alter table "contacts" add constraint "contacts_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );

    this.addSql(
      `alter table "connected_accounts" add constraint "connected_accounts_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );

    this.addSql(
      `alter table "user_social_sessions" add constraint "user_social_sessions_platform_check" check("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );
  }
}
