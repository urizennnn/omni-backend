import { Migration } from '@mikro-orm/migrations';

export class Migration20251216114000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "participants" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column "participants";`);
  }

}
