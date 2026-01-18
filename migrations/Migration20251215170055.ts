import { Migration } from '@mikro-orm/migrations';

export class Migration20251215170055 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "conversations" add column "participants" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "conversations" drop column "participants";`);
  }

}
