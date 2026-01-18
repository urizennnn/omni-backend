import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository, QueryOrder } from "@mikro-orm/core";
import { ProviderRegistry } from "./provider.registry";
import { SenderRole, SocialMediaPlatform } from "@app/types";
import { SendMessageParams, SendMessageResult } from "./provider.interface";
import { PusherService } from "@app/lib/pusher/pusher.service";
import { PusherChannel, PusherEvent } from "@app/lib/pusher/pusher.constants";
import { UserEntity } from "@app/entities/user.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { ok, fail } from "@app/common/response";

export interface SendMessageRequest {
  platform: SocialMediaPlatform;
  sessionToken: string;
  chatId: string;
  providerChatId?: string;
  message: string;
  userId?: string;
  sentByUserId?: string;
  fail?: boolean;
  subject?: string;
  html?: string;
  reply?: boolean;
  ccRecipients?: string;
  bccRecipients?: string;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly pusherService: PusherService,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
    const {
      platform,
      sessionToken,
      chatId,
      providerChatId,
      message,
      userId,
      sentByUserId,
      fail,
      subject,
      html,
      ccRecipients: requestCcRecipients,
      bccRecipients: requestBccRecipients,
    } = request;
    const targetChatId = providerChatId ?? chatId;
    const effectiveSentByUserId = sentByUserId ?? userId;

    const senderRole = await this.validateSendPermissions(
      effectiveSentByUserId,
      platform,
      chatId,
    );

    const provider = this.providerRegistry.get(platform);
    if (!provider) {
      const error = `Provider not found for platform: ${platform}`;
      this.logger.error(error);

      if (effectiveSentByUserId) {
        await this.emitMessageStatus(effectiveSentByUserId, {
          success: false,
          error,
          platform,
          chatId,
        });
      }

      throw new NotFoundException(error);
    }

    if (chatId !== targetChatId) {
      this.logger.log(
        `Sending message via ${platform} to provider chat ${targetChatId} (conversation ${chatId})`,
      );
    } else {
      this.logger.log(`Sending message via ${platform} to chat ${chatId}`);
    }

    const {
      parentMessageId,
      parentReferences,
      ccRecipients,
      bccRecipients,
      cachedConversation,
      accountId,
    } = await this.prepareMessageMetadata(
      request,
      platform,
      chatId,
      userId,
      requestCcRecipients,
      requestBccRecipients,
    );

    try {
      const result = await provider.sendMessage({
        sessionToken,
        chatId: targetChatId,
        message,
        userId,
        accountId,
        senderRole,
        fail,
        subject,
        html,
        reply: request.reply,
        parentMessageId,
        parentReferences,
        ccRecipients,
        bccRecipients,
      } as SendMessageParams);

      if (effectiveSentByUserId) {
        await this.emitMessageStatus(effectiveSentByUserId, {
          ...result,
          platform,
          chatId,
          message: result.success ? message : undefined,
        });
      }

      if (result.success) {
        this.logger.log(
          `Message sent successfully via ${platform}, messageId: ${result.messageId}`,
        );

        await this.persistOutboundMessage({
          result,
          platform,
          chatId,
          cachedConversation,
          message,
          subject: result.subject ?? subject,
          senderRole,
          effectiveSentByUserId,
          ccRecipients,
          bccRecipients,
          parentMessageId,
          parentReferences,
        });
      } else {
        this.logger.error(
          `Failed to send message via ${platform}: ${result.error}`,
        );
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Exception while sending message via ${platform}: ${errorMessage}`,
      );

      const result: SendMessageResult = {
        success: false,
        error: errorMessage,
      };

      if (effectiveSentByUserId) {
        await this.emitMessageStatus(effectiveSentByUserId, {
          ...result,
          platform,
          chatId,
        });
      }

      return result;
    }
  }

  private async getLastMessagesForConversation(
    platform: SocialMediaPlatform,
    chatId: string,
    limit: number = 5,
  ) {
    try {
      const conversation = await this.conversationRepo.findOne(
        { externalId: chatId, platform },
        { populate: ["messages"] },
      );

      if (!conversation) {
        return [];
      }

      const messages = await this.messageRepo.find(
        { conversationId: conversation.id },
        { orderBy: { createdAt: QueryOrder.DESC }, limit, populate: ["sentBy", "sentBy.role"] },
      );

      return messages.map((msg) => ({
        id: msg.id,
        externalMessageId: msg.externalMessageId,
        direction: msg.direction,
        status: msg.status,
        role: msg.role,
        text: msg.text,
        out: msg.out,
        sentBy: msg.sentBy ? {
          id: msg.sentBy.id,
          firstName: msg.sentBy.firstName,
          lastName: msg.sentBy.lastName,
          email: msg.sentBy.email,
          role: { name: msg.sentBy.role.name }
        } : null,
        provideOriginalPayload: msg.provideOriginalPayload,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        participants: msg.participants ?? [],
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch recent messages: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async emitMessageStatus(
    userId: string,
    data: {
      success: boolean;
      messageId?: string;
      error?: string;
      platform: SocialMediaPlatform;
      chatId: string;
      message?: string;
    },
  ): Promise<void> {
    try {
      const recentMessages = data.success
        ? await this.getLastMessagesForConversation(
            data.platform,
            data.chatId,
            5,
          )
        : [];

      const payload = data.success
        ? ok("Message sent successfully", {
            userId,
            messageId: data.messageId,
            platform: data.platform,
            chatId: data.chatId,
            message: data.message,
            messages: recentMessages,
          })
        : fail("Failed to send message", {
            code: "MESSAGE_SEND_FAILED",
            details: {
              userId,
              error: data.error,
              platform: data.platform,
              chatId: data.chatId,
            },
          });

      await this.pusherService.trigger(
        PusherChannel.PrivateMessaging,
        PusherEvent.Outbound,
        payload,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit message status to Pusher: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async findParentForReply(
    conversationId: string,
  ): Promise<{
    messageId?: string;
    references?: string[];
    ccRecipients?: string;
    bccRecipients?: string;
  } | null> {
    const parentMsg = await this.messageRepo.findOne(
      {
        conversationId,
        messageId: { $ne: null },
      },
      { orderBy: { sentAt: QueryOrder.DESC } }
    );

    if (!parentMsg?.messageId) {
      this.logger.warn(`Reply=true but no parent found for conv ${conversationId}`);
      return null;
    }

    let ccRecipients: string | undefined;
    let bccRecipients: string | undefined;
    const raw = parentMsg.provideOriginalPayload as any;
    if (raw?.raw) {
      const allRecipients = [
        ...this.parseRecipientList(raw.raw.to),
        ...this.parseRecipientList(raw.raw.cc),
      ];

      if (allRecipients.length > 0) {
        ccRecipients = allRecipients.join(", ");
      }
      const bccList = this.parseRecipientList(raw.raw.bcc);
      if (bccList.length > 0) {
        bccRecipients = bccList.join(", ");
      }
    }

    if (!ccRecipients && raw) {
      const topLevelRecipients = [
        ...this.parseRecipientList(raw.to),
        ...this.parseRecipientList(raw.cc),
      ];
      if (topLevelRecipients.length > 0) {
        ccRecipients = topLevelRecipients.join(", ");
      }
    }

    if (!bccRecipients && raw) {
      const topLevelBcc = this.parseRecipientList(raw.bcc);
      if (topLevelBcc.length > 0) {
        bccRecipients = topLevelBcc.join(", ");
      }
    }

    if (!ccRecipients && raw?.ccRecipients) {
      ccRecipients = raw.ccRecipients;
    }

    if (!bccRecipients && raw?.bccRecipients) {
      bccRecipients = raw.bccRecipients;
    }

    if (!ccRecipients && parentMsg.participants?.length) {
      ccRecipients = parentMsg.participants.join(", ");
    }

    return {
      messageId: parentMsg.messageId,
      references: parentMsg.references || [],
      ccRecipients,
      bccRecipients,
    };
  }

  private async updateConversationRecipients(
    conversation: ConversationEntity,
    ccRecipients?: string,
    bccRecipients?: string,
  ): Promise<void> {
    let updated = false;

    const ccList = this.parseRecipientList(ccRecipients);
    if (ccList.length > 0) {
      const merged = this.mergeRecipientLists(
        conversation.participants,
        ccList,
      );
      if (!this.haveSameRecipients(conversation.participants, merged)) {
        conversation.participants = merged;
        updated = true;
      }
    }

    const bccList = this.parseRecipientList(bccRecipients);
    if (bccList.length > 0) {
      const mergedBcc = this.mergeRecipientLists(
        conversation.bccRecipients,
        bccList,
      );
      if (!this.haveSameRecipients(conversation.bccRecipients, mergedBcc)) {
        conversation.bccRecipients = mergedBcc;
        updated = true;
      }
    }

    if (updated) {
      await this.conversationRepo
        .getEntityManager()
        .persistAndFlush(conversation);
    }
  }

  private parseRecipientList(recipients?: string): string[] {
    if (!recipients) {
      return [];
    }

    const entries = recipients
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const unique = new Map<string, string>();
    for (const entry of entries) {
      const key = this.normalizeRecipient(entry);
      if (!unique.has(key)) {
        unique.set(key, entry);
      }
    }

    return Array.from(unique.values());
  }

  private normalizeRecipient(entry: string): string {
    const match = entry.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (match) {
      return match[0]!.toLowerCase();
    }
    return entry.trim().toLowerCase();
  }

  private mergeRecipientLists(
    existing: string[] | undefined,
    additions: string[],
  ): string[] {
    const merged = new Map<string, string>();
    for (const value of existing ?? []) {
      merged.set(this.normalizeRecipient(value), value);
    }
    for (const addition of additions) {
      const key = this.normalizeRecipient(addition);
      if (!merged.has(key)) {
        merged.set(key, addition);
      }
    }

    return Array.from(merged.values());
  }

  private haveSameRecipients(
    a?: string[],
    b?: string[],
  ): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => value === b[index]);
  }

  private async validateSendPermissions(
    userId: string | undefined,
    platform: SocialMediaPlatform,
    chatId: string,
  ): Promise<SenderRole> {
    if (!userId) {
      return "owner";
    }

    const user = await this.userRepo.findOne(
      { id: userId },
      { populate: ["role"] },
    );

    if (!user) {
      const error = `User not found: ${userId}`;
      this.logger.error(error);

      await this.emitMessageStatus(userId, {
        success: false,
        error,
        platform,
        chatId,
      });

      throw new NotFoundException(error);
    }

    const isSuperAdmin = user.role.name === "super-admin";
    const senderRole = isSuperAdmin ? "owner" : "pa";

    if (!isSuperAdmin) {
      const platformAccess = user.platformAccess?.find(
        (access) => access.platform === platform,
      );

      if (!platformAccess || !platformAccess.canSend) {
        const error = `User does not have permission to send messages on ${platform}`;
        this.logger.warn(error);

        await this.emitMessageStatus(userId, {
          success: false,
          error,
          platform,
          chatId,
        });

        throw new ForbiddenException(error);
      }
    }

    return senderRole;
  }

  private async prepareMessageMetadata(
    request: SendMessageRequest,
    platform: SocialMediaPlatform,
    chatId: string,
    userId: string | undefined,
    requestCcRecipients: string | undefined,
    requestBccRecipients: string | undefined,
  ) {
    let parentMessageId: string | undefined;
    let parentReferences: string[] | undefined;
    let ccRecipients = requestCcRecipients;
    let bccRecipients = requestBccRecipients;
    let cachedConversation: ConversationEntity | null = null;

    if (request.reply) {
      cachedConversation = await this.findConversation(chatId, platform);

      if (cachedConversation) {
        const parent = await this.findParentForReply(cachedConversation.id);
        if (parent) {
          parentMessageId = parent.messageId;
          parentReferences = parent.references;
          if (!ccRecipients && parent.ccRecipients) {
            ccRecipients = parent.ccRecipients;
          }
          if (!bccRecipients && parent.bccRecipients) {
            bccRecipients = parent.bccRecipients;
          }
        }

        if (
          !bccRecipients &&
          cachedConversation.bccRecipients &&
          cachedConversation.bccRecipients.length > 0
        ) {
          bccRecipients = cachedConversation.bccRecipients.join(", ");
        }
      }
    }

    if (platform === SocialMediaPlatform.Email && !cachedConversation) {
      cachedConversation = await this.findConversation(chatId, platform);
    }

    if (
      platform === SocialMediaPlatform.Email &&
      !bccRecipients &&
      cachedConversation?.bccRecipients &&
      cachedConversation.bccRecipients.length > 0
    ) {
      bccRecipients = cachedConversation.bccRecipients.join(", ");
    }

    let accountId: string | undefined;
    if (platform === SocialMediaPlatform.Email && userId) {
      const account = await this.accountRepo.findOne({
        user: userId,
        platform: SocialMediaPlatform.Email,
        status: "active",
      });
      accountId = account?.id;
    }

    return {
      parentMessageId,
      parentReferences,
      ccRecipients,
      bccRecipients,
      cachedConversation,
      accountId,
    };
  }

  private async findConversation(
    chatId: string,
    platform: SocialMediaPlatform,
  ): Promise<ConversationEntity | null> {
    let conversation = await this.conversationRepo.findOne({
      externalId: chatId,
      platform,
    });

    if (!conversation) {
      const alternateChatId = chatId.startsWith("user:")
        ? chatId.replace("user:", "")
        : `user:${chatId}`;
      conversation = await this.conversationRepo.findOne({
        externalId: alternateChatId,
        platform,
      });
    }

    return conversation;
  }

  private async persistOutboundMessage(params: {
    result: SendMessageResult;
    platform: SocialMediaPlatform;
    chatId: string;
    cachedConversation: ConversationEntity | null;
    message: string;
    subject?: string;
    senderRole: SenderRole;
    effectiveSentByUserId: string | undefined;
    ccRecipients: string | undefined;
    bccRecipients: string | undefined;
    parentMessageId: string | undefined;
    parentReferences: string[] | undefined;
  }): Promise<void> {
    const {
      result,
      platform,
      chatId,
      cachedConversation,
      message,
      subject,
      senderRole,
      effectiveSentByUserId,
      ccRecipients,
      bccRecipients,
      parentMessageId,
      parentReferences,
    } = params;

    try {
      const conversation =
        cachedConversation ?? (await this.findConversation(chatId, platform));

      if (!conversation) {
        this.logger.warn(
          `Conversation not found for chatId ${chatId} on platform ${platform}, message not saved to database`,
        );
        return;
      }

      if (platform === SocialMediaPlatform.Email) {
        await this.updateConversationRecipients(
          conversation,
          ccRecipients,
          bccRecipients,
        );
      }

      const existingMessage = await this.messageRepo.findOne({
        externalMessageId: result.messageId || "",
        conversationId: conversation.id,
      });

      if (existingMessage) {
        existingMessage.role = senderRole;
        existingMessage.status = "sent";
        if (effectiveSentByUserId) {
          existingMessage.sentBy = this.messageRepo
            .getEntityManager()
            .getReference(UserEntity, effectiveSentByUserId);
        }
        await this.messageRepo.getEntityManager().persistAndFlush(existingMessage);
        this.logger.log(
          `Updated existing message ${result.messageId} with role ${senderRole}`,
        );
        return;
      }

      if (platform === SocialMediaPlatform.Telegram) {
        this.logger.debug(
          `Message ${result.messageId} will be saved by TelegramEventListener`,
        );
        return;
      }

      const ccListForMessage = this.parseRecipientList(ccRecipients);

      const messageEntity = this.messageRepo.create({
        conversationId: conversation,
        sentBy: effectiveSentByUserId
          ? this.messageRepo
              .getEntityManager()
              .getReference(UserEntity, effectiveSentByUserId)
          : null,
        externalMessageId: result.messageId || "",
        direction: "outbound",
        status: "sent",
        role: senderRole,
        text: message,
        out: true,
        messageId: result.messageId,
        subject,
        provideOriginalPayload: {
          ...result,
          ccRecipients,
          bccRecipients,
        },
        ...(ccListForMessage.length > 0 && {
          participants: ccListForMessage,
        }),
        ...(parentMessageId && {
          inReplyTo: parentMessageId,
          references: [...(parentReferences || []), parentMessageId],
          threadId: parentReferences?.[0] || parentMessageId,
        }),
      });

      await this.messageRepo.getEntityManager().persistAndFlush(messageEntity);
      this.logger.log(
        `Sent message saved to database for conversation ${conversation.id}`,
      );
    } catch (dbError) {
      this.logger.error(
        `Failed to save message to database: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      );
    }
  }

  async updateMessageStatusForPlatform(
    messageId: string,
    platform: SocialMediaPlatform,
    chatId: string,
  ) {
    const provider = this.providerRegistry.get(platform);
    if (!provider) {
      this.logger.error(`Provider not found for platform: ${platform}`);
      return false;
    }
    const isUpdated = await provider.updateMessageStatus({
      messageId,
      chatId,
      platform,
    });
    return isUpdated;
  }
}
