import { Entity, Property, ManyToOne, Index } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { UserEntity } from "./user.entity";

@Entity({ tableName: "activity_logs" })
@Index({ properties: ["user", "createdAt"] })
@Index({ properties: ["action"] })
export class ActivityLogEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, { nullable: true })
  user?: UserEntity;

  @Property({ columnType: "text" })
  description: string;

  @Property({ columnType: "text" })
  action: string;

  @Property({ columnType: "text", nullable: true })
  resourceType?: string;

  @Property({ columnType: "text", nullable: true })
  resourceId?: string;

  @Property({ columnType: "text", nullable: true })
  method?: string;

  @Property({ columnType: "text", nullable: true })
  path?: string;

  @Property({ columnType: "text", nullable: true })
  ipAddress?: string;

  @Property({ columnType: "integer", nullable: true })
  statusCode?: number;

  @Property({ columnType: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;
}
