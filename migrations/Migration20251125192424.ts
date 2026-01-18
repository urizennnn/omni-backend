import { Migration } from '@mikro-orm/migrations';

export class Migration20251125192424 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "activity_logs" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) null, "description" text not null, "action" text not null, "resource_type" text null, "resource_id" text null, "method" text null, "path" text null, "ip_address" text null, "status_code" integer null, "metadata" jsonb null, constraint "activity_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "activity_logs_action_index" on "activity_logs" ("action");`);
    this.addSql(`create index "activity_logs_user_id_created_at_index" on "activity_logs" ("user_id", "created_at");`);

    this.addSql(`alter table "activity_logs" add constraint "activity_logs_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "activity_logs" cascade;`);
  }

}
