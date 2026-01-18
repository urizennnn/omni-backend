import { Entity, Enum, Index, ManyToOne, Property } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { SocialMediaPlatform } from "@app/types";
import { UserEntity } from "@app/entities/user.entity";

@Entity({ tableName: "contacts" })
@Index({ properties: ["user", "platform", "externalId"] })
export class ContactEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { deleteRule: "cascade", nullable: false })
  user!: UserEntity;

  @Enum({ items: () => SocialMediaPlatform, nullable: false })
  platform!: SocialMediaPlatform;

  @Property({ columnType: "text", nullable: false, unique: true })
  externalId: string;

  @Property({ columnType: "text", nullable: true })
  username?: string;

  @Property({ columnType: "text", nullable: true })
  displayName?: string;

  @Property({ columnType: "jsonb", nullable: true })
  platformData?: Record<string, unknown>;
}
