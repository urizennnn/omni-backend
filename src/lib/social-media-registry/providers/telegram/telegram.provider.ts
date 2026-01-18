import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  PollCursor,
  PollResult,
  ProviderDriver,
  SendMessageParams,
  SendMessageResult,
} from "../../provider.interface";
import { SocialMediaPlatform } from "@app/types";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { ApplicationConfiguration } from "@app/config/app.config";
import { TelegramConfiguration } from "@app/config/telegram.config";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { createTelegramClient } from "./telegram-client.factory";
import { ProviderRegistry } from "../../provider.registry";
import { UserEntity } from "@app/entities/user.entity";
import { Client } from "tdl";
import { convertTelegramToMarkdown } from "./telegram-formatter.util";
import { TelegramEventListener } from "./telegram-event-listener.service";
import { CacheService } from "@app/common/cache";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { ConnectorJobData } from "@app/lib/queue/connector.processor";

@Injectable()
export class TelegramProvider
  implements ProviderDriver, OnModuleInit, OnModuleDestroy
{
  readonly key = SocialMediaPlatform.Telegram;
  private readonly logger = new Logger(TelegramProvider.name);
  private readonly clientPool = new Map<string, Client>();
  private readonly pendingClientCreations = new Map<string, Promise<Client>>();

  constructor(
    @InjectRepository(UserSocialSessionEntity)
    private readonly sessionRepo: EntityRepository<UserSocialSessionEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
    private readonly drivers: ProviderRegistry,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    @Inject(TelegramConfiguration.KEY)
    private readonly telegramConfig: ConfigType<typeof TelegramConfiguration>,
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramEventListener))
    private readonly telegramEventListener: TelegramEventListener,
    private readonly cache: CacheService,
    @InjectQueue("platform-connection")
    private readonly platformConnectionQueue: Queue<ConnectorJobData>,
  ) {
    this.drivers.register(this);
  }

  async onModuleInit() {
    this.logger.log("Initializing Telegram clients for all logged-in users...");
    await this.initializeAllClients();
  }

  async onModuleDestroy() {
    this.logger.log("Closing all Telegram clients...");
    await this.closeAllClients();
  }

  private async initializeAllClients(): Promise<void> {
    try {
      const sessions = await this.sessionRepo.findAll({
        where: { platform: SocialMediaPlatform.Telegram },
        populate: ["user"],
      });

      this.logger.log(
        `Found ${sessions.length} Telegram sessions to initialize`,
      );

      for (const session of sessions) {
        if (session.sessionToken && session.user?.id) {
          try {
            await this.getOrCreateClient(session.user.id, session.sessionToken);
            this.logger.log(
              `Initialized Telegram client for user ${session.user.id}`,
            );
            await this.telegramEventListener.setupListenerForUser(
              session.user.id,
            );
            this.logger.log(`Setup event listener for user ${session.user.id}`);
          } catch (error) {
            this.logger.error(
              `Failed to initialize Telegram client for user ${session.user.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize Telegram clients: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateMessageStatus(params: unknown): Promise<boolean> {
    const payload = params as {
      messageId: string;
      chatId: string;
      platform: SocialMediaPlatform;
      userId?: string;
    };

    const sessionData = await this.getSessionToken(
      payload.platform,
      payload.userId,
    );

    if (!sessionData.userId || !sessionData.sessionToken) {
      this.logger.error(
        "Could not determine userId or sessionToken for message status update",
      );
      return false;
    }

    try {
      const client = await this.getOrCreateClient(
        sessionData.userId,
        sessionData.sessionToken,
      );
      await this.updateTelegramMessage(
        client,
        payload.chatId,
        payload.messageId,
      );

      this.logger.log(
        `Message ${payload.messageId} status updated in chat ${payload.chatId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to update message status: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async getSessionToken(
    platform: SocialMediaPlatform,
    providedUserId?: string,
  ): Promise<{ userId?: string; sessionToken?: string }> {
    let sessionToken: string = "";
    let userId: string | undefined = providedUserId;

    try {
      const cachedSession = await this.cache.getSessionToken(platform);
      if (cachedSession) {
        sessionToken = cachedSession.sessionToken!;
        const match = sessionToken.match(/user_(.+)$/);
        if (match && match[1]) {
          userId = match[1];
        }
        this.logger.debug(
          `Retrieved session token from cache for platform ${platform}`,
        );
        return { userId, sessionToken };
      }
    } catch (error) {
      this.logger.warn(
        `Failed to retrieve session from cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.debug(
      `Session token not in cache, fetching from DB for platform ${platform}`,
    );

    try {
      const session = await this.sessionRepo.findOne(
        { platform: SocialMediaPlatform.Telegram },
        { populate: ["user"] },
      );

      if (!session || !session.sessionToken) {
        this.logger.error(`No active session found for platform ${platform}`);
        return { userId: undefined, sessionToken: undefined };
      }

      sessionToken = session.sessionToken;
      userId = userId || session.user?.id;

      if (sessionToken) {
        try {
          await this.cache.updateSessionToken(platform, {
            platform,
            sessionToken,
          });
          this.logger.debug(`Cached session token for platform ${platform}`);
        } catch (error) {
          this.logger.warn(
            `Failed to cache session token: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { userId, sessionToken };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve session from DB: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { userId: undefined, sessionToken: undefined };
    }
  }

  private async updateTelegramMessage(
    client: any,
    chatId: string,
    messageId: string,
  ): Promise<void> {
    const chatIdNumeric = this.parseChatId(chatId);
    await client.invoke({
      _: "viewMessages",
      chat_id: chatIdNumeric,
      message_ids: [parseInt(messageId)],
      force_read: true,
    });
  }

  private parseChatId(chatId: string): number {
    if (chatId.startsWith("user:")) {
      return parseInt(chatId.replace("user:", ""));
    } else if (chatId.startsWith("channel:")) {
      return parseInt(chatId.replace("channel:", ""));
    } else if (chatId.startsWith("chat:")) {
      return parseInt(chatId.replace("chat:", ""));
    }
    return parseInt(chatId);
  }

  private async closeAllClients(): Promise<void> {
    this.pendingClientCreations.clear();

    const closePromises: Promise<void>[] = [];

    for (const [userId, client] of this.clientPool.entries()) {
      this.logger.log(`Closing Telegram client for user ${userId}`);
      closePromises.push(
        client.close().catch((error) => {
          this.logger.error(
            `Failed to close Telegram client for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      );
    }

    await Promise.all(closePromises);
    this.clientPool.clear();
  }

  public async getOrCreateClient(
    userId: string,
    sessionToken: string,
    login?: boolean,
  ): Promise<Client> {
    const existingClient = this.clientPool.get(userId);
    if (existingClient) {
      return existingClient;
    }

    const pendingCreation = this.pendingClientCreations.get(userId);
    if (pendingCreation) {
      this.logger.log(
        `Waiting for pending Telegram client creation for user ${userId}`,
      );
      return pendingCreation;
    }

    const creationPromise = (async () => {
      try {
        this.logger.log(
          `Creating new Telegram client for user ${userId} with session: ${sessionToken}`,
        );
        const client = createTelegramClient(this.telegramConfig, sessionToken);

        if (login) {
          this.clientPool.set(userId, client);
          return client;
        }
        this.logger.log(`Waiting for client initialization for user ${userId}`);
        const maxWaitTime = 30000;
        const pollInterval = 500;
        const startTime = Date.now();
        let initialized = false;

        while (Date.now() - startTime < maxWaitTime) {
          try {
            await client.invoke({ _: "getMe" });
            this.logger.log(
              `Client initialized successfully for user ${userId}`,
            );
            initialized = true;
            break;
          } catch (error) {
            this.logger.debug(
              `Waiting for client initialization: ${error instanceof Error ? error.message : String(error)}`,
            );
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        }

        if (!initialized) {
          this.logger.warn(
            `Client initialization did not complete within ${maxWaitTime}ms for user ${userId}, but adding to pool for login flow`,
          );
        }

        this.clientPool.set(userId, client);
        return client;
      } finally {
        this.pendingClientCreations.delete(userId);
      }
    })();

    this.pendingClientCreations.set(userId, creationPromise);
    return creationPromise;
  }

  public async removeClient(userId: string): Promise<void> {
    this.pendingClientCreations.delete(userId);

    const client = this.clientPool.get(userId);
    if (client) {
      this.logger.log(`Removing Telegram client for user ${userId}`);
      await client.close().catch(() => undefined);
      this.clientPool.delete(userId);

      this.logger.log(
        `Waiting for session files to be released for user ${userId}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  public getClientFromPool(userId: string): Client | undefined {
    return this.clientPool.get(userId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async validateCredentials(token: string, extra?: unknown): Promise<void> {
    if (!token) {
      throw new Error("Missing Telegram session token");
    }

    const match = token.match(/user_(.+)$/);
    if (!match || !match[1]) {
      throw new Error("Invalid session token format");
    }
    const userId = match[1];

    const client = await this.getOrCreateClient(userId, token);
    try {
      await client.invoke({ _: "getMe" });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async poll(account: { cursor: PollCursor }): Promise<PollResult> {
    this.logger.debug(
      "Poll called for Telegram, but event-driven architecture is in use. Returning empty results.",
    );
    return {
      messages: [],
      nextCursor: account.cursor,
      backoffMs: undefined,
    };
  }

  private stringifyPeerId(peer: unknown): string | undefined {
    if (!peer || typeof peer !== "object") {
      return undefined;
    }

    const candidate = peer as {
      userId?: string | number | bigint;
      channelId?: string | number | bigint;
      chatId?: string | number | bigint;
    };

    if (candidate.userId !== undefined) {
      return `user:${candidate.userId.toString()}`;
    }
    if (candidate.channelId !== undefined) {
      return `channel:${candidate.channelId.toString()}`;
    }
    if (candidate.chatId !== undefined) {
      return `chat:${candidate.chatId.toString()}`;
    }

    return undefined;
  }

  private formatMessageDate(input: unknown): string | undefined {
    if (!input) {
      return undefined;
    }

    if (input instanceof Date) {
      return input.toISOString();
    }

    if (typeof input === "number" && Number.isFinite(input)) {
      return new Date(input * 1000).toISOString();
    }

    return undefined;
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { sessionToken, chatId, message, userId, senderRole, fail } = params;

    if (fail) {
      return {
        success: false,
        error: "Simulated failure for testing purposes",
      };
    }

    if (!sessionToken) {
      return { success: false, error: "Missing session token" };
    }

    if (!chatId) {
      return { success: false, error: "Missing chat ID" };
    }

    if (!message) {
      return { success: false, error: "Missing message content" };
    }

    if (!userId) {
      return { success: false, error: "Missing user ID" };
    }

    const client = await this.getOrCreateClient(userId, sessionToken);

    try {
      let entityId: string | number;
      if (chatId.startsWith("user:")) {
        entityId = chatId.replace("user:", "");
      } else if (chatId.startsWith("channel:")) {
        entityId = chatId.replace("channel:", "");
      } else if (chatId.startsWith("chat:")) {
        entityId = chatId.replace("chat:", "");
      } else {
        entityId = chatId;
      }

      const result = await client.invoke({
        _: "sendMessage",
        chat_id: +entityId,
        input_message_content: {
          _: "inputMessageText",
          text: {
            _: "formattedText",
            text: params.message,
          },
        },
      });

      this.logger.log(`Message sent successfully to ${chatId}`);

      return {
        success: true,
        messageId: result?.id?.toString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send message to ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async fetchAndStoreContacts(
    userId: string,
    sessionToken: string,
  ): Promise<void> {
    try {
      this.logger.log("Checking Telegram provider registration in registry");
      this.drivers.get(this.key);
    } catch {
      this.logger.warn("Registering Telegram provider in registry");
      this.drivers.register(this);
    }

    const client = await this.getOrCreateClient(userId, sessionToken);

    try {
      const contacts = await client.invoke({ _: "getContacts" });
      const userIds: number[] = contacts?.user_ids || [];
      const results = await Promise.allSettled(
        userIds.map((id) => client.invoke({ _: "getUser", user_id: id })),
      );

      const contactsData: Array<{
        externalId: string;
        username?: string;
        displayName?: string;
        platformData: Record<string, unknown>;
      }> = [];

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;

        const userData = result.value as Record<string, unknown>;
        if (!(userData.is_contact as boolean)) continue;

        const externalId = userData.id?.toString();
        if (!externalId) continue;

        let username: string | undefined;
        if (
          typeof userData.usernames === "object" &&
          userData.usernames !== null
        ) {
          const usernamesObj = userData.usernames as Record<string, unknown>;
          if (
            Array.isArray(usernamesObj.active_usernames) &&
            usernamesObj.active_usernames.length > 0
          ) {
            username = usernamesObj.active_usernames[0] as string;
          }
        }

        let displayName: string | undefined;
        if (!username) {
          const firstName = (userData.first_name as string) || "";
          const lastName = (userData.last_name as string) || "";
          const combinedName = `${firstName} ${lastName}`.trim();
          username = combinedName || undefined;
          displayName = combinedName || undefined;
        } else {
          const firstName = (userData.first_name as string) || "";
          const lastName = (userData.last_name as string) || "";
          displayName = `${firstName} ${lastName}`.trim() || username;
        }

        contactsData.push({
          externalId,
          username,
          displayName,
          platformData: this.toSafeJson(userData) as Record<string, unknown>,
        });
      }

      await this.platformConnectionQueue.add(
        "store-contacts",
        {
          type: "contacts",
          platform: SocialMediaPlatform.Telegram,
          userId,
          contacts: contactsData,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      );

      this.logger.log(
        `Enqueued ${contactsData.length} contacts for storage for user ${userId}`,
      );
    } catch (error) {
      this.logger.error("Failed to fetch and store Telegram contacts", error);
      throw error;
    }
  }

  async fetchAndStoreConversations(
    userId: string,
    sessionToken: string,
  ): Promise<void> {
    this.ensureTelegramProviderRegistered();

    const client = await this.getOrCreateClient(userId, sessionToken);
    const em = this.em.fork();

    try {
      const connectedAccount = await this.validateTelegramUserAndAccount(
        em,
        userId,
      );
      if (!connectedAccount) return;

      const user = await em.findOne(UserEntity, { id: userId });
      if (!user) return;

      const chatResults = await this.fetchAllChats(client);
      const conversationsData = await this.buildConversationsData(
        chatResults,
        client,
        em,
        user,
      );

      await this.enqueueTelegramConversations(
        conversationsData,
        userId,
        connectedAccount.id,
      );

      this.logger.log(
        `Enqueued ${conversationsData.length} conversations for storage for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to fetch and store Telegram conversations",
        error,
      );
      throw error;
    }
  }

  private ensureTelegramProviderRegistered(): void {
    try {
      this.drivers.get(this.key);
    } catch {
      this.logger.warn("Registering Telegram provider in registry");
      this.drivers.register(this);
    }
  }

  private async validateTelegramUserAndAccount(
    em: EntityManager,
    userId: string,
  ) {
    const user = await em.findOne(UserEntity, { id: userId });
    if (!user) {
      this.logger.error(`User ${userId} not found`);
      return null;
    }

    const connectedAccount = await em.findOne(ConnectedAccountsEntity, {
      user: userId,
      platform: SocialMediaPlatform.Telegram,
    });

    if (!connectedAccount) {
      this.logger.error(
        `No connected account found for user ${userId} on Telegram`,
      );
      return null;
    }

    return connectedAccount;
  }

  private async fetchAllChats(client: any) {
    const chats = await client.invoke({
      _: "getChats",
      chat_list: { _: "chatListMain" },
      limit: 100,
    });

    const chatIds: number[] = chats?.chat_ids || [];
    return Promise.allSettled(
      chatIds.map((id) => client.invoke({ _: "getChat", chat_id: id })),
    );
  }

  private async buildConversationsData(
    chatResults: PromiseSettledResult<any>[],
    client: any,
    em: EntityManager,
    user: UserEntity,
  ) {
    const conversationsData: Array<{
      externalId: string;
      name: string;
      unreadCount?: number;
      platformData: Record<string, unknown>;
      messages?: Array<{
        externalMessageId: string;
        direction: "inbound" | "outbound";
        status: "sent" | "delivered" | "read" | "failed";
        text?: string;
        out: boolean;
        sentAt?: Date | null;
        platformData: Record<string, unknown>;
      }>;
      lastMessageText?: string;
    }> = [];

    for (const result of chatResults) {
      if (result.status !== "fulfilled" || !result.value) continue;

      const chatData = result.value as Record<string, unknown>;
      const chatId = chatData.id?.toString();
      if (!chatId) continue;

      const { conversationName, externalId } =
        await this.resolveConversationName(chatData, em, user, chatId);

      const { messages, lastMessageText } = await this.fetchMessages(
        client,
        chatId,
        externalId,
      );

      conversationsData.push({
        externalId,
        name: conversationName,
        unreadCount: (chatData.unread_count as number) || 0,
        platformData: this.toSafeJson(chatData) as Record<string, unknown>,
        messages,
        lastMessageText,
      });
    }

    return conversationsData;
  }

  private async resolveConversationName(
    chatData: Record<string, unknown>,
    em: EntityManager,
    user: UserEntity,
    fallbackChatId: string,
  ) {
    let conversationName = (chatData.title as string) || fallbackChatId;
    let externalId = fallbackChatId;

    if (
      typeof chatData.type === "object" &&
      chatData.type !== null &&
      (chatData.type as Record<string, unknown>)._ === "chatTypePrivate"
    ) {
      const contactUserId = (
        chatData.type as Record<string, unknown>
      ).user_id?.toString();

      if (contactUserId) {
        externalId = `user:${contactUserId}`;
        const contact = await em.findOne(ContactEntity, {
          externalId: contactUserId,
          platform: SocialMediaPlatform.Telegram,
          user,
        });
        if (contact?.displayName) conversationName = contact.displayName;
      }
    }

    return { conversationName, externalId };
  }

  private async enqueueTelegramConversations(
    conversations: any[],
    userId: string,
    accountId: string,
  ): Promise<void> {
    await this.platformConnectionQueue.add(
      "store-conversations",
      {
        type: "conversations",
        platform: SocialMediaPlatform.Telegram,
        userId,
        accountId,
        conversations,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );
  }

  private async fetchMessages(
    client: Client,
    chatId: string,
    externalId: string,
  ): Promise<{
    messages: Array<{
      externalMessageId: string;
      direction: "inbound" | "outbound";
      status: "sent" | "delivered" | "read" | "failed";
      text?: string;
      out: boolean;
      sentAt?: Date | null;
      platformData: Record<string, unknown>;
    }>;
    lastMessageText?: string;
  }> {
    try {
      const allMessages = await this.fetchAllMessages(
        client,
        chatId,
        externalId,
      );
      const { messagesData, newestMessageText } =
        this.transformMessages(allMessages);

      this.logger.log(
        `Prepared ${messagesData.length} messages for conversation ${externalId}. Newest message text: ${newestMessageText?.substring(0, 50) || "N/A"}`,
      );

      return { messages: messagesData, lastMessageText: newestMessageText };
    } catch (error) {
      this.logger.error(
        `Failed to fetch messages for conversation ${externalId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { messages: [] };
    }
  }

  private async fetchAllMessages(
    client: Client,
    chatId: string,
    externalId: string,
  ): Promise<Record<string, unknown>[]> {
    let fromMessageId = 0;
    let allMessages: Record<string, unknown>[] = [];
    const processedChatId = chatId.startsWith("user:")
      ? chatId.replace("user:", "")
      : chatId;

    this.logger.log(
      `Fetching entire chat history for conversation ${externalId}`,
    );

    while (true) {
      const res = await client.invoke({
        _: "getChatHistory",
        chat_id: parseInt(processedChatId),
        from_message_id: fromMessageId,
        offset: 0,
        limit: 100,
        only_local: false,
      });

      const messages = ((res as Record<string, unknown>).messages ||
        []) as Record<string, unknown>[];

      if (!messages || messages.length === 0) break;

      allMessages = allMessages.concat(messages);
      fromMessageId = (messages[messages.length - 1]!.id as number) || 0;

      this.logger.debug(
        `Fetched ${messages.length} messages, total: ${allMessages.length}`,
      );
    }

    this.logger.log(
      `Fetched ${allMessages.length} total messages for conversation ${externalId}`,
    );

    return allMessages;
  }

  private transformMessages(allMessages: Record<string, unknown>[]) {
    let newestMessageText: string | undefined;
    const messagesData: Array<{
      externalMessageId: string;
      direction: "inbound" | "outbound";
      status: "sent" | "delivered" | "read" | "failed";
      text?: string;
      out: boolean;
      sentAt?: Date | null;
      platformData: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < allMessages.length; i++) {
      const message = allMessages[i];
      const messageId = (message!.id as number)?.toString();
      if (!messageId) continue;

      const isOutgoing = message!.is_outgoing as boolean;
      const messageText = this.extractMessageContent(message!);

      if (i === 0 && messageText && !newestMessageText) {
        newestMessageText = messageText;
      }

      const messageDate = message!.date as number | undefined;
      const sentAt = messageDate ? new Date(messageDate * 1000) : null;

      messagesData.push({
        externalMessageId: messageId,
        direction: isOutgoing ? "outbound" : "inbound",
        status: "delivered",
        text: messageText,
        out: isOutgoing,
        sentAt,
        platformData: this.toSafeJson(message) as Record<string, unknown>,
      });
    }

    return { messagesData, newestMessageText };
  }

  private extractMessageContent(
    message: Record<string, unknown>,
  ): string | undefined {
    const content = message.content as {
      _: string;
      text?: { text?: string };
    };

    if (content?._ === "messageText" && content.text?.text) {
      return content.text.text;
    }

    return undefined;
  }

  private toSafeJson<T>(payload: T): unknown {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      this.logger.error("JSON stringify/parse error:", error);
    }

    return payload;
  }
}
