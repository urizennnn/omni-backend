import { Migration } from "@mikro-orm/migrations";

export class Migration20251009203401 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "messages" drop constraint "messages_conversation_id_id_foreign";`,
    );

    this.addSql(
      `alter table "messages" rename column "conversation_id_id" to "conversation_id";`,
    );
    this.addSql(
      `alter table "messages" add constraint "messages_conversation_id_foreign" foreign key ("conversation_id") references "conversations" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "messages" drop constraint "messages_conversation_id_foreign";`,
    );

    this.addSql(
      `alter table "messages" rename column "conversation_id" to "conversation_id_id";`,
    );
    this.addSql(
      `alter table "messages" add constraint "messages_conversation_id_id_foreign" foreign key ("conversation_id_id") references "conversations" ("id") on update cascade on delete cascade;`,
    );
  }
}
