import { ConversationEntity } from "@app/entities/conversation.entity";
import { UserEntity } from "@app/entities/user.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { EntityRepository, Populate } from "@mikro-orm/core";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  Injectable,
  NotFoundException,
  Inject,
  Logger,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { SocialMediaPlatform, MessageStatus } from "@app/types";
import { ApplicationConfiguration } from "@app/config/app.config";
import { PusherReadMessageEvent } from "@app/lib/pusher/types";
import { MessageEntity } from "@app/entities/messages.entity";
import { MessagingService } from "@app/lib/social-media-registry/messaging.service";
import { EmailProvider } from "@app/lib/social-media-registry/providers/email/email.provider";
import {
  ConversationListItem,
  ThreadedMessageDTO,
  WipeEmailInboxParams,
  UserDTO,
  ConversationDTO,
  ThreadedMessage,
} from "./types";

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: EntityRepository<UserEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: EntityRepository<ConversationEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepository: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly socialSessionRepository: EntityRepository<UserSocialSessionEntity>,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: EntityRepository<MessageEntity>,
    private readonly messagingService: MessagingService,
    private readonly emailProvider: EmailProvider,
  ) {}

  async fetchConversations(
    userId: string,
    platform?: SocialMediaPlatform,
    cursor?: string,
    limit: number = 1000,
  ): Promise<{
    data: ConversationListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ["role"] },
    );
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isSuperAdmin = user.role.name === "super-admin";
    this.logger.debug(
      isSuperAdmin
        ? `Super admin fetching conversations`
        : `User ${userId} fetching conversations`,
    );

    const allowedPlatforms = this.getAllowedPlatforms(user, isSuperAdmin);
    if (!isSuperAdmin && allowedPlatforms.length === 0) {
      this.logger.warn(
        `User ${userId} has no platforms with viewMessages permission`,
      );
      return { data: [], nextCursor: null, hasMore: false };
    }

    if (platform && !isSuperAdmin && !allowedPlatforms.includes(platform)) {
      throw new ForbiddenException(
        `User does not have permission to view messages on ${platform}`,
      );
    }

    const whereClause = this.buildConversationQuery(
      platform,
      isSuperAdmin,
      allowedPlatforms,
    );

    await this.applyCursorPagination(whereClause, cursor);

    return this.fetchAndMapConversations(whereClause, platform, limit);
  }

  private async mapConversationsToListItems(
    conversations: ConversationEntity[],
  ): Promise<ConversationListItem[]> {
    return conversations.map((conv) => {
      const baseItem: ConversationListItem = {
        id: conv.id,
        externalId: conv.externalId,
        platform: conv.platform,
        accountId: conv.accountId,
        name: conv.name,
        unreadCount: conv.unreadCount,
        state: conv.state,
        online: conv.online ?? false,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };

      if (conv.text != null) {
        baseItem.text = conv.text;
      }

      if (conv.lastSeen) {
        baseItem.lastSeen = conv.lastSeen;
      }

      if (conv.lastMessageStatus != null) {
        baseItem.lastMessageStatus = conv.lastMessageStatus as MessageStatus;
      }

      if (conv.platform === SocialMediaPlatform.Email) {
        if (conv.conversationType) {
          baseItem.conversationType = conv.conversationType;
        }

        if (conv.receiverEmail) {
          baseItem.receiverEmail = conv.receiverEmail;
        }

        if (conv.participants) {
          baseItem.participants = conv.participants;
        }

        if (conv.bccRecipients) {
          baseItem.bccRecipients = conv.bccRecipients;
        }

        if (conv.messages && conv.messages.isInitialized()) {
          const sortedMessages = conv.messages.getItems().sort((a, b) => {
            const aTime = a.sentAt?.getTime() || a.createdAt.getTime();
            const bTime = b.sentAt?.getTime() || b.createdAt.getTime();
            return bTime - aTime;
          });
          const latestMsg = sortedMessages[0];
          if (latestMsg) {
            baseItem.subject = latestMsg.subject ?? undefined;
            baseItem.out = latestMsg.out ?? undefined;
            baseItem.sentAt = latestMsg.sentAt ?? undefined;
            baseItem.direction = latestMsg.direction;
            baseItem.messageStatus = latestMsg.status;
            baseItem.role = latestMsg.role;
            baseItem.provideOriginalPayload = latestMsg.provideOriginalPayload;
            baseItem.externalMessageId = latestMsg.externalMessageId;
            baseItem.threadId = latestMsg.threadId ?? undefined;
            baseItem.messageId = latestMsg.messageId ?? undefined;
            baseItem.inReplyTo = latestMsg.inReplyTo ?? undefined;
            baseItem.references = latestMsg.references ?? undefined;

            if (latestMsg.sentBy) {
              baseItem.sentBy = {
                id: latestMsg.sentBy.id,
                firstName: latestMsg.sentBy.firstName,
                lastName: latestMsg.sentBy.lastName,
                email: latestMsg.sentBy.email,
                role: {
                  id: latestMsg.sentBy.role.id,
                  name: latestMsg.sentBy.role.name,
                  createdAt: latestMsg.sentBy.role.createdAt,
                  updatedAt: latestMsg.sentBy.role.updatedAt,
                },
              };
            }
          }
        }
      }

      return baseItem;
    });
  }

  private groupEmailConversations(
    items: ConversationListItem[],
  ): ConversationListItem[] {
    const grouped = new Map<string, ConversationListItem[]>();
    const others: ConversationListItem[] = [];

    for (const item of items) {
      if (item.receiverEmail) {
        if (!grouped.has(item.receiverEmail)) {
          grouped.set(item.receiverEmail, []);
        }
        grouped.get(item.receiverEmail)!.push(item);
      } else {
        others.push(item);
      }
    }

    const result: ConversationListItem[] = [];

    for (const [_, groupItems] of grouped) {
      groupItems.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      const latest = groupItems[0];
      if (!latest) continue;

      const totalUnread = groupItems.reduce(
        (sum, item) => sum + item.unreadCount,
        0,
      );

      const summary: ConversationListItem = {
        id: latest.id,
        externalId: latest.externalId,
        platform: latest.platform,
        accountId: latest.accountId,
        name: this.resolveEmailGroupName(groupItems),
        unreadCount: totalUnread,
        receiverEmail: latest.receiverEmail,
        createdAt: latest.createdAt,
        updatedAt: latest.updatedAt,
        conversationType: latest.conversationType,
        children: groupItems,
        subject: latest.subject,
        out: latest.out,
        sentAt: latest.sentAt,
        direction: latest.direction,
        messageStatus: latest.messageStatus,
        role: latest.role,
        sentBy: latest.sentBy,
        provideOriginalPayload: latest.provideOriginalPayload,
        externalMessageId: latest.externalMessageId,
        threadId: latest.threadId,
        messageId: latest.messageId,
        inReplyTo: latest.inReplyTo,
        references: latest.references,
        participants: latest.participants,
        bccRecipients: latest.bccRecipients,
      };

      result.push(summary);
    }

    result.push(...others);

    return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  private resolveEmailGroupName(items: ConversationListItem[]): string {
    const fallback = items[0];
    if (!fallback) return "Email Conversation";
    const receiverEmail = fallback.receiverEmail;
    const preferred = items.find((item) =>
      this.isHumanReadableName(item.name, receiverEmail),
    );
    return preferred?.name || fallback.name;
  }

  private isHumanReadableName(name: string, receiverEmail?: string): boolean {
    const trimmed = name?.trim();
    if (!trimmed) return false;
    if (trimmed.includes("@")) return false;
    const localPart = receiverEmail?.split("@")[0]?.trim().toLowerCase();
    if (localPart && trimmed.toLowerCase() === localPart) return false;
    return true;
  }

  private getAllowedPlatforms(
    user: UserEntity,
    isSuperAdmin: boolean,
  ): SocialMediaPlatform[] {
    if (isSuperAdmin) {
      return [];
    }

    const allowedPlatforms: SocialMediaPlatform[] = [];
    if (user.platformAccess && user.platformAccess.length > 0) {
      for (const access of user.platformAccess) {
        if (access.viewMessages) {
          allowedPlatforms.push(access.platform);
        }
      }
    }

    return allowedPlatforms;
  }

  private buildConversationQuery(
    platform: SocialMediaPlatform | undefined,
    isSuperAdmin: boolean,
    allowedPlatforms: SocialMediaPlatform[],
  ): any {
    if (isSuperAdmin) {
      const whereClause: any = platform ? { platform } : {};
      if (platform === SocialMediaPlatform.Email) {
        whereClause.conversationType = "parent";
      }
      return whereClause;
    }

    if (platform) {
      const whereClause: any = { platform };
      if (platform === SocialMediaPlatform.Email) {
        whereClause.conversationType = "parent";
      }
      return whereClause;
    }

    const whereClause: any = {
      platform: { $in: allowedPlatforms },
    };

    if (allowedPlatforms.includes(SocialMediaPlatform.Email)) {
      whereClause.$or = [
        { conversationType: "parent" },
        { conversationType: null },
        {
          conversationType: { $ne: "child" },
          platform: { $ne: SocialMediaPlatform.Email },
        },
      ];
    } else {
      whereClause.$or = [
        { conversationType: { $ne: "child" } },
        { conversationType: null },
      ];
    }

    return whereClause;
  }

  private async applyCursorPagination(
    whereClause: any,
    cursor: string | undefined,
  ): Promise<void> {
    if (!cursor) return;

    const cursorConv = await this.conversationRepository.findOne({
      id: cursor,
    });

    if (!cursorConv) return;

    const cursorCondition = {
      $or: [
        { updatedAt: { $lt: cursorConv.updatedAt } },
        {
          updatedAt: cursorConv.updatedAt,
          id: { $lt: cursor },
        },
      ],
    };

    if (whereClause.$or) {
      const existingOr = whereClause.$or;
      whereClause.$and = [{ $or: existingOr }, cursorCondition];
      delete whereClause.$or;
    } else {
      whereClause.$or = cursorCondition.$or;
    }
  }

  private async fetchAndMapConversations(
    whereClause: any,
    platform: SocialMediaPlatform | undefined,
    limit: number,
  ): Promise<{
    data: ConversationListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const populate: string[] = [];
    if (platform === SocialMediaPlatform.Email) {
      populate.push("messages", "messages.sentBy", "messages.sentBy.role");
    }

    const conversations = await this.conversationRepository.findAll({
      where: whereClause,
      orderBy: {
        updatedAt: "DESC",
        id: "DESC",
      },
      populate: populate as unknown as Populate<ConversationEntity>,
      limit: limit + 1,
    });

    const hasMore = conversations.length > limit;
    const data = conversations.slice(0, limit);

    let items = await this.mapConversationsToListItems(data);

    if (platform === SocialMediaPlatform.Email) {
      items = this.groupEmailConversations(items);
    }

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return {
      data: items,
      nextCursor,
      hasMore,
    };
  }

  async fetchAllConversationsPaginated(
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{
    data: ConversationListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ["role"] },
    );
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isSuperAdmin = user.role.name === "super-admin";
    let whereClause: any = {};

    if (!isSuperAdmin) {
      const allowedPlatforms: SocialMediaPlatform[] = [];
      if (user.platformAccess && user.platformAccess.length > 0) {
        for (const access of user.platformAccess) {
          if (access.viewMessages) {
            allowedPlatforms.push(access.platform);
          }
        }
      }

      if (allowedPlatforms.length === 0) {
        this.logger.warn(
          `User ${userId} has no platforms with viewMessages permission`,
        );
        return { data: [], nextCursor: null, hasMore: false };
      }

      const eligiblePlatforms = allowedPlatforms.filter(
        (platform) => platform !== SocialMediaPlatform.Email,
      );

      if (eligiblePlatforms.length === 0) {
        this.logger.warn(
          `User ${userId} has no eligible platforms for conversations/all`,
        );
        return { data: [], nextCursor: null, hasMore: false };
      }

      whereClause.platform = { $in: eligiblePlatforms };
    } else {
      whereClause.platform = { $ne: SocialMediaPlatform.Email };
    }

    if (cursor) {
      const cursorConv = await this.conversationRepository.findOne({
        id: cursor,
      });
      if (cursorConv) {
        whereClause.$or = [
          { updatedAt: { $lt: cursorConv.updatedAt } },
          {
            updatedAt: cursorConv.updatedAt,
            id: { $lt: cursor },
          },
        ];
      }
    }

    const conversations = await this.conversationRepository.findAll({
      where: whereClause,
      orderBy: {
        updatedAt: "DESC",
        id: "DESC",
      },
      limit: limit + 1,
    });

    const hasMore = conversations.length > limit;
    const data = conversations.slice(0, limit);
    const lastItem = data[data.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return {
      data: await this.mapConversationsToListItems(data),
      nextCursor,
      hasMore,
    };
  }

  async updateMessageStatus(data: PusherReadMessageEvent) {
    try {
      const conversation = await this.findConversationForUpdate(
        data.chatId,
        data.platform,
      );

      if (!conversation) {
        return this.buildStatusResponse(
          false,
          "Conversation not found",
          data.data.map((m) => m.messageId),
          data.platform,
          data.chatId,
        );
      }

      const failedMessageIds = await this.updateMessagesStatus(
        conversation,
        data.data,
        data.platform,
        data.chatId,
      );

      await this.recalculateConversationUnreadCount(conversation);

      return this.buildStatusResponse(
        failedMessageIds.length === 0,
        failedMessageIds.length > 0
          ? "Some messages failed to update"
          : undefined,
        failedMessageIds.length > 0 ? failedMessageIds : undefined,
        data.platform,
        data.chatId,
      );
    } catch (error) {
      this.logger.error("Failed to update message status", error);
      return this.buildStatusResponse(
        false,
        error instanceof Error ? error.message : String(error),
        data.data.map((m) => m.messageId),
        data.platform,
        data.chatId,
      );
    }
  }

  private async findConversationForUpdate(
    chatId: string,
    platform: SocialMediaPlatform,
  ): Promise<ConversationEntity | null> {
    const conversation = await this.conversationRepository.findOne({
      externalId: chatId,
      platform,
    });

    if (!conversation) {
      this.logger.warn("No conversation found for chatId " + chatId);
    }

    return conversation;
  }

  private async updateMessagesStatus(
    conversation: ConversationEntity,
    messageUpdates: Array<{ messageId: string }>,
    platform: SocialMediaPlatform,
    chatId: string,
  ): Promise<string[]> {
    const failedMessageIds: string[] = [];

    for (const messageUpdate of messageUpdates) {
      const message = await this.messageRepository.findOne({
        externalMessageId: messageUpdate.messageId,
        conversationId: conversation,
      });

      if (!message) {
        this.logger.warn(
          `Message ${messageUpdate.messageId} not found in conversation ${conversation.id}`,
        );
        failedMessageIds.push(messageUpdate.messageId);
        continue;
      }

      if (message.status === "read") {
        this.logger.debug(
          `Message ${messageUpdate.messageId} is already marked as read`,
        );
        continue;
      }

      const isUpdated =
        await this.messagingService.updateMessageStatusForPlatform(
          messageUpdate.messageId,
          platform,
          chatId,
        );

      if (isUpdated) {
        message.status = "read";
        await this.messageRepository
          .getEntityManager()
          .persistAndFlush(message);

        this.logger.log(
          `Successfully updated message status for message ${messageUpdate.messageId} on platform ${platform}`,
        );
      } else {
        this.logger.warn(
          `Failed to update message status for message ${messageUpdate.messageId} on platform ${platform}`,
        );
        failedMessageIds.push(messageUpdate.messageId);
      }
    }

    return failedMessageIds;
  }

  private async recalculateConversationUnreadCount(
    conversation: ConversationEntity,
  ): Promise<void> {
    const unreadMessages = await this.messageRepository.count({
      conversationId: conversation,
      status: { $ne: "read" },
    });

    if (conversation.unreadCount !== unreadMessages) {
      conversation.unreadCount = unreadMessages;
      await this.conversationRepository
        .getEntityManager()
        .persistAndFlush(conversation);
      this.logger.debug(
        `Updated unread count for conversation ${conversation.id} to ${unreadMessages}`,
      );
    }
  }

  private async buildStatusResponse(
    success: boolean,
    error: string | undefined,
    failedMessageIds: string[] | undefined,
    platform: SocialMediaPlatform,
    chatId: string,
  ) {
    const recentMessages = await this.getLastMessagesForConversation(
      platform,
      chatId,
      5,
    );

    return {
      success,
      ...(error && { error }),
      ...(failedMessageIds && { failedMessageIds }),
      messages: recentMessages,
    };
  }

  private collectThreadMessages(
    allMessages: MessageEntity[],
    threadId: string,
  ): Set<string> {
    const threadMessageIds = new Set<string>();
    const messageIdMap = new Map<string, MessageEntity>();

    for (const msg of allMessages) {
      if (msg.messageId) {
        messageIdMap.set(msg.messageId, msg);
      }
    }

    const initialMatches = allMessages.filter((m) => m.threadId === threadId);
    const toProcess = [...initialMatches];

    while (toProcess.length > 0) {
      const current = toProcess.pop()!;

      if (!current.messageId || threadMessageIds.has(current.messageId)) {
        continue;
      }

      threadMessageIds.add(current.messageId);

      if (current.inReplyTo && messageIdMap.has(current.inReplyTo)) {
        const parent = messageIdMap.get(current.inReplyTo)!;
        if (parent.messageId && !threadMessageIds.has(parent.messageId)) {
          toProcess.push(parent);
        }
      }

      if (current.references) {
        for (const refId of current.references) {
          if (messageIdMap.has(refId)) {
            const refMsg = messageIdMap.get(refId)!;
            if (refMsg.messageId && !threadMessageIds.has(refMsg.messageId)) {
              toProcess.push(refMsg);
            }
          }
        }
      }

      const children = allMessages.filter(
        (m) =>
          m.inReplyTo === current.messageId ||
          m.references?.includes(current.messageId || ""),
      );
      for (const child of children) {
        if (child.messageId && !threadMessageIds.has(child.messageId)) {
          toProcess.push(child);
        }
      }
    }

    return threadMessageIds;
  }

  async fetchMessagesInConversation(
    conversationId: string,
    userId?: string,
    threadId?: string,
  ) {
    const conversation = await this.conversationRepository.findOne(
      { id: conversationId },
      {
        populate: ["messages", "messages.sentBy", "messages.sentBy.role"],
        orderBy: { messages: { createdAt: "DESC" } },
      },
    );

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    if (userId) {
      const user = await this.userRepository.findOne(
        { id: userId },
        { populate: ["role"] },
      );
      if (!user) {
        throw new NotFoundException("User not found");
      }

      const isSuperAdmin = user.role.name === "super-admin";

      if (!isSuperAdmin) {
        const platformAccess = user.platformAccess?.find(
          (access) => access.platform === conversation.platform,
        );

        if (!platformAccess || !platformAccess.viewMessages) {
          throw new ForbiddenException(
            `User does not have permission to view messages on ${conversation.platform}`,
          );
        }
      }
    }

    const messages = conversation.messages.isInitialized()
      ? conversation.messages.getItems()
      : [];

    const filteredMessages = threadId
      ? (() => {
          const threadMessageIds = this.collectThreadMessages(
            messages,
            threadId,
          );
          return messages.filter((msg) => {
            if (msg.messageId && threadMessageIds.has(msg.messageId)) {
              return true;
            }
            if (!msg.messageId && msg.threadId === threadId) {
              return true;
            }
            return false;
          });
        })()
      : messages;

    const sortedMessages = filteredMessages.sort((a, b) => {
      const aTime = a.sentAt?.getTime() || a.createdAt.getTime();
      const bTime = b.sentAt?.getTime() || b.createdAt.getTime();
      return bTime - aTime;
    });

    return sortedMessages.map((msg) => ({
      id: msg.id,
      externalMessageId: msg.externalMessageId,
      direction: msg.direction,
      subject: msg.subject,
      status: msg.status,
      role: msg.role,
      text: msg.text,
      out: msg.out,
      sentAt: msg.sentAt,
      threadId: msg.threadId,
      messageId: msg.messageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      sentBy: msg.sentBy
        ? {
            id: msg.sentBy.id,
            firstName: msg.sentBy.firstName,
            lastName: msg.sentBy.lastName,
            email: msg.sentBy.email,
            role: { name: msg.sentBy.role.name },
          }
        : null,
      provideOriginalPayload: msg.provideOriginalPayload,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
      participants: msg.participants ?? [],
      externalSenderEmail: msg.externalSenderEmail,
      externalSenderName: msg.externalSenderName,
    }));
  }

  async getLastMessagesForConversation(
    platform: SocialMediaPlatform,
    chatId: string,
    limit: number = 5,
  ) {
    const conversation = await this.conversationRepository.findOne(
      { externalId: chatId, platform },
      {
        populate: ["messages", "messages.sentBy", "messages.sentBy.role"],
        orderBy: { messages: { createdAt: "DESC" } },
      },
    );

    if (!conversation) {
      return [];
    }

    const messages = conversation.messages.isInitialized()
      ? conversation.messages.getItems()
      : [];

    const sortedMessages = messages.sort((a, b) => {
      const aTime = a.sentAt?.getTime() || a.createdAt.getTime();
      const bTime = b.sentAt?.getTime() || b.createdAt.getTime();
      return bTime - aTime;
    });

    return sortedMessages.slice(0, limit).map((msg) => ({
      id: msg.id,
      externalMessageId: msg.externalMessageId,
      direction: msg.direction,
      status: msg.status,
      role: msg.role,
      text: msg.text,
      out: msg.out,
      sentAt: msg.sentAt,
      sentBy: msg.sentBy
        ? {
            id: msg.sentBy.id,
            firstName: msg.sentBy.firstName,
            lastName: msg.sentBy.lastName,
            email: msg.sentBy.email,
            role: { name: msg.sentBy.role.name },
          }
        : null,
      provideOriginalPayload: msg.provideOriginalPayload,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
      participants: msg.participants ?? [],
      externalSenderEmail: msg.externalSenderEmail,
      externalSenderName: msg.externalSenderName,
    }));
  }

  async getThreadedMessages(
    conversationId: string,
    threadId?: string,
  ): Promise<ThreadedMessageDTO[]> {
    const whereClause: any = { conversationId };
    if (threadId) {
      whereClause.threadId = threadId;
    }

    const messages = await this.messageRepository.find(whereClause, {
      populate: [
        "parentMessage",
        "conversationId",
        "conversationId.user",
        "conversationId.user.role",
        "sentBy",
        "sentBy.role",
      ],
      orderBy: { sentAt: "ASC" },
    });

    const tree = this.buildThreadTree(messages);
    return this.serializeThreadedMessages(tree);
  }

  async wipeEmailInbox(
    requesterId: string,
    params: WipeEmailInboxParams,
  ): Promise<{
    success: boolean;
    deletedCount: number;
    accountId: string;
    folderPath: string;
  }> {
    const admin = await this.userRepository.findOne(
      { id: requesterId },
      { populate: ["role"] },
    );

    if (!admin) {
      throw new NotFoundException("Requesting user not found");
    }

    if (admin.role.name !== "super-admin") {
      throw new ForbiddenException("Only super admins can wipe email inboxes");
    }

    const account = await this.connectedAccountsRepository.findOne(
      { id: params.accountId },
      { populate: ["user"] },
    );

    if (!account) {
      throw new NotFoundException("Connected account not found");
    }

    if (account.platform !== SocialMediaPlatform.Email) {
      throw new BadRequestException(
        "Connected account must be an Email platform",
      );
    }

    const session = await this.socialSessionRepository.findOne({
      user: account.user.id,
      platform: SocialMediaPlatform.Email,
    });

    if (!session?.accessToken) {
      throw new NotFoundException(
        "Email credentials not found for the connected account",
      );
    }

    const folderPath = params.folderPath || "INBOX";
    const deletedCount = await this.emailProvider.deleteAllMessagesFromFolder(
      account.id,
      session.accessToken,
      folderPath,
    );

    this.logger.warn(
      `User ${requesterId} wiped ${deletedCount} messages from ${folderPath} on account ${account.id}`,
    );

    return {
      success: true,
      deletedCount,
      accountId: account.id,
      folderPath,
    };
  }

  private buildThreadTree(messages: MessageEntity[]): ThreadedMessage[] {
    const messageMap = new Map<string, ThreadedMessage>();
    const roots: ThreadedMessage[] = [];

    messages.forEach((msg) => {
      if (msg.messageId) {
        const threadedMsg = msg as ThreadedMessage;
        threadedMsg.children = [];
        messageMap.set(msg.messageId, threadedMsg);
      }
    });

    messages.forEach((msg) => {
      const threadedMsg = msg as ThreadedMessage;
      if (threadedMsg.inReplyTo && messageMap.has(threadedMsg.inReplyTo)) {
        const parent = messageMap.get(threadedMsg.inReplyTo)!;
        parent.children!.push(threadedMsg);
      } else {
        roots.push(threadedMsg);
      }
    });

    return roots;
  }

  private serializeUser(user: UserEntity): UserDTO {
    const userDto: UserDTO = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: {
        id: user.role.id,
        name: user.role.name,
        createdAt: user.role.createdAt,
        updatedAt: user.role.updatedAt,
      },
      platformAccess: user.platformAccess || [],
    };

    if (user.phoneNumber != null) userDto.phoneNumber = user.phoneNumber;
    if (user.disabled != null) userDto.disabled = user.disabled;
    if (user.emailVerifiedAt != null)
      userDto.emailVerifiedAt = user.emailVerifiedAt;
    if (user.twoFactorSecret != null)
      userDto.twoFactorSecret = user.twoFactorSecret;

    return userDto;
  }

  private serializeThreadedMessages(
    messages: ThreadedMessage[],
  ): ThreadedMessageDTO[] {
    return messages.map((msg) => {
      const conv = msg.conversationId;

      const conversationDto: ConversationDTO = {
        id: conv.id,
        externalId: conv.externalId,
        platform: conv.platform,
        accountId: conv.accountId,
        name: conv.name,
        unreadCount: conv.unreadCount,
        state: conv.state,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        user: this.serializeUser(conv.user),
      };

      if (conv.online != null) conversationDto.online = conv.online;
      if (conv.text != null) conversationDto.text = conv.text;
      if (conv.lastSeen != null) conversationDto.lastSeen = conv.lastSeen;
      if (conv.lastMessageStatus != null)
        conversationDto.lastMessageStatus = conv.lastMessageStatus;
      if (conv.platformData != null)
        conversationDto.platformData = conv.platformData;
      if (conv.conversationType != null)
        conversationDto.conversationType = conv.conversationType;
      if (conv.receiverEmail != null)
        conversationDto.receiverEmail = conv.receiverEmail;
      if (conv.participants != null)
        conversationDto.participants = conv.participants;
      if (conv.bccRecipients != null)
        conversationDto.bccRecipients = conv.bccRecipients;

      const messageDto: ThreadedMessageDTO = {
        id: msg.id,
        conversationId: conversationDto,
        externalMessageId: msg.externalMessageId,
        direction: msg.direction,
        status: msg.status,
        role: msg.role,
        provideOriginalPayload: msg.provideOriginalPayload,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        participants: msg.participants ?? [],
      };

      if (msg.text != null) messageDto.text = msg.text;
      if (msg.subject != null) messageDto.subject = msg.subject;
      if (msg.out != null) messageDto.out = msg.out;
      if (msg.sentAt != null) messageDto.sentAt = msg.sentAt;
      if (msg.messageId != null) messageDto.messageId = msg.messageId;
      if (msg.inReplyTo != null) messageDto.inReplyTo = msg.inReplyTo;
      if (msg.references != null) messageDto.references = msg.references;
      if (msg.threadId != null) messageDto.threadId = msg.threadId;
      if (msg.sentBy != null)
        messageDto.sentBy = this.serializeUser(msg.sentBy);
      if (msg.externalSenderEmail != null)
        messageDto.externalSenderEmail = msg.externalSenderEmail;
      if (msg.externalSenderName != null)
        messageDto.externalSenderName = msg.externalSenderName;

      if (msg.children && msg.children.length > 0) {
        messageDto.children = this.serializeThreadedMessages(msg.children);
      }

      return messageDto;
    });
  }
}
