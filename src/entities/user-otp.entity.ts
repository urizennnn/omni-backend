import { Entity, Filter, Index, ManyToOne, Property } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { UserEntity } from "./user.entity";

@Filter({
  name: "notExpired",
  cond: { expiresAt: { $gt: new Date() } },
})
@Entity({ tableName: "user_otps" })
@Index({ name: "user_otps_user_id_idx", properties: ["user"] })
export class UserOtpEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { deleteRule: "cascade" })
  user: UserEntity;

  @Property({ columnType: "varchar", length: 6 })
  code: string;

  @Property({ columnType: "timestamptz" })
  expiresAt: Date;

  @Property({ columnType: "timestamptz", nullable: true })
  verifiedAt?: Date;
}
