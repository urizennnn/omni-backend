import { Entity, Enum, ManyToOne, Property } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { AccountStatus, SocialMediaPlatform } from "@app/types";
import { UserEntity } from "@app/entities/user.entity";

@Entity({ tableName: "connected_accounts" })
export class ConnectedAccountsEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { deleteRule: "cascade" })
  user!: UserEntity;

  @Enum({ items: () => SocialMediaPlatform, nullable: false })
  platform: SocialMediaPlatform;

  @Property({ type: "string", nullable: false })
  status: AccountStatus;

  @Property({ type: "timestamptz", nullable: true })
  expiresAt?: Date;

  @Property({ type: "string", nullable: false })
  pollingInterval?: number;

  @Property({ type: "string", nullable: false })
  jobKey: string;

  @Property({ type: "timestamptz", nullable: false })
  lastPolledAt: Date;

  @Property({ type: "text", nullable: true })
  externalAccountId?: string | null;

  @Property({ type: "jsonb", nullable: true })
  cursor?: Record<string, unknown> | null;
}
