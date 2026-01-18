import { Migration } from "@mikro-orm/migrations";

export class Migration20250930004500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "oauth_states" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "state" text not null, "code_verifier" text not null, "redirect_uri" text not null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, constraint "oauth_states_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "oauth_states" add constraint "oauth_states_state_unique" unique ("state");`,
    );
    this.addSql(
      `create index "oauth_states_user_id_idx" on "oauth_states" ("user_id");`,
    );
    this.addSql(
      `alter table "oauth_states" add constraint "oauth_states_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `create table "connected_accounts" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "platform" text check ("platform" in ('X', 'Instagram', 'LinkedIn')) not null, "status" varchar(255) not null, "access_token" varchar(255) not null, "refresh_token" varchar(255) null, "expires_at" timestamptz null, "polling_interval" varchar(255) not null, "job_key" varchar(255) not null, "last_polled_at" timestamptz not null, "external_account_id" text null, "cursor" jsonb null, constraint "connected_accounts_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "connected_accounts_user_id_idx" on "connected_accounts" ("user_id");`,
    );
    this.addSql(
      `alter table "connected_accounts" add constraint "connected_accounts_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "oauth_states" drop constraint "oauth_states_user_id_foreign";`,
    );
    this.addSql(`drop table if exists "oauth_states" cascade;`);

    this.addSql(
      `alter table "connected_accounts" drop constraint "connected_accounts_user_id_foreign";`,
    );
    this.addSql(`drop table if exists "connected_accounts" cascade;`);
  }
}
