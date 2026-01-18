import { Migration } from "@mikro-orm/migrations";

export class Migration20251007164318 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "connected_accounts" drop constraint "connected_accounts_platform_check";`,
    );
    this.addSql(
      `alter table "connected_accounts" add constraint "connected_accounts_platform_check" check ("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );

    this.addSql(
      `alter table "conversations" drop constraint "conversations_platform_check";`,
    );
    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_check" check ("platform" in ('X', 'Instagram', 'LinkedIn', 'Telegram'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "connected_accounts" drop constraint "connected_accounts_platform_check";`,
    );
    this.addSql(
      `alter table "connected_accounts" add constraint "connected_accounts_platform_check" check ("platform" in ('X', 'Instagram', 'LinkedIn'));`,
    );

    this.addSql(
      `alter table "conversations" drop constraint "conversations_platform_check";`,
    );
    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_check" check ("platform" in ('X', 'Instagram', 'LinkedIn'));`,
    );
  }
}
