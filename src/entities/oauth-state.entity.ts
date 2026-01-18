import { Entity, ManyToOne, Property, Unique } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { UserEntity } from "@app/entities/user.entity";

@Entity({ tableName: "oauth_states" })
export class OauthStateEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { deleteRule: "cascade" })
  user!: UserEntity;

  @Property({ type: "text", nullable: false })
  @Unique()
  state!: string;

  @Property({ type: "text", nullable: false })
  codeVerifier!: string;

  @Property({ type: "text", nullable: false })
  redirectUri!: string;

  @Property({ type: "timestamptz", nullable: false })
  expiresAt!: Date;

  @Property({ type: "timestamptz", nullable: true })
  consumedAt?: Date | null;
}
