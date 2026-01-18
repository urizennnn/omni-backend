import { Injectable, Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { Inject } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import { EmailConfiguration } from "@app/config/email.config";
import { ManagedConnection, EmailConnectionConfig } from "./types.email";

@Injectable()
export class EmailConnectionManager {
  private readonly logger = new Logger(EmailConnectionManager.name);
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly pendingConnections = new Map<string, Promise<ImapFlow>>();

  constructor(
    @Inject(EmailConfiguration.KEY)
    private readonly emailConfig: ConfigType<typeof EmailConfiguration>,
  ) {}

  async getOrCreateConnection(
    accountId: string,
    config: EmailConnectionConfig,
  ): Promise<ImapFlow> {
    const existing = this.connections.get(accountId);

    if (existing && !existing.isConnecting) {
      if (existing.client.usable) {
        existing.lastUsed = new Date();
        return existing.client;
      } else {
        this.logger.warn(
          `Connection for account ${accountId} is not usable, recreating`,
        );
        await this.removeConnection(accountId);
      }
    }

    if (this.pendingConnections.has(accountId)) {
      this.logger.debug(
        `Connection already pending for account ${accountId}, waiting`,
      );
      return this.pendingConnections.get(accountId)!;
    }

    const connectionPromise = this.createConnection(accountId, config);
    this.pendingConnections.set(accountId, connectionPromise);

    try {
      const client = await connectionPromise;
      this.pendingConnections.delete(accountId);
      return client;
    } catch (error) {
      this.pendingConnections.delete(accountId);
      throw error;
    }
  }

  private async createConnection(
    accountId: string,
    config: EmailConnectionConfig,
  ): Promise<ImapFlow> {
    this.logger.log(`Creating IMAP connection for account ${accountId}`);

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      logger: false,
      tls: {
        rejectUnauthorized: true,
      },
    });

    const managed: ManagedConnection = {
      client,
      accountId,
      lastUsed: new Date(),
      isConnecting: true,
      reconnectAttempts: 0,
    };

    this.connections.set(accountId, managed);

    client.on("error", (err) => {
      this.logger.error(
        `IMAP error for account ${accountId}: ${err.message}`,
        err.stack,
      );
    });

    client.on("close", () => {
      this.logger.warn(`IMAP connection closed for account ${accountId}`);
      this.handleDisconnection(accountId);
    });

    try {
      await client.connect();
      this.logger.log(`IMAP connection established for account ${accountId}`);
      managed.isConnecting = false;
      managed.reconnectAttempts = 0;
      return client;
    } catch (error) {
      this.logger.error(
        `Failed to connect IMAP for account ${accountId}`,
        (error as Error).message,
      );
      this.connections.delete(accountId);
      throw error;
    }
  }

  private async handleDisconnection(accountId: string): Promise<void> {
    const managed = this.connections.get(accountId);
    if (!managed) return;

    if (
      managed.reconnectAttempts >= this.emailConfig.imap.maxReconnectAttempts
    ) {
      this.logger.error(
        `Max reconnection attempts reached for account ${accountId}`,
      );
      this.connections.delete(accountId);
      return;
    }

    managed.reconnectAttempts++;
    const delay =
      this.emailConfig.imap.reconnectDelayMs * managed.reconnectAttempts;

    this.logger.log(
      `Attempting reconnection for account ${accountId} in ${delay}ms (attempt ${managed.reconnectAttempts})`,
    );

    setTimeout(async () => {
      try {
        if (!managed.client.usable) {
          await managed.client.connect();
          this.logger.log(`Reconnected successfully for account ${accountId}`);
          managed.reconnectAttempts = 0;
        }
      } catch (error) {
        this.logger.error(
          `Reconnection failed for account ${accountId}`,
          error,
        );
        await this.handleDisconnection(accountId);
      }
    }, delay);
  }

  async removeConnection(accountId: string): Promise<void> {
    const managed = this.connections.get(accountId);
    if (!managed) return;

    this.logger.log(`Removing IMAP connection for account ${accountId}`);

    try {
      if (managed.client.usable) {
        await managed.client.logout();
      }
    } catch (error) {
      this.logger.error(`Error during logout for account ${accountId}`, error);
    }

    this.connections.delete(accountId);
  }

  async removeAllConnections(): Promise<void> {
    this.logger.log("Removing all IMAP connections");
    const accountIds = Array.from(this.connections.keys());
    await Promise.all(accountIds.map((id) => this.removeConnection(id)));
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  isConnected(accountId: string): boolean {
    const managed = this.connections.get(accountId);
    return managed?.client?.usable ?? false;
  }
}
