/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  OnModuleDestroy,
  Logger,
  Inject,
  BadRequestException,
} from "@nestjs/common";
import {
  PollCursor,
  PollResult,
  ProviderDriver,
  SendMessageParams,
  SendMessageResult,
} from "../../provider.interface";
import { SocialMediaPlatform } from "@app/types";
import { EmailConnectionManager } from "./email-connection.manager";
import { UtilsService } from "@app/common/utils.service";
import { ConfigType } from "@nestjs/config";
import { EmailConfiguration } from "@app/config/email.config";
import * as nodemailer from "nodemailer";
import { Transporter } from "nodemailer";
import { simpleParser, AddressObject } from "mailparser";
import { ProviderRegistry } from "../../provider.registry";
import {
  EmailCredentials,
  EmailFolder,
  EmailPollCursor,
  MailOptions,
} from "./types.email";
import { ImapFlow } from "imapflow";
import { InjectRepository } from "@mikro-orm/nestjs";
import { MessageEntity } from "@app/entities/messages.entity";
import { EntityRepository } from "@mikro-orm/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require("nodemailer/lib/mail-composer");

@Injectable()
export class EmailProvider implements ProviderDriver, OnModuleDestroy {
  private readonly logger = new Logger(EmailProvider.name);
  readonly key: SocialMediaPlatform = SocialMediaPlatform.Email;
  private transporters = new Map<string, Transporter>();
  private sentFolderCache = new Map<string, string>();

  constructor(
    private readonly connectionManager: EmailConnectionManager,
    private readonly utilsService: UtilsService,
    @Inject(EmailConfiguration.KEY)
    private readonly emailConfig: ConfigType<typeof EmailConfiguration>,
    private readonly drivers: ProviderRegistry,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
  ) {
    this.drivers.register(this);
  }

  async validateCredentials(token: string, extra?: unknown): Promise<void> {
    try {
      const credentials = this.utilsService.decryptEmailCredentials(token);

      const client = await this.connectionManager.getOrCreateConnection(
        credentials.email,
        {
          host: credentials.imapHost,
          port: credentials.imapPort,
          secure: credentials.imapSecure,
          auth: {
            user: credentials.email,
            pass: credentials.imapPassword,
          },
        },
      );

      await client.mailboxOpen("INBOX");
      this.logger.log(`Credentials validated for ${credentials.email}`);
    } catch (error) {
      this.logger.error("Failed to validate email credentials", error);
      throw new BadRequestException("Invalid email credentials");
    }
  }

  async poll(account: {
    id: string;
    accessToken: string;
    cursor: PollCursor;
  }): Promise<PollResult> {
    try {
      const credentials = this.utilsService.decryptEmailCredentials(
        account.accessToken,
      );

      const client = await this.getImapClient(account.id, credentials);
      const previousCursor = this.normalizeCursor(
        account.cursor as EmailPollCursor | null,
      );
      const inboxMessage = await this.pollSpecifiedFolder(
        EmailFolder.Inbox,
        account,
        client,
        credentials,
      );
      const sentMessage = await this.pollSpecifiedFolder(
        EmailFolder.Sent,
        account,
        client,
        credentials,
      );

      this.logger.log("Inbox Messages:", inboxMessage.messages);
      this.logger.log("Sent Messages:", sentMessage.messages);

      return {
        messages: [...inboxMessage.messages, ...sentMessage.messages],
        platform: SocialMediaPlatform.Email,
        nextCursor: {
          Inbox: inboxMessage.maxUid ?? previousCursor.Inbox ?? 0,
          Sent: sentMessage.maxUid ?? previousCursor.Sent ?? 0,
        },
      };
    } catch (error) {
      this.logger.error(`Error in poll():`, (error as Error).stack);
      throw error;
    }
  }
  private async pollSpecifiedFolder(
    folder: EmailFolder,
    account: { id: string; accessToken: string; cursor: PollCursor },
    client: ImapFlow,
    credentials: { email: string },
  ) {
    this.logger.log("Performing fetch for folder: " + folder);
    const cursor = this.normalizeCursor(
      account.cursor as EmailPollCursor | null,
    );
    const folderCursorKey: keyof EmailPollCursor =
      folder === EmailFolder.Inbox ? "Inbox" : "Sent";
    const mailbox = await client.mailboxOpen(folder);
    const unseenSearchResult = await client.search(
      { seen: false },
      { uid: true },
    );
    const unseenUids = Array.isArray(unseenSearchResult)
      ? unseenSearchResult
      : [];
    this.logger.log(
      `Unseen messages: ${unseenUids.length} UIDs`,
      `EmailPoll:${account.id}`,
    );

    this.logger.log("logggin mailbox", mailbox);

    if (!mailbox.exists || mailbox.exists === 0) {
      return { messages: [], maxUid: cursor[folderCursorKey] ?? 0 };
    }

    const lastUid = Number(cursor[folderCursorKey] ?? 0);
    const uidsToFetch = await this.getUidsToFetch(client, lastUid);

    if (uidsToFetch.length === 0) {
      return { messages: [], maxUid: lastUid };
    }

      const { messages, maxUid } = await this.fetchAndParseMessages(
        client,
        uidsToFetch,
        lastUid,
        credentials.email,
        account.id,
        folder,
      );

    this.logger.log(
      `Polled ${messages.length} messages for account ${account.id}`,
    );
    return {
      messages,
      maxUid: maxUid ?? lastUid,
    };
  }

  private normalizeCursor(
    cursor: EmailPollCursor | null | undefined,
  ): EmailPollCursor {
    return {
      Inbox: cursor?.Inbox ?? 0,
      Sent: cursor?.Sent ?? 0,
    };
  }

  async fetchMessagesByUid(
    accountId: string,
    accessToken: string,
    uids: number[],
  ): Promise<PollResult["messages"]> {
    if (!uids || uids.length === 0) {
      return [];
    }

    try {
      const credentials =
        this.utilsService.decryptEmailCredentials(accessToken);
      const client = await this.getImapClient(accountId, credentials);
      await client.mailboxOpen("INBOX");
      const sortedUids = [...uids].sort((a, b) => a - b);
      const { messages } = await this.fetchAndParseMessages(
        client,
        sortedUids,
        sortedUids[0] ?? 0,
        credentials.email,
        accountId,
        EmailFolder.Inbox,
      );

      this.logger.log(
        `Fetched ${messages.length} messages by UID for account ${accountId}`,
      );

      return messages;
    } catch (error) {
      this.logger.error(
        `Failed to fetch messages by UID for account ${accountId}`,
        error,
      );
      throw error;
    }
  }

  async deleteAllMessagesFromFolder(
    accountId: string,
    accessToken: string,
    folderPath = "INBOX",
  ): Promise<number> {
    const credentials = this.utilsService.decryptEmailCredentials(accessToken);
    const client = await this.getImapClient(accountId, credentials);

    await client.mailboxOpen(folderPath);

    const searchResult = await client.search({ all: true }, { uid: true });
    const allUids = Array.isArray(searchResult) ? searchResult : [];

    if (allUids.length === 0) {
      this.logger.log(
        `No messages to delete in ${folderPath} for account ${accountId}`,
      );
      return 0;
    }

    await client.messageFlagsAdd(allUids, ["\\Deleted"], { uid: true });
    await client.messageDelete(allUids, { uid: true });

    this.logger.log(
      `Deleted ${allUids.length} messages from ${folderPath} for account ${accountId}`,
    );

    return allUids.length;
  }

  private async getImapClient(
    accountId: string,
    credentials: EmailCredentials,
  ): Promise<ImapFlow> {
    return this.connectionManager.getOrCreateConnection(accountId, {
      host: credentials.imapHost,
      port: credentials.imapPort,
      secure: credentials.imapSecure,
      auth: {
        user: credentials.email,
        pass: credentials.imapPassword,
      },
    });
  }

  private async getUidsToFetch(
    client: ImapFlow,
    lastUid: number,
  ): Promise<number[]> {
    const searchCriteria =
      lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { all: true };

    const matchingUids = await client.search(searchCriteria, { uid: true });

    if (!matchingUids || matchingUids.length === 0) {
      return [];
    }

    const sortedUids = [...matchingUids].sort((a, b) => a - b);
    const maxMessagesPerPoll =
      this.emailConfig.messageRetrieval.maxMessagesPerPoll;

    return lastUid > 0
      ? sortedUids.slice(0, maxMessagesPerPoll)
      : sortedUids.slice(-maxMessagesPerPoll);
  }

  private async fetchAndParseMessages(
    client: ImapFlow,
    uidsToFetch: number[],
    initialUid: number,
    email: string,
    accountId: string,
    folder?: EmailFolder,
  ) {
    const fetchOptions = {
      uid: true,
      flags: true,
      bodyStructure: true,
      envelope: true,
      internalDate: true,
      size: true,
      source: true,
    };

    const messages: PollResult["messages"] = [];
    let maxUid = initialUid;

    for await (const msg of client.fetch(uidsToFetch, fetchOptions, {
      uid: true,
    })) {
      if (!msg.source) {
        this.logger.warn(`Message ${msg.uid} has no source, skipping`);
        continue;
      }

      try {
        const parsed = await simpleParser(msg.source);
        const uid = msg.uid;

        if (uid > maxUid) {
          maxUid = uid;
        }

        messages.push(this.buildMessageFromParsed(parsed, uid, email, folder));

        if (
          messages.length >=
          this.emailConfig.messageRetrieval.maxMessagesPerPoll
        ) {
          break;
        }
      } catch (parseErr) {
        this.logger.error(
          `Failed to parse message ${msg.uid} for account ${accountId}`,
          parseErr,
        );
      }
    }

    if (messages.length > 0) {
      try {
        const fetchedUids = messages
          .map((m) => (m.raw as { uid?: number }).uid)
          .filter((uid): uid is number => typeof uid === "number");
        if (fetchedUids.length > 0) {
          await client.messageFlagsAdd(fetchedUids, ["\\Seen"], { uid: true });
          this.logger.log(
            `Marked ${fetchedUids.length} messages as seen for account ${accountId}`,
          );
        }
      } catch (flagError) {
        this.logger.warn(
          `Failed to mark messages as seen for account ${accountId}`,
          flagError,
        );
      }
    }

    return { messages, maxUid };
  }

  private buildMessageFromParsed(
    parsed: Awaited<ReturnType<typeof simpleParser>>,
    uid: number,
    email: string,
    folder?: EmailFolder,
  ) {
    const from =
      parsed.from?.value?.[0]?.address ||
      this.addressToEmailList(parsed.from) ||
      parsed.from?.text ||
      "unknown";
    const senderName =
      parsed.from?.value?.[0]?.name || from.split("@")[0] || "Unknown";
    const subject = parsed.subject || "(no subject)";
    const toAddress = this.addressToEmailList(parsed.to) || email;
    const toPrimary =
      this.addressToPrimaryEmail(parsed.to) ||
      toAddress.split(",")[0]?.trim() ||
      email;
    const isSentFolder = folder === EmailFolder.Sent;
    const counterparty = isSentFolder ? toPrimary : from;

    const attachments =
      parsed.attachments?.map((att) => ({
        kind: att.contentType || "application/octet-stream",
        url: "",
        mime: att.contentType,
        size: att.size,
        filename: att.filename,
        content: att.content,
      })) || [];

    const references = parsed.references
      ? Array.isArray(parsed.references)
        ? parsed.references
        : [parsed.references]
      : undefined;

    const threadId = this.extractThreadId(parsed, references);

    return {
      externalMessageId: parsed.messageId || `${email}-${uid}`,
      conversationExternalId: counterparty,
      sentAt: parsed.date?.toISOString() || new Date().toISOString(),
      senderHandle: from,
      senderName: senderName,
      text: parsed.text || "",
      html: parsed.html || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references,
      threadId,
      subject,
      raw: {
        messageId: parsed.messageId,
        subject: parsed.subject,
        to: toAddress,
        from,
        cc: this.addressToString(parsed.cc),
        bcc: this.addressToString(parsed.bcc),
        replyTo: this.addressToString(parsed.replyTo),
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        uid,
        counterparty,
        ...(isSentFolder ? { direction: "outbound", out: true } : {}),
      },
    };
  }
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    this.logger.log("Email requested to send message");
    try {
      this.validateSendParams(params);

      const credentials = this.utilsService.decryptEmailCredentials(
        params.sessionToken,
      );
      this.logger.log(
        `Sending email from ${credentials.email} to ${params.chatId}`,
      );

      const transporter = await this.getOrCreateTransporter(credentials.email, {
        email: credentials.email,
        smtpPassword: credentials.smtpPassword,
        smtpHost: credentials.smtpHost,
        smtpPort: credentials.smtpPort,
        smtpSecure: credentials.smtpSecure,
      });

      const subject = await this.buildSubject(params);
      const mailOptions = this.buildMailOptions(
        credentials.email,
        params,
        subject,
      );

      this.logger.log("[MailOptions]", mailOptions);

      const info = await transporter.sendMail(mailOptions);

      if (params.accountId) {
        try {
          await this.appendToSentFolder(
            params.accountId,
            credentials,
            mailOptions,
            info.messageId,
          );
        } catch (appendError) {
          this.logger.fatal(
            "Failed to append sent email to Sent folder",
            appendError,
          );
        }
      }

      if (params.accountId) {
        try {
          await this.appendToSentFolder(
            params.accountId,
            credentials,
            mailOptions,
            info.messageId,
          );
        } catch (appendError) {
          // Already logged in appendToSentFolder
        }
      }

      this.logger.log(
        `Email sent from ${credentials.email} to ${params.chatId}`,
      );

      return {
        success: true,
        messageId: info.messageId,
        subject,
      };
    } catch (error) {
      this.logger.error("Failed to send email", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private validateSendParams(params: SendMessageParams): void {
    if (params.reply && params.subject) {
      throw new BadRequestException(
        "Cannot specify both 'reply' and 'subject' in the same request. When replying to an email, the subject is automatically determined from the original message.",
      );
    }

    if (!params.reply && !params.subject) {
      throw new BadRequestException(
        "Subject is required for new email messages",
      );
    }
  }

  private async buildSubject(params: SendMessageParams): Promise<string> {
    if (!params.reply || !params.parentMessageId) {
      return params.subject!;
    }

    const parentMsg = await this.messageRepo.findOne({
      externalMessageId: params.parentMessageId,
    });
    const parentSubject = parentMsg?.subject || "";

    return parentSubject.startsWith("Re:")
      ? parentSubject
      : `Re: ${parentSubject}`;
  }

  private buildMailOptions(
    senderEmail: string,
    params: SendMessageParams,
    subject: string,
  ): MailOptions {
    const mailOptions: MailOptions = {
      from: senderEmail,
      to: params.chatId,
      subject,
      text: params.message,
    };

    if (params.html) {
      mailOptions.html = params.html;
    }

    if (params.reply && params.parentMessageId) {
      const refs = params.parentReferences || [];
      const allRefs = [...refs, params.parentMessageId];

      mailOptions.headers = {
        "In-Reply-To": this.ensureBrackets(params.parentMessageId),
        References: allRefs.map((ref) => this.ensureBrackets(ref)).join(" "),
      };

      this.logger.debug(
        `Reply email: In-Reply-To=${params.parentMessageId}, refs=${allRefs.length}`,
      );
    }

    const cc = this.processRecipients(params.ccRecipients, senderEmail);
    if (cc) {
      mailOptions.cc = cc;
      this.logger.debug(`CC recipients: ${cc}`);
    }

    const bcc = this.processRecipients(params.bccRecipients, senderEmail);
    if (bcc) {
      mailOptions.bcc = bcc;
      this.logger.debug(`BCC recipients: ${bcc}`);
    }

    return mailOptions;
  }

  private processRecipients(
    recipients: string | undefined,
    senderEmail: string,
  ): string | undefined {
    if (!recipients) return undefined;

    const addresses = recipients
      .split(",")
      .map((addr) => addr.trim())
      .filter(
        (addr) =>
          addr && !addr.toLowerCase().includes(senderEmail.toLowerCase()),
      );

    if (addresses.length === 0) return undefined;

    const unique = [...new Set(addresses)];
    return unique.join(", ");
  }

  private ensureBrackets(id: string): string {
    const cleaned = id.trim();
    if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
      return cleaned;
    }
    return `<${cleaned}>`;
  }

  async updateMessageStatus(params: unknown): Promise<boolean> {
    return true;
  }

  private async getOrCreateTransporter(
    accountId: string,
    credentials: {
      email: string;
      smtpPassword: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
    },
  ): Promise<Transporter> {
    try {
      const existing = this.transporters.get(accountId);
      if (existing) {
        this.logger.log(`Using existing transporter for ${accountId}`);
        return existing;
      }

      this.logger.log(`Creating new SMTP transporter for ${accountId}...`);

      if (!credentials.smtpHost || !credentials.smtpPort) {
        throw new Error("SMTP host and port are required for sending emails");
      }

      const transporter = await this.createTransporterWithTlsFallback(
        accountId,
        {
          email: credentials.email,
          smtpPassword: credentials.smtpPassword,
          smtpHost: credentials.smtpHost!,
          smtpPort: credentials.smtpPort!,
          smtpSecure: credentials.smtpSecure,
        },
      );

      this.transporters.set(accountId, transporter);
      return transporter;
    } catch (error) {
      this.logger.error("Failed to create SMTP transporter", error);
      throw error;
    }
  }

  private async createTransporterWithTlsFallback(
    accountId: string,
    credentials: {
      email: string;
      smtpPassword: string;
      smtpHost: string;
      smtpPort: number;
      smtpSecure?: boolean;
    },
  ): Promise<Transporter> {
    const initialSecure = this.resolveSecureMode(
      credentials.smtpPort,
      credentials.smtpSecure,
    );

    try {
      return await this.createVerifiedTransporter(
        accountId,
        credentials,
        initialSecure,
      );
    } catch (error) {
      if (!this.shouldRetryWithAlternateSecure(error)) {
        throw error;
      }

      const retrySecure = !initialSecure;
      this.logger.warn(
        `TLS negotiation failed for ${accountId} using secure=${initialSecure}. Retrying with secure=${retrySecure}.`,
      );

      return this.createVerifiedTransporter(
        accountId,
        credentials,
        retrySecure,
      );
    }
  }

  private async createVerifiedTransporter(
    accountId: string,
    credentials: {
      email: string;
      smtpPassword: string;
      smtpHost: string;
      smtpPort: number;
    },
    secure: boolean,
  ): Promise<Transporter> {
    const transportConfig = this.buildTransportConfig(credentials, secure);
    const transporter = nodemailer.createTransport(transportConfig);

    try {
      await transporter.verify();
      const mode = secure ? "implicit TLS" : "STARTTLS";
      this.logger.log(
        `SMTP transporter verified for ${accountId} on ${credentials.smtpHost}:${credentials.smtpPort} (${mode})`,
      );
      return transporter;
    } catch (verifyError) {
      transporter.close?.();
      this.logger.error(
        `SMTP transporter verification failed for ${accountId} with secure=${secure}`,
        verifyError,
      );
      throw verifyError;
    }
  }

  private buildTransportConfig(
    credentials: {
      email: string;
      smtpPassword: string;
      smtpHost: string;
      smtpPort: number;
    },
    secure: boolean,
  ) {
    return {
      host: credentials.smtpHost,
      port: credentials.smtpPort,
      secure,
      auth: {
        user: credentials.email,
        pass: credentials.smtpPassword,
      },
      connectionTimeout: this.emailConfig.smtp.connectionTimeout,
      greetingTimeout: this.emailConfig.smtp.connectionTimeout,
      socketTimeout: this.emailConfig.smtp.connectionTimeout,
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    } as const;
  }

  private resolveSecureMode(
    smtpPort?: number,
    requestedSecure?: boolean,
  ): boolean {
    if (typeof requestedSecure === "boolean") {
      return requestedSecure;
    }

    if (!smtpPort) {
      return this.emailConfig.smtp.defaultSecure;
    }

    if (smtpPort === 465) {
      return true;
    }

    if ([587, 25, 2525].includes(smtpPort)) {
      return false;
    }

    return this.emailConfig.smtp.defaultSecure;
  }

  private shouldRetryWithAlternateSecure(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = (error.message || "").toLowerCase();
    if (message.includes("wrong version number")) {
      return true;
    }

    const errno = error as NodeJS.ErrnoException;
    if (
      errno.code &&
      ["EPROTO", "ECONNRESET"].includes(String(errno.code).toUpperCase())
    ) {
      return true;
    }

    return false;
  }

  private addressToString(
    address: AddressObject | AddressObject[] | undefined,
  ): string | undefined {
    if (!address) return undefined;
    if (Array.isArray(address)) {
      return address.map((a) => a.text).join(", ");
    }
    return address.text;
  }

  private addressToEmailList(
    address: AddressObject | AddressObject[] | undefined,
  ): string | undefined {
    if (!address) return undefined;

    const values: string[] = [];
    const addAddress = (entry: AddressObject) => {
      if (entry?.value?.length) {
        entry.value.forEach((item) => {
          if (item?.address) {
            values.push(item.address);
          }
        });
      }
      if (values.length === 0 && entry?.text) {
        values.push(entry.text);
      }
    };

    if (Array.isArray(address)) {
      address.forEach(addAddress);
    } else {
      addAddress(address);
    }

    if (values.length === 0) return undefined;
    return values.join(", ");
  }

  private addressToPrimaryEmail(
    address: AddressObject | AddressObject[] | undefined,
  ): string | undefined {
    const list = this.addressToEmailList(address);
    if (!list) return undefined;
    return list.split(",")[0]?.trim();
  }

  private extractThreadId(
    parsed: Awaited<ReturnType<typeof simpleParser>>,
    normalizedReferences?: string[],
  ): string {
    if (
      normalizedReferences &&
      normalizedReferences.length > 0 &&
      normalizedReferences[0]
    ) {
      return normalizedReferences[0];
    }
    if (parsed.inReplyTo) {
      return parsed.inReplyTo;
    }
    return parsed.messageId || "";
  }

  private async findSentFolder(
    client: ImapFlow,
    accountId: string,
  ): Promise<string> {
    if (this.sentFolderCache.has(accountId)) {
      const cached = this.sentFolderCache.get(accountId)!;
      this.logger.debug(`Using cached Sent folder: ${cached} for ${accountId}`);
      return cached;
    }

    this.logger.debug(`Listing mailboxes to find Sent folder for ${accountId}`);
    const mailboxes = await client.list();
    this.logger.debug(`Found ${mailboxes.length} mailboxes for ${accountId}`);

    const sentMailbox = mailboxes.find((m) => m.specialUse === "\\Sent");
    if (sentMailbox) {
      this.logger.log(
        `Found Sent folder via specialUse: ${sentMailbox.path} for ${accountId}`,
      );
      this.sentFolderCache.set(accountId, sentMailbox.path);
      return sentMailbox.path;
    }

    const commonNames = ["Sent", "[Gmail]/Sent", "Sent Items", "Sent Mail"];
    for (const name of commonNames) {
      if (mailboxes.find((m) => m.path === name)) {
        this.logger.log(
          `Found Sent folder via common name: ${name} for ${accountId}`,
        );
        this.sentFolderCache.set(accountId, name);
        return name;
      }
    }

    this.logger.warn(
      `No Sent folder found, defaulting to "Sent" for ${accountId}`,
    );
    this.sentFolderCache.set(accountId, "Sent");
    return "Sent";
  }

  private async buildRfc822Message(
    mailOptions: MailOptions,
    messageId: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const mailOptionsWithHeaders = {
        ...mailOptions,
        headers: {
          "Message-ID": messageId,
          Date: new Date().toUTCString(),
          ...mailOptions.headers,
        },
      };

      const composer = new MailComposer(mailOptionsWithHeaders);

      composer.compile().build((err: Error | null, message: Buffer) => {
        if (err) reject(err);
        else resolve(message);
      });
    });
  }

  private async appendToSentFolder(
    accountId: string,
    credentials: EmailCredentials,
    mailOptions: MailOptions,
    messageId: string,
  ): Promise<void> {
    try {
      const client = await this.getImapClient(accountId, credentials);
      const sentFolderPath = await this.findSentFolder(client, accountId);
      const rfc822Message = await this.buildRfc822Message(
        mailOptions,
        messageId,
      );

      await client.append(
        sentFolderPath,
        rfc822Message.toString(),
        ["\\Seen"],
        new Date(),
      );

      this.logger.log(
        `Appended sent message to ${sentFolderPath} for account ${accountId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to append to Sent folder for account ${accountId}`,
        error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Cleaning up email provider");
    await this.connectionManager.removeAllConnections();
    this.transporters.clear();
  }
}
