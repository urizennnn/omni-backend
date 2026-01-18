import { Entity, Enum, Index, ManyToOne, Property, Unique } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { SenderRole, SocialMediaPlatform } from "@app/types";
import { UserEntity } from "./user.entity";

@Entity({ tableName: "message_actor_mappings" })
@Unique({ properties: ["platform", "accountId", "messageId"] })
@Index({ properties: ["createdAt"] })
export class MessageActorMappingEntity extends BaseEntity {
  @Enum({ items: () => SocialMediaPlatform })
  platform: SocialMediaPlatform;

  @Property({ type: "string" })
  accountId: string;

  @Property({ type: "string", length: 500 })
  messageId: string;

  @ManyToOne(() => UserEntity, {
    fieldName: "actor_user_id",
    deleteRule: "cascade",
  })
  actorUser: UserEntity;

  @Property({ type: "string" })
  senderRole: SenderRole;
}
