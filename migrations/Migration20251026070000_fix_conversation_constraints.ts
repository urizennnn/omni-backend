import { Migration } from "@mikro-orm/migrations";

export class Migration20251026070000_fix_conversation_constraints extends Migration {
  override async up(): Promise<void> {
    // Drop old unique constraints
    this.addSql(
      `alter table "conversations" drop constraint if exists "conversations_external_id_unique";`,
    );
    this.addSql(
      `alter table "conversations" drop constraint if exists "conversations_name_unique";`,
    );

    // Add new composite unique constraint on (platform, name, user_id)
    this.addSql(
      `alter table "conversations" add constraint "conversations_platform_name_user_id_unique" unique ("platform", "name", "user_id");`,
    );
  }

  override async down(): Promise<void> {
    // Drop composite constraint
    this.addSql(
      `alter table "conversations" drop constraint if exists "conversations_platform_name_user_id_unique";`,
    );

    // Restore old unique constraints
    this.addSql(
      `alter table "conversations" add constraint "conversations_external_id_unique" unique ("external_id");`,
    );
    this.addSql(
      `alter table "conversations" add constraint "conversations_name_unique" unique ("name");`,
    );
  }
}
