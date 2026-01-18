import { Migration } from '@mikro-orm/migrations';

export class Migration20251215120000_remove_child_conversations extends Migration {

  override async up(): Promise<void> {
    // Step 1: Re-link messages from child to parent conversations
    this.addSql(`
      UPDATE messages m
      SET conversation_id = c.parent_conversation_id
      FROM conversations c
      WHERE m.conversation_id = c.id
        AND c.conversation_type = 'child'
        AND c.parent_conversation_id IS NOT NULL;
    `);

    // Step 2: Update parent conversation preview text with latest message
    this.addSql(`
      UPDATE conversations parent
      SET text = subquery.latest_text
      FROM (
        SELECT
          c.parent_conversation_id,
          m.text as latest_text,
          ROW_NUMBER() OVER (PARTITION BY c.parent_conversation_id ORDER BY m.sent_at DESC) as rn
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.parent_conversation_id
        WHERE c.conversation_type = 'child'
          AND c.parent_conversation_id IS NOT NULL
      ) subquery
      WHERE parent.id = subquery.parent_conversation_id
        AND subquery.rn = 1;
    `);

    // Step 3: Delete child conversation records
    this.addSql(`
      DELETE FROM conversations
      WHERE conversation_type = 'child';
    `);
  }

  override async down(): Promise<void> {
    // Cannot reverse this migration reliably
    throw new Error('This migration cannot be reversed');
  }

}
