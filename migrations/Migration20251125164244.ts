import { Migration } from '@mikro-orm/migrations';

export class Migration20251125164244 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "memos" drop constraint "memos_conversation_id_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "memos" add constraint "memos_conversation_id_unique" unique ("conversation_id");`);
  }

}
