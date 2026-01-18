import { Entity, Enum, Index, ManyToOne, Property } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { SocialMediaPlatform } from "@app/types";
import { UserEntity } from "@app/entities/user.entity";

@Entity({ tableName: "user_social_sessions" })
@Index({ properties: ["user", "platform"] })
export class UserSocialSessionEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { deleteRule: "cascade", nullable: false })
  user!: UserEntity;

  @Enum({ items: () => SocialMediaPlatform, nullable: false })
  platform!: SocialMediaPlatform;

  @Property({ columnType: "text", nullable: true })
  accessToken?: string;

  @Property({ columnType: "text", nullable: true })
  refreshToken?: string;

  @Property({ columnType: "text", nullable: true })
  sessionToken?: string;

  @Property({ columnType: "timestamptz", nullable: true })
  expiresAt?: Date;
}
