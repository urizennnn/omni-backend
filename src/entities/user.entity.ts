import {
  Collection,
  Embeddable,
  Embedded,
  Entity,
  Enum,
  Filter,
  ManyToOne,
  OneToMany,
  Property,
  Rel,
} from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { UserOtpEntity } from "./user-otp.entity";
import { UserSocialSessionEntity } from "./user-social-session.entity";
import { Roles, SocialMediaPlatform, UserStatus } from "@app/types";

@Embeddable()
export class PlatformAccess {
  @Enum(() => SocialMediaPlatform) platform!: SocialMediaPlatform;
  @Property({ type: Boolean }) canSend = false;
  @Property({ type: Boolean }) viewMessages = false;
}

@Filter({
  name: "withEmailVerified",
  cond: { emailVerifiedAt: { $ne: null } },
})
@Entity({ tableName: "users" })
export class UserEntity extends BaseEntity {
  @Property({ columnType: "text", unique: true })
  email: string;

  @Property({ columnType: "text", nullable: false })
  firstName: string;

  @Property({ columnType: "text", nullable: false })
  lastName: string;

  @ManyToOne(() => RoleEntity)
  role!: Rel<RoleEntity>;

  @Property({ columnType: "text", nullable: true, name: "phone_number" })
  phoneNumber?: string;

  @Property({ columnType: "text", nullable: false })
  status: UserStatus;

  @Property({ columnType: "boolean", nullable: true })
  disabled? = false;
  @Property({ columnType: "timestamptz", nullable: true })
  emailVerifiedAt?: Date;

  @Property({ columnType: "text", nullable: true })
  twoFactorSecret?: string;

  @OneToMany(() => UserOtpEntity, (otp) => otp.user, { nullable: true })
  otps? = new Collection<UserOtpEntity>(this);

  @OneToMany(() => UserSocialSessionEntity, (session) => session.user, {
    nullable: true,
  })
  socialSessions? = new Collection<UserSocialSessionEntity>(this);

  @Embedded(() => PlatformAccess, { array: true })
  platformAccess: PlatformAccess[];
}

@Entity({ tableName: "roles" })
export class RoleEntity extends BaseEntity {
  @Property({ columnType: "text", unique: true })
  name: Roles;

  @OneToMany(() => UserEntity, (user) => user.role, { nullable: true })
  user = new Collection<UserEntity>(this);
}
