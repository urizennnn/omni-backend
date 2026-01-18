import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { SocialMediaPlatform } from "@app/types";
import { RawMessage } from "@app/lib/social-media-registry/providers/telegram/types.telegram";
import { QueueName } from "./queue.constants";
import { htmlToPlainText } from "@app/common/utils/html-to-text.util";
import { UserEntity } from "@app/entities/user.entity";
import { OutboundMessageActorService } from "./outbound-message-actor.service";

export interface SaveMessageJobData {
  message: {
    externalMessageId: string;
    conversationExternalId?: string;
    sentAt?: string;
    senderHandle?: string;
    senderName?: string;
    text?: string;
    html?: string;
    raw: unknown;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
    threadId?: string;
    subject?: string;
  };
  accountId: string;
  platform: SocialMediaPlatform;
  userId: string;
}

@Processor(QueueName.Messages, {
  concurrency: 100,
})
@Injectable()
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    private readonly em: EntityManager,
    private readonly outboundMessageActorService: OutboundMessageActorService,
  ) {
    super();
  }

  async process(job: Job<SaveMessageJobData>): Promise<void> {
    const { message, accountId, platform, userId } = job.data;
    this.logger.log(job.data);

    try {
      let conversation: ConversationEntity;

      if (platform === SocialMediaPlatform.Email) {
        conversation = await this.handleEmailConversation(
          message,
          accountId,
          userId,
        );
      } else {
        conversation = await this.handleGenericConversation(
          message,
          accountId,
          userId,
          platform,
        );
      }

      await this.saveMessage(message, conversation, userId, platform);
    } catch (error) {
      this.logger.error(
        `Failed to save message ${message.externalMessageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async handleEmailConversation(
    message: SaveMessageJobData["message"],
    accountId: string,
    userId: string,
  ): Promise<ConversationEntity> {
    const conversationPreview = message.html
      ? htmlToPlainText(message.html, 200)
      : message.text || "";
    const platform = SocialMediaPlatform.Email;
    const isOutbound = this.isOutboundMessage(message);
    const senderEmail =
      message.senderHandle || this.extractSenderFromMessage(message);
    const receiverEmail = this.extractReceiverFromMessage(message);
    const counterpartyEmail =
      (isOutbound ? receiverEmail : senderEmail) || senderEmail || receiverEmail;
    const accountEmail =
      this.extractAccountEmail(message, isOutbound) ||
      (isOutbound ? senderEmail : undefined);
    const existingName = counterpartyEmail
      ? await this.findExistingEmailName({
          receiverEmail: counterpartyEmail,
          accountId,
          userId,
          accountEmail,
        })
      : null;
    const inboundName = !isOutbound ? message.senderName?.trim() : undefined;
    const inboundNameIsHuman =
      !!inboundName &&
      this.isHumanReadableName(inboundName, counterpartyEmail, accountEmail);
    const senderName = isOutbound
      ? existingName || this.extractNameFromEmail(counterpartyEmail)
      : inboundNameIsHuman
        ? inboundName
        : existingName || this.extractNameFromEmail(counterpartyEmail);
    const isParentConversation = !message.inReplyTo;

    const resolvedExternalId =
      message.conversationExternalId ||
      counterpartyEmail ||
      senderEmail ||
      receiverEmail ||
      (message.messageId as string);
    const parentExternalId = message.threadId || resolvedExternalId;
    const existingOutboundConversation =
      isOutbound && isParentConversation
        ? await this.conversationRepo.findOne({
            platform,
            accountId,
            externalId: resolvedExternalId,
          })
        : null;

    const parentConversation = await this.resolveParentConversation({
      parentExternalId,
      platform,
      accountId,
      userId,
      receiverEmail,
      senderName,
      senderEmail,
      isParentConversation,
      isOutbound,
      existingConversation: existingOutboundConversation,
    });

    let conversation = await this.resolveConversation({
      message,
      accountId,
      platform,
      userId,
      isParentConversation,
      parentConversation,
      resolvedExternalId,
      receiverEmail,
      conversationPreview,
      parentExternalId,
      senderEmail,
    });

    const targetConversation = conversation || parentConversation;
    if (!targetConversation) {
      throw new Error("Failed to resolve email conversation target");
    }

    if (parentConversation) {
      await this.updateParentConversation(
        parentConversation,
        conversationPreview,
        isOutbound,
      );
    } else {
      targetConversation.text = conversationPreview;
      await this.em.persistAndFlush(targetConversation);
    }

    await this.updateConversationParticipants(targetConversation, message);

    if (counterpartyEmail && inboundNameIsHuman) {
      await this.updateEmailConversationNames({
        receiverEmail: counterpartyEmail,
        accountId,
        userId,
        name: inboundName,
        accountEmail,
      });
    } else if (
      counterpartyEmail &&
      this.isHumanReadableName(senderName, counterpartyEmail, accountEmail)
    ) {
      await this.updateConversationNameIfNeeded({
        conversation: targetConversation,
        name: senderName,
        receiverEmail: counterpartyEmail,
        accountEmail,
      });
    }

    return targetConversation;
  }

  private async findEmailThread(
    message: SaveMessageJobData["message"],
    accountId: string,
    platform: SocialMediaPlatform,
  ): Promise<ConversationEntity | null> {
    if (message.threadId) {
      const threadMessage = await this.messageRepo.findOne(
        {
          threadId: message.threadId,
          conversationId: { accountId, platform },
        },
        { populate: ["conversationId"] },
      );
      if (threadMessage) {
        return threadMessage.conversationId;
      }
    }

    if (message.inReplyTo) {
      const parentMessage = await this.messageRepo.findOne(
        {
          messageId: message.inReplyTo,
          conversationId: { accountId, platform },
        },
        {
          populate: ["conversationId"],
        },
      );
      if (parentMessage) {
        return parentMessage.conversationId;
      }
    }

    if (message.references && message.references.length > 0) {
      const referenceMessage = await this.messageRepo.findOne(
        {
          messageId: { $in: message.references },
          conversationId: { accountId, platform },
        },
        { populate: ["conversationId"] },
      );
      if (referenceMessage) {
        return referenceMessage.conversationId;
      }
    }

    const hasThreadContext =
      Boolean(message.inReplyTo) ||
      Boolean(message.references && message.references.length > 0) ||
      (Boolean(message.threadId) &&
        (!message.messageId || message.threadId !== message.messageId));

    if (!hasThreadContext) {
      return null;
    }

    if (message.subject) {
      const normalizedSubject = this.normalizeSubject(message.subject);
      const participants = this.extractParticipants(message);

      const conversations = await this.conversationRepo.find({
        platform,
        accountId,
      });

      for (const conv of conversations) {
        const convData = conv.platformData as
          | { threadSubject?: string; participants?: string[] }
          | undefined;
        if (convData?.threadSubject === normalizedSubject) {
          const hasOverlap = participants.some((p) =>
            convData.participants?.includes(p),
          );
          if (hasOverlap) {
            return conv;
          }
        }
      }
    }

    return null;
  }

  private async handleGenericConversation(
    message: SaveMessageJobData["message"],
    accountId: string,
    userId: string,
    platform: SocialMediaPlatform,
  ): Promise<ConversationEntity> {
    let conversation = await this.conversationRepo.findOne({
      externalId: message.conversationExternalId || "",
      platform: platform,
      accountId: accountId,
    });

    if (!conversation) {
      let conversationName = message.conversationExternalId || "Unknown";
      if (message.externalMessageId) {
        const contact = await this.contactRepo.findOne({
          externalId: message.conversationExternalId!.replace("user:", ""),
          platform: platform,
        });
        if (contact?.displayName) {
          conversationName = contact.displayName;
        }
      }

      conversation = this.conversationRepo.create({
        externalId: message.conversationExternalId || "",
        platform: platform,
        accountId: accountId,
        name: conversationName,
        user: userId,
        unreadCount: 0,
        state: "open",
        text: message.text,
      });
      await this.em.persistAndFlush(conversation);
      this.logger.log(`Created new conversation: ${conversation.externalId}`);
    } else {
      conversation.text = message.text;
      await this.em.persistAndFlush(conversation);
    }

    return conversation;
  }

  private async saveMessage(
    message: SaveMessageJobData["message"],
    conversation: ConversationEntity,
    userId: string,
    platform: SocialMediaPlatform,
  ): Promise<void> {
    const existingMessage = await this.messageRepo.findOne({
      externalMessageId: message.externalMessageId,
      conversationId: conversation.id,
    });

    if (!existingMessage) {
      const rawPayload = message.raw as RawMessage & {
        out?: boolean;
        direction?: string;
      };
      const isOutbound = this.isOutboundMessage(message);
      const actorLookupId = message.messageId || message.externalMessageId;
      const actorMapping =
        isOutbound &&
        platform === SocialMediaPlatform.Email &&
        actorLookupId
          ? await this.outboundMessageActorService.resolveMapping({
              platform,
              accountId: conversation.accountId,
              messageId: actorLookupId,
            })
          : null;
      const resolvedSenderRole = actorMapping?.senderRole ?? "owner";
      const resolvedSentByUserId = actorMapping?.actorUserId ?? userId;

      let parentMessage: MessageEntity | null = null;
      if (message.inReplyTo) {
        parentMessage = await this.messageRepo.findOne({
          messageId: message.inReplyTo,
          conversationId: conversation,
        });
      }

      const messageData: any = {
        conversationId: conversation,
        externalMessageId: message.externalMessageId,
        direction: isOutbound ? "outbound" : "inbound",
        status: isOutbound ? "sent" : "delivered",
        role: resolvedSenderRole,
        text: message.text,
        out: isOutbound,
        sentAt: message.sentAt ? new Date(message.sentAt) : null,
        provideOriginalPayload: message.raw || {},
        messageId: message.messageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        threadId: message.threadId,
        parentMessage: parentMessage || undefined,
      };

      if (isOutbound && resolvedSentByUserId) {
        messageData.sentBy = this.em.getReference(
          UserEntity,
          resolvedSentByUserId,
        );
      }
      else if (!isOutbound && platform === SocialMediaPlatform.Email) {
        const senderEmail = message.senderHandle || this.extractSenderFromMessage(message);
        const senderName = message.senderName || senderEmail?.split('@')[0] || 'Unknown';

        if (senderEmail) {
          messageData.externalSenderEmail = senderEmail;
          messageData.externalSenderName = senderName;
          messageData.role = "owner";
        }
      }

      if (platform === SocialMediaPlatform.Email) {
        if (rawPayload.subject) {
          messageData.subject = rawPayload.subject;
        }

        const ccList = this.extractEmailCcRecipients(message.raw);
        if (ccList.length > 0) {
          messageData.participants = ccList;
        }
      }

      const messageEntity = this.messageRepo.create(messageData);

      try {
        await this.em.persistAndFlush(messageEntity);
        this.logger.debug(`Saved message ${message.externalMessageId}`);
      } catch (error) {
        if (this.isDuplicateMessageError(error)) {
          const existing = await this.messageRepo.findOne({
            externalMessageId: message.externalMessageId,
            conversationId: conversation.id,
          });
          if (existing && actorMapping) {
            existing.sentBy = this.em.getReference(
              UserEntity,
              actorMapping.actorUserId,
            );
            existing.role = actorMapping.senderRole;
            await this.em.persistAndFlush(existing);
            this.logger.debug(
              `Updated sentBy after duplicate insert for ${message.externalMessageId}`,
            );
          }
          return;
        }
        throw error;
      }
    } else {
      const isOutbound = this.isOutboundMessage(message);
      const actorLookupId = message.messageId || message.externalMessageId;
      const actorMapping =
        isOutbound &&
        platform === SocialMediaPlatform.Email &&
        actorLookupId
          ? await this.outboundMessageActorService.resolveMapping({
              platform,
              accountId: conversation.accountId,
              messageId: actorLookupId,
            })
          : null;

      if (isOutbound && actorMapping) {
        const targetUser = actorMapping.actorUserId;
        const shouldUpdateSentBy =
          !existingMessage.sentBy || existingMessage.sentBy.id !== targetUser;
        const shouldUpdateRole = existingMessage.role !== actorMapping.senderRole;

        if (shouldUpdateSentBy || shouldUpdateRole) {
          existingMessage.sentBy = this.em.getReference(UserEntity, targetUser);
          existingMessage.role = actorMapping.senderRole;
          await this.em.persistAndFlush(existingMessage);
          this.logger.debug(
            `Updated sentBy for message ${message.externalMessageId}`,
          );
        }
      }
      else if (!isOutbound && platform === SocialMediaPlatform.Email &&
               (!existingMessage.externalSenderEmail || !existingMessage.externalSenderName)) {
        const senderEmail = message.senderHandle || this.extractSenderFromMessage(message);
        const senderName = message.senderName || senderEmail?.split('@')[0] || 'Unknown';
        if (senderEmail) {
          existingMessage.externalSenderEmail = senderEmail;
          existingMessage.externalSenderName = senderName;
          existingMessage.role = "owner";
          await this.em.persistAndFlush(existingMessage);
          this.logger.debug(
            `Updated external sender for inbound message ${message.externalMessageId}`,
          );
        }
      }
      this.logger.debug(
        `Message ${message.externalMessageId} already exists, skipping`,
      );
    }
  }

  private isDuplicateMessageError(error: unknown): boolean {
    if (!error) return false;
    const anyError = error as { code?: string; message?: string };
    if (anyError.code === "23505") {
      return true;
    }
    const message = anyError.message || "";
    return message.includes("duplicate key value violates unique constraint");
  }

  private normalizeSubject(subject?: string): string {
    if (!subject) return "";
    return subject
      .replace(/^(re|fwd|fw):\s*/gi, "")
      .trim()
      .toLowerCase();
  }

  private extractParticipants(
    message: SaveMessageJobData["message"],
  ): string[] {
    const participants = new Set<string>();
    const isOutbound = this.isOutboundMessage(message);

    if (!isOutbound && message.senderHandle) {
      participants.add(message.senderHandle.toLowerCase());
    }

    const raw = message.raw as { to?: string; cc?: string; bcc?: string };
    if (raw?.to) {
      this.parseAddresses(raw.to).forEach((addr) => participants.add(addr));
    }
    if (raw?.cc) {
      this.parseAddresses(raw.cc).forEach((addr) => participants.add(addr));
    }

    return Array.from(participants);
  }

  private parseAddresses(addressString?: string): string[] {
    if (!addressString) return [];
    return addressString.split(",").map((a) => a.trim().toLowerCase());
  }

  private extractEmailCcRecipients(raw: unknown): string[] {
    if (!raw) {
      return [];
    }

    const payload = raw as {
      cc?: string;
      raw?: { cc?: string };
    };

    const combined = [
      ...this.parseDisplayAddressList(payload.cc),
      ...this.parseDisplayAddressList(payload.raw?.cc),
    ];

    return this.dedupeDisplayAddresses(combined);
  }

  private parseDisplayAddressList(addresses?: string): string[] {
    if (!addresses) {
      return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];

    addresses
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .forEach((entry) => {
        const key = entry.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(entry);
        }
      });

    return result;
  }

  private dedupeDisplayAddresses(entries: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entry of entries) {
      const key = entry.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry);
      }
    }

    return result;
  }

  private async resolveParentConversation(params: {
    parentExternalId: string;
    platform: SocialMediaPlatform;
    accountId: string;
    userId: string;
    receiverEmail: string;
    senderName: string;
    senderEmail: string;
    isParentConversation: boolean;
    isOutbound: boolean;
    existingConversation: ConversationEntity | null;
  }): Promise<ConversationEntity | null> {
    const {
      parentExternalId,
      platform,
      accountId,
      userId,
      receiverEmail,
      senderName,
      senderEmail,
      isParentConversation,
      isOutbound,
      existingConversation,
    } = params;

    if (isParentConversation && isOutbound && existingConversation) {
      return existingConversation;
    }

    let parentConversation = await this.conversationRepo.findOne({
      platform,
      accountId,
      user: userId,
      conversationType: "parent",
      receiverEmail,
      externalId: parentExternalId,
    });

    if (isParentConversation && !parentConversation) {
      parentConversation = this.conversationRepo.create({
        externalId: parentExternalId,
        platform,
        accountId,
        name: senderName,
        user: userId,
        unreadCount: 0,
        state: "open",
        conversationType: "parent",
        receiverEmail,
        platformData: {
          isSenderParent: true,
          senderEmail,
          createdAt: new Date().toISOString(),
        },
      });
      await this.em.persistAndFlush(parentConversation);
      this.logger.log(`Created receiver parent conversation: ${receiverEmail}`);
    }

    return parentConversation;
  }

  private async resolveConversation(params: {
    message: SaveMessageJobData["message"];
    accountId: string;
    platform: SocialMediaPlatform;
    userId: string;
    isParentConversation: boolean;
    parentConversation: ConversationEntity | null;
    resolvedExternalId: string;
    receiverEmail: string;
    conversationPreview: string;
    parentExternalId: string;
    senderEmail: string;
  }): Promise<ConversationEntity | null> {
    const {
      message,
      accountId,
      platform,
      userId,
      isParentConversation,
      parentConversation,
      resolvedExternalId,
      receiverEmail,
      conversationPreview,
      parentExternalId,
      senderEmail,
    } = params;

    let conversation: ConversationEntity | null = null;

    if (isParentConversation && parentConversation) {
      return parentConversation;
    }

    const threadConversation = await this.findEmailThread(
      message,
      accountId,
      platform,
    );
    if (threadConversation) {
      return threadConversation;
    }

    if (!isParentConversation && parentConversation) {
      conversation = this.conversationRepo.create({
        externalId: resolvedExternalId,
        platform,
        accountId,
        name: this.extractConversationName(message),
        user: userId,
        unreadCount: 0,
        state: "open",
        text: conversationPreview,
        conversationType: "child",
        parentConversation,
        receiverEmail,
        platformData: {
          threadSubject: this.normalizeSubject(message.subject),
          participants: this.extractParticipants(message),
        },
      });
      await this.em.persistAndFlush(conversation);
      this.logger.log(
        `Created child conversation linked to parent ${parentConversation.id}`,
      );
      return conversation;
    }

    conversation = await this.conversationRepo.findOne({
      platform,
      accountId,
      externalId: resolvedExternalId,
    });

    if (!conversation) {
      conversation = this.conversationRepo.create({
        externalId: isParentConversation ? parentExternalId : resolvedExternalId,
        platform,
        accountId,
        name: this.extractConversationName(message),
        user: userId,
        unreadCount: 0,
        state: "open",
        text: conversationPreview,
        conversationType: isParentConversation ? "parent" : "child",
        parentConversation: !isParentConversation ? parentConversation : undefined,
        receiverEmail,
        platformData: {
          threadSubject: this.normalizeSubject(message.subject),
          participants: this.extractParticipants(message),
        },
      });
      await this.em.persistAndFlush(conversation);
      this.logger.warn(
        `Created fallback email conversation for ${senderEmail} (missing parent context)`,
      );
    } else {
      conversation.text = conversationPreview;
      await this.em.persistAndFlush(conversation);
    }

    return conversation;
  }

  private async updateParentConversation(
    parentConversation: ConversationEntity,
    conversationPreview: string,
    isOutbound: boolean,
  ): Promise<void> {
    parentConversation.text = conversationPreview;
    if (!isOutbound) {
      parentConversation.unreadCount = (parentConversation.unreadCount || 0) + 1;
    }
    await this.em.persistAndFlush(parentConversation);
  }

  private async updateConversationParticipants(
    conversation: ConversationEntity,
    message: SaveMessageJobData["message"],
  ): Promise<void> {
    const raw = message.raw as { to?: string };
    if (!raw?.to) return;

    const newParticipants = this.parseAddresses(raw.to);
    const currentParticipants = conversation.participants || [];
    const unique = new Set([...currentParticipants, ...newParticipants]);
    conversation.participants = Array.from(unique);
    await this.em.persistAndFlush(conversation);
  }

  private extractAccountEmail(
    message: SaveMessageJobData["message"],
    isOutbound: boolean,
  ): string | undefined {
    const raw = message.raw as { to?: string; from?: string } | undefined;
    const candidates = this.parseAddresses(isOutbound ? raw?.from : raw?.to);
    return candidates[0];
  }

  private async findExistingEmailName(params: {
    receiverEmail: string;
    accountId: string;
    userId: string;
    accountEmail?: string;
  }): Promise<string | null> {
    const { receiverEmail, accountId, userId, accountEmail } = params;
    const conversations = await this.conversationRepo.find(
      {
        platform: SocialMediaPlatform.Email,
        accountId,
        user: userId,
        receiverEmail,
      },
      { orderBy: { updatedAt: "DESC" } },
    );

    for (const conv of conversations) {
      if (this.isHumanReadableName(conv.name, receiverEmail, accountEmail)) {
        return conv.name;
      }
    }

    return null;
  }

  private async updateEmailConversationNames(params: {
    receiverEmail: string;
    accountId: string;
    userId: string;
    name: string;
    accountEmail?: string;
  }): Promise<void> {
    const { receiverEmail, accountId, userId, name, accountEmail } = params;
    const conversations = await this.conversationRepo.find({
      platform: SocialMediaPlatform.Email,
      accountId,
      user: userId,
      receiverEmail,
    });

    let updated = false;
    for (const conv of conversations) {
      if (
        this.shouldReplaceConversationName(
          conv.name,
          name,
          receiverEmail,
          accountEmail,
        )
      ) {
        conv.name = name;
        updated = true;
      }
    }

    if (updated) {
      await this.em.persistAndFlush(conversations);
    }
  }

  private async updateConversationNameIfNeeded(params: {
    conversation: ConversationEntity;
    name: string;
    receiverEmail?: string;
    accountEmail?: string;
  }): Promise<void> {
    const { conversation, name, receiverEmail, accountEmail } = params;
    if (
      this.shouldReplaceConversationName(
        conversation.name,
        name,
        receiverEmail,
        accountEmail,
      )
    ) {
      conversation.name = name;
      await this.em.persistAndFlush(conversation);
    }
  }

  private shouldReplaceConversationName(
    currentName: string,
    nextName: string,
    receiverEmail?: string,
    accountEmail?: string,
  ): boolean {
    const normalizedCurrent = currentName?.trim();
    const normalizedNext = nextName?.trim();
    if (!normalizedNext) return false;
    if (normalizedCurrent === normalizedNext) return false;
    const nextIsHuman = this.isHumanReadableName(
      normalizedNext,
      receiverEmail,
      accountEmail,
    );
    if (!nextIsHuman) return false;
    const currentIsHuman = this.isHumanReadableName(
      normalizedCurrent,
      receiverEmail,
      accountEmail,
    );
    return !currentIsHuman;
  }

  private isHumanReadableName(
    name: string,
    receiverEmail?: string,
    accountEmail?: string,
  ): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (trimmed.includes("@")) return false;

    const lower = trimmed.toLowerCase();
    const receiverLocal = this.extractEmailLocalPart(receiverEmail);
    if (receiverLocal && lower === receiverLocal) return false;

    const accountLocal = this.extractEmailLocalPart(accountEmail);
    if (accountLocal && lower === accountLocal) return false;

    return true;
  }

  private extractEmailLocalPart(email?: string): string | null {
    if (!email || !email.includes("@")) return null;
    const local = email.split("@")[0]?.trim().toLowerCase();
    return local || null;
  }

  private extractConversationName(
    message: SaveMessageJobData["message"],
  ): string {
    const subject = message.subject?.trim();
    if (subject) {
      return subject;
    }

    if (this.isOutboundMessage(message)) {
      const counterparty = this.extractReceiverFromMessage(message);
      if (counterparty && counterparty.includes("@")) {
        return this.extractNameFromEmail(counterparty);
      }
    }

    const handle = message.senderHandle?.trim();
    if (handle) {
      return handle;
    }

    return "Email Conversation";
  }

  private extractNameFromEmail(email: string): string {
    if (!email || !email.includes("@")) {
      return "Unknown Sender";
    }
    const localPart = email.split("@")[0];
    return localPart || "Unknown Sender";
  }

  private extractSenderFromMessage(
    message: SaveMessageJobData["message"],
  ): string {
    return this.extractCounterparty(message);
  }

  private extractReceiverFromMessage(
    message: SaveMessageJobData["message"],
  ): string {
    return this.extractCounterparty(message);
  }

  private extractCounterparty(
    message: SaveMessageJobData["message"],
  ): string {
    const raw = message.raw as {
      counterparty?: string;
      counterpartyDisplay?: string;
      to?: string;
      from?: string;
    };
    const isOutbound = this.isOutboundMessage(message);

    if (raw?.counterparty) {
      return raw.counterparty.toLowerCase();
    }

    if (raw?.counterpartyDisplay) {
      return raw.counterpartyDisplay.toLowerCase();
    }

    if (message.conversationExternalId) {
      return message.conversationExternalId.toLowerCase();
    }

    if (message.senderHandle) {
      return message.senderHandle.toLowerCase();
    }

    const candidates = (isOutbound ? [raw?.to, raw?.from] : [raw?.from, raw?.to])
      .filter(
      (value): value is string => Boolean(value),
    );

    for (const entry of candidates) {
      const addresses = this.parseAddresses(entry);
      if (addresses.length > 0) {
        return addresses[0]!;
      }
    }

    return "unknown@unknown.com";
  }

  private isOutboundMessage(
    message: SaveMessageJobData["message"],
  ): boolean {
    const raw = message.raw as { out?: boolean; direction?: string } | undefined;
    if (typeof raw?.out === "boolean") {
      return raw.out;
    }
    if (typeof raw?.direction === "string") {
      return raw.direction.toLowerCase() === "outbound";
    }
    return false;
  }
}
