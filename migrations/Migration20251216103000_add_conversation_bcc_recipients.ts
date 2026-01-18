import { Migration } from '@mikro-orm/migrations';

export class Migration20251216103000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "conversations" add column "bcc_recipients" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "conversations" drop column "bcc_recipients";`);
  }

}
