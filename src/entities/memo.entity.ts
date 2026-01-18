import { Entity, ManyToOne, Property } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { ConversationEntity } from "./conversation.entity";

@Entity({ tableName: "memos" })
export class MemoEntity extends BaseEntity {
  @ManyToOne(() => ConversationEntity, {
    deleteRule: "cascade",
    fieldName: "conversation_id",
  })
  conversation: ConversationEntity;

  @Property({ columnType: "text", nullable: false })
  content: string;
}
