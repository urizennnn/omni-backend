import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { UserEntity } from "../../entities/user.entity";
import { UserSocialSessionEntity } from "../../entities/user-social-session.entity";
import { SenderRole, SocialMediaPlatform } from "../../types";
import { ConfigType } from "@nestjs/config";
import { ApplicationConfiguration } from "@app/config/app.config";
import { RedisService } from "../../lib/redis/redis.service";

export interface CachedSuperAdmin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface CachedSession {
  platform: SocialMediaPlatform;
  accessToken?: string;
  refreshToken?: string;
  sessionToken?: string;
}

export type SessionTokensCache = CachedSession[];

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  private readonly SUPER_ADMIN_KEY = "cache:superadmin";
  private readonly SESSION_LIST_KEY = "cache:sessions:list";
  private readonly PUSHER_SOCKET_PREFIX = "cache:pusher:socket:";
  private readonly PUSHER_SOCKET_TTL_SECONDS = 21600;
  private readonly OUTBOUND_ACTOR_PREFIX = "cache:message-actor:";
  private readonly OUTBOUND_ACTOR_TTL_SECONDS = 604800;

  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInterval = 300000;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly sessionRepo: EntityRepository<UserSocialSessionEntity>,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    this.logger.log("Initializing cache service...");

    await this.loadFromDatabase();

    this.startPeriodicRefresh();

    this.logger.log("Cache service initialized successfully");
  }

  onModuleDestroy() {
    this.stopPeriodicRefresh();
  }

  async loadFromDatabase(): Promise<void> {
    this.logger.log("Loading data from database into cache...");

    try {
      await this.loadSuperAdmin();

      await this.loadSessionTokens();

      const sessions = await this.getSessionTokens();
      this.logger.log(
        `Cache loaded successfully: ${sessions.length} sessions, ` +
          `super admin: ${(await this.getSuperAdmin()) ? "loaded" : "not found"}`,
      );
    } catch (error) {
      this.logger.error("Failed to load cache from database", error);
      throw error;
    }
  }

  private async loadSuperAdmin(): Promise<void> {
    const superAdminEmail = this.appConfig.superAdminEmail;

    if (!superAdminEmail) {
      this.logger.warn("Super admin email not configured, skipping cache");
      return;
    }

    const superAdmin = await this.userRepo.findOne(
      { email: superAdminEmail },
      { populate: ["role"] },
    );

    if (superAdmin) {
      const cachedData: CachedSuperAdmin = {
        id: superAdmin.id,
        email: superAdmin.email,
        firstName: superAdmin.firstName,
        lastName: superAdmin.lastName,
      };

      await this.redisService.set(
        this.SUPER_ADMIN_KEY,
        JSON.stringify(cachedData),
      );
      this.logger.log(`Super admin cached: ${superAdmin.email}`);
    } else {
      this.logger.warn(`Super admin not found in database: ${superAdminEmail}`);
      await this.redisService.del(this.SUPER_ADMIN_KEY);
    }
  }

  private async loadSessionTokens(): Promise<void> {
    const sessions = await this.sessionRepo.findAll({
      populate: ["user"],
    });

    const cachedSessions: CachedSession[] = [];

    for (const session of sessions) {
      if (session.accessToken || session.refreshToken || session.sessionToken) {
        cachedSessions.push({
          platform: session.platform,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          sessionToken: session.sessionToken,
        });
      }
    }

    if (cachedSessions.length > 0) {
      await this.redisService.set(
        this.SESSION_LIST_KEY,
        JSON.stringify(cachedSessions),
      );
    } else {
      await this.redisService.del(this.SESSION_LIST_KEY);
    }

    this.logger.log(
      `Loaded ${cachedSessions.length} session tokens into cache`,
    );
  }

  startPeriodicRefresh(interval?: number): void {
    if (interval) {
      this.refreshInterval = interval;
    }

    this.stopPeriodicRefresh();

    this.refreshTimer = setInterval(async () => {
      this.logger.log("Performing periodic cache refresh...");
      await this.refreshCache();
    }, this.refreshInterval);

    this.logger.log(
      `Periodic cache refresh started (interval: ${this.refreshInterval}ms)`,
    );
  }

  stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      this.logger.log("Periodic cache refresh stopped");
    }
  }

  async refreshCache(): Promise<void> {
    this.logger.log("Manual cache refresh triggered");
    await this.loadFromDatabase();
  }

  async refreshSessionToken(
    platform: SocialMediaPlatform,
  ): Promise<CachedSession | null> {
    this.logger.log(`Refreshing session token for platform ${platform}`);

    const session = await this.sessionRepo.findOne(
      { platform },
      { populate: ["user"] },
    );

    if (
      session &&
      (session.accessToken || session.refreshToken || session.sessionToken)
    ) {
      const cachedSession: CachedSession = {
        platform: session.platform,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        sessionToken: session.sessionToken,
      };

      await this.updateSessionToken(platform, cachedSession);

      this.logger.log(`Session refreshed for platform ${platform}`);
      return cachedSession;
    } else {
      await this.invalidateSessionToken(platform);

      this.logger.warn(`No session found in DB for platform ${platform}`);
      return null;
    }
  }

  async getSessionTokens(): Promise<SessionTokensCache> {
    const listData = await this.redisService.get(this.SESSION_LIST_KEY);
    return listData ? JSON.parse(listData) : [];
  }

  async getSessionToken(
    platform: SocialMediaPlatform,
  ): Promise<CachedSession | null> {
    const sessions = await this.getSessionTokens();
    const session = sessions.find((s) => s.platform === platform);
    return session || null;
  }

  async getSuperAdmin(): Promise<CachedSuperAdmin | null> {
    const data = await this.redisService.get(this.SUPER_ADMIN_KEY);

    if (!data) {
      this.logger.warn("No super admin found in cache");
      return null;
    }

    return JSON.parse(data);
  }

  async cachePusherSocketUser(
    socketId: string,
    userId: string,
  ): Promise<void> {
    if (!socketId || !userId) return;
    const key = this.getPusherSocketKey(socketId);
    await this.redisService.set(key, userId, this.PUSHER_SOCKET_TTL_SECONDS);
  }

  async getPusherSocketUser(socketId: string): Promise<string | null> {
    if (!socketId) return null;
    return this.redisService.get(this.getPusherSocketKey(socketId));
  }

  async clearPusherSocketUser(socketId: string): Promise<void> {
    if (!socketId) return;
    await this.redisService.del(this.getPusherSocketKey(socketId));
  }

  async cacheOutboundMessageActor(params: {
    platform: SocialMediaPlatform;
    accountId: string;
    messageId: string;
    actorUserId: string;
    senderRole: SenderRole;
  }): Promise<void> {
    const { platform, accountId, messageId, actorUserId, senderRole } = params;
    if (!platform || !accountId || !messageId || !actorUserId) return;
    const key = this.getOutboundActorKey(platform, accountId, messageId);
    await this.redisService.set(
      key,
      JSON.stringify({ actorUserId, senderRole }),
      this.OUTBOUND_ACTOR_TTL_SECONDS,
    );
  }

  async getOutboundMessageActor(params: {
    platform: SocialMediaPlatform;
    accountId: string;
    messageId: string;
  }): Promise<{ actorUserId: string; senderRole: SenderRole } | null> {
    const { platform, accountId, messageId } = params;
    if (!platform || !accountId || !messageId) return null;
    const key = this.getOutboundActorKey(platform, accountId, messageId);
    const data = await this.redisService.get(key);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (!parsed?.actorUserId || !parsed?.senderRole) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async clearOutboundMessageActor(params: {
    platform: SocialMediaPlatform;
    accountId: string;
    messageId: string;
  }): Promise<void> {
    const { platform, accountId, messageId } = params;
    if (!platform || !accountId || !messageId) return;
    await this.redisService.del(
      this.getOutboundActorKey(platform, accountId, messageId),
    );
  }

  async invalidateSessionToken(platform: SocialMediaPlatform): Promise<void> {
    const sessions = await this.getSessionTokens();
    const filteredSessions = sessions.filter((s) => s.platform !== platform);

    if (filteredSessions.length !== sessions.length) {
      if (filteredSessions.length > 0) {
        await this.redisService.set(
          this.SESSION_LIST_KEY,
          JSON.stringify(filteredSessions),
        );
      } else {
        await this.redisService.del(this.SESSION_LIST_KEY);
      }
      this.logger.log(`Session invalidated from cache: ${platform}`);
    }
  }

  async invalidateAllSessions(): Promise<void> {
    const sessions = await this.getSessionTokens();
    const count = sessions.length;

    if (count > 0) {
      await this.redisService.del(this.SESSION_LIST_KEY);
      this.logger.log(`Invalidated ${count} sessions from cache`);
    }
  }
  async updateSessionToken(
    platform: SocialMediaPlatform,
    session: CachedSession,
  ): Promise<void> {
    const sessions = await this.getSessionTokens();
    const index = sessions.findIndex((s) => s.platform === platform);

    if (index !== -1) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }

    await this.redisService.set(
      this.SESSION_LIST_KEY,
      JSON.stringify(sessions),
    );

    this.logger.log(`Session updated in cache: ${platform}`);
  }

  async getStats(): Promise<{
    sessionCount: number;
    platforms: SocialMediaPlatform[];
    hasSuperAdmin: boolean;
    refreshInterval: number;
    isAutoRefreshEnabled: boolean;
  }> {
    const sessions = await this.getSessionTokens();
    const platforms = sessions.map((s) => s.platform);

    const hasSuperAdmin = await this.redisService.exists(this.SUPER_ADMIN_KEY);

    return {
      sessionCount: sessions.length,
      platforms,
      hasSuperAdmin,
      refreshInterval: this.refreshInterval,
      isAutoRefreshEnabled: this.refreshTimer !== null,
    };
  }

  async clearAll(): Promise<void> {
    await this.redisService.del(this.SUPER_ADMIN_KEY);
    await this.redisService.del(this.SESSION_LIST_KEY);

    this.logger.warn("All cache cleared");
  }

  private getPusherSocketKey(socketId: string): string {
    return `${this.PUSHER_SOCKET_PREFIX}${socketId}`;
  }

  private getOutboundActorKey(
    platform: SocialMediaPlatform,
    accountId: string,
    messageId: string,
  ): string {
    return `${this.OUTBOUND_ACTOR_PREFIX}${platform}:${accountId}:${messageId}`;
  }
}
