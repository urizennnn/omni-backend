import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  OneToOne,
  Property,
  Unique,
} from "@mikro-orm/core";
import { BaseEntity } from "./base.entity";
import { ConversationState, SocialMediaPlatform } from "@app/types";
import { UserEntity } from "./user.entity";
import { MessageEntity } from "./messages.entity";
import { MemoEntity } from "./memo.entity";

@Entity({ tableName: "conversations" })
@Index({ properties: ["platform", "name"] })
@Index({ properties: ["externalId", "platform", "accountId"] })
@Unique({ properties: ["platform", "externalId"] })
export class ConversationEntity extends BaseEntity {
  @Property({ type: "string", nullable: false })
  externalId: string;

  @Enum({ items: () => SocialMediaPlatform, nullable: false })
  platform: SocialMediaPlatform;

  @Property({ type: "string", nullable: false })
  accountId: string;

  @Property({ columnType: "text", nullable: true })
  text?: string;

  @Property({ type: "string", nullable: true })
  lastMessageStatus?: string;

  @Property({ type: "numeric", nullable: false })
  unreadCount: number = 0;

  @Property({ type: "string", nullable: false })
  state: ConversationState = "open";

  @Property({ type: "string", nullable: false })
  name: string;

  @Property({ type: "boolean", nullable: true, default: false })
  online?: boolean;

  @Property({ type: "date", nullable: true })
  lastSeen?: Date;

  @ManyToOne(() => UserEntity, { deleteRule: "cascade" })
  user: UserEntity;

  @OneToMany(() => MessageEntity, (message) => message.conversationId)
  messages = new Collection<MessageEntity>(this);

  @OneToMany(() => MemoEntity, (memo) => memo.conversation)
  memos = new Collection<MemoEntity>(this);

  @Property({ type: "jsonb", nullable: true })
  platformData?: Record<string, unknown>;

  @ManyToOne(() => ConversationEntity, {
    nullable: true,
    fieldName: "parent_conversation_id",
  })
  parentConversation?: ConversationEntity | null;

  @OneToMany(() => ConversationEntity, (conv) => conv.parentConversation)
  childConversations = new Collection<ConversationEntity>(this);

  @Property({ type: "string", nullable: true })
  conversationType?: "parent" | "child";

  @Property({ type: "jsonb", nullable: true })
  participants?: string[];

  @Property({ type: "jsonb", nullable: true })
  bccRecipients?: string[];

  @Property({ type: "string", nullable: true })
  receiverEmail?: string;
}
