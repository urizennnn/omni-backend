import { Migration } from "@mikro-orm/migrations";

export class Migration20251114203224 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      DELETE FROM messages
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM messages
        GROUP BY external_message_id, conversation_id
      );
    `);

    this.addSql(
      `alter table "messages" add constraint "messages_external_message_id_conversation_id_unique" unique ("external_message_id", "conversation_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "messages" drop constraint "messages_external_message_id_conversation_id_unique";`,
    );
  }
}
