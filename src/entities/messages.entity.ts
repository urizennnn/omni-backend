import { Entity, ManyToOne, Property, Unique } from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { MessageDirection, MessageStatus, SenderRole } from "@app/types";
import { ConversationEntity } from "./conversation.entity";
import { UserEntity } from "./user.entity";

@Entity({ tableName: "messages" })
@Unique({ properties: ["externalMessageId", "conversationId"] })
export class MessageEntity extends BaseEntity {
  @ManyToOne(() => ConversationEntity, {
    deleteRule: "cascade",
    fieldName: "conversation_id",
  })
  conversationId: ConversationEntity;

  @ManyToOne(() => UserEntity, {
    nullable: true,
    fieldName: "sent_by",
  })
  sentBy?: UserEntity | null;

  @Property({ type: "string", nullable: false })
  externalMessageId: string;

  @Property({ type: "string", nullable: false })
  direction: MessageDirection;

  @Property({ type: "text", nullable: false })
  status: MessageStatus;

  @Property({ type: "text", nullable: false })
  role: SenderRole;

  @Property({ type: "text", nullable: true })
  text?: string | null;

  @Property({ type: "string", nullable: true })
  subject?: string | null;

  @Property({ type: "boolean", nullable: true })
  out?: boolean | null;

  @Property({ columnType: "timestamptz", nullable: true })
  sentAt?: Date | null;

  @Property({ type: "string", nullable: true, length: 500 })
  messageId?: string | null;

  @Property({ type: "string", nullable: true, length: 500 })
  inReplyTo?: string | null;

  @Property({ type: "json", nullable: true })
  references?: string[] | null;

  @Property({ type: "string", nullable: true, length: 500 })
  threadId?: string | null;

  @Property({ type: "jsonb", nullable: true })
  participants?: string[] | null;

  @ManyToOne(() => MessageEntity, {
    nullable: true,
    fieldName: "parent_message_id",
  })
  parentMessage?: MessageEntity | null;

  @Property({ type: "jsonb", nullable: false })
  provideOriginalPayload: object;

  @Property({ type: "text", nullable: true })
  externalSenderEmail?: string | null;

  @Property({ type: "text", nullable: true })
  externalSenderName?: string | null;
}
