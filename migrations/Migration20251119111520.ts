import { Migration } from '@mikro-orm/migrations';

export class Migration20251119111520 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column "subject" varchar(255) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column "subject";`);
  }

}
