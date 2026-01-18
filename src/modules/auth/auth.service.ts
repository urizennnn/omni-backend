import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from "crypto";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  EntityRepository,
  UniqueConstraintViolationException,
} from "@mikro-orm/core";
import { MailgunEmailFactory } from "@app/lib/mailgun-email.factory";
import { RoleEntity, UserEntity } from "@app/entities/user.entity";
import { UserOtpEntity } from "@app/entities/user-otp.entity";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { SocialMediaPlatform, UserStatus } from "@app/types";
import { InvitePADto } from "./dto/invtie-pa.dto";
import { authenticator } from "otplib";
import * as qrode from "qrcode";
import { JwtService } from "@nestjs/jwt";
import { ConfigType } from "@nestjs/config";
import { JwtConfiguration } from "@app/config/jwt.config";
import { MfaConfiguration } from "@app/config/mfa.config";
import { AuthTokens, TelegramAuthPromises, TelegramLoginCache } from "./types";
import { v4 as uuid } from "uuid";
import { RedisService } from "@app/lib/redis";
import { ProviderRegistry } from "@app/lib/social-media-registry/provider.registry";
import { TelegramProvider } from "@app/lib/social-media-registry/providers/telegram/telegram.provider";
import { TelegramEventListener } from "@app/lib/social-media-registry/providers/telegram/telegram-event-listener.service";
import { XProvider } from "@app/lib/social-media-registry/providers/x/x.provider";
import { ApplicationConfiguration } from "@app/config/app.config";
import { XAPIConfiguration } from "@app/config/x.config";
import { TwitterApi } from "twitter-api-v2";
import { XOAuthCache } from "./types";
import { UtilsService } from "@app/common/utils.service";
import { EmailProvider } from "@app/lib/social-media-registry/providers/email/email.provider";

const TELEGRAM_LOGIN_TTL_SECONDS = 300;
const X_OAUTH_TTL_SECONDS = 600;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pendingAuthPromises = new Map<
    string,
    TelegramAuthPromises
  >();

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    @InjectRepository(UserOtpEntity)
    private readonly otpRepo: EntityRepository<UserOtpEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: EntityRepository<RoleEntity>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly socialSessionRepo: EntityRepository<UserSocialSessionEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
    private readonly mailer: MailgunEmailFactory,
    private readonly jwtService: JwtService,
    @Inject(JwtConfiguration.KEY)
    private readonly jwtConfig: ConfigType<typeof JwtConfiguration>,
    @Inject(MfaConfiguration.KEY)
    private readonly mfaConfig: ConfigType<typeof MfaConfiguration>,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    @Inject(XAPIConfiguration.KEY)
    private readonly xConfig: ConfigType<typeof XAPIConfiguration>,
    private readonly redis: RedisService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly telegramProvider: TelegramProvider,
    private readonly telegramEventListener: TelegramEventListener,
    private readonly xProvider: XProvider,
    private readonly utilsService: UtilsService,
    private readonly emailProvider: EmailProvider,
  ) {
    this.logger.log("AuthService initialized");
    this.logger.log(
      this.mfaConfig.encryptionKey
        ? "MFA encryption key loaded"
        : "MFA encryption key missing",
    );
  }

  async invitePaUser(dto: InvitePADto): Promise<{ userId: string }> {
    const role = await this.getPaRole();

    for (const platformAccess of dto.platform) {
      if (platformAccess.canSend && !platformAccess.viewMessages) {
        throw new BadRequestException(
          `Invalid permission configuration for platform ${platformAccess.platform}: ` +
            `canSend cannot be true when viewMessages is false`,
        );
      }
    }

    dto.email = dto.email.toLowerCase();
    let user: UserEntity;
    try {
      user = await this.userRepo
        .getEntityManager()
        .transactional(async (em) => {
          const repo = em.getRepository(UserEntity);

          const existing = await repo.findOne({ email: dto.email });
          if (existing) throw new ConflictException("User already exists");

          const entity = repo.create({
            email: dto.email,
            firstName: dto.firstname,
            lastName: dto.lastname,
            role,
            platformAccess: dto.platform,
            status: "pending" as UserStatus,
            disabled: false,
          });

          em.persist(entity);
          await em.flush();
          return entity;
        });
    } catch (e) {
      if (e instanceof UniqueConstraintViolationException) {
        throw new ConflictException("Email already taken");
      }
      throw e;
    }

    try {
      const { subject, text, html } = this.mailer.composeInviteEmail(user);
      await this.mailer.sendMail({ to: user.email, subject, text, html });
    } catch (err) {
      this.logger.error(
        "Failed to send invite email",
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        "User created but failed to send invite email",
      );
    }

    return { userId: user.id };
  }

  async requestOtp(email: string): Promise<{ message: string }> {
    email = email.toLowerCase();
    const { otp } = await this.createOrTouchUserAndIssueOtp(email);
    const { subject, text, html } = this.mailer.composeOtpEmail(otp);
    try {
      await this.mailer.sendMail({ to: email, subject, text, html });
    } catch (err) {
      this.logger.error(
        "Failed to dispatch OTP email",
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException("Unable to send OTP at this time");
    }
    return { message: "accepted" };
  }

  async verifyOtp(
    email: string,
    code: string,
  ): Promise<{ mfaEnabled: boolean }> {
    email = email.toLowerCase();

    const user = await this.userRepo.findOne({ email });
    if (!user) throw new NotFoundException("User not found");

    const mfaEnabled = Boolean(user.twoFactorSecret);

    const record = await this.otpRepo.findOne(
      { user, code, verifiedAt: null },
      { orderBy: { createdAt: "desc" } },
    );

    const now = new Date();
    if (!record || record.expiresAt <= now) {
      throw new BadRequestException("Invalid or expired code");
    }

    record.verifiedAt = now;
    user.emailVerifiedAt = now;
    if (user.status === "pending") user.status = "active";

    const em = this.userRepo.getEntityManager();
    em.persist(user);
    em.persist(record);
    await em.flush();

    return { mfaEnabled };
  }

  async connectTelegram() {
    const user = await this.userRepo.findOne({
      email: this.appConfig.superAdminEmail,
    });
    if (!user) throw new NotFoundException("User not found");

    const databaseDirectory = `_td_database/user_${user.id}`;

    this.logger.log(`Removing any existing Telegram client for fresh login`);
    await this.telegramProvider.removeClient(user.id);

    const loginId = uuid();
    const cache: TelegramLoginCache = {
      userId: user.id,
      phone: this.appConfig.superAdminPhone,
      databaseDirectory,
    };

    await this.redis.set(
      this.buildTelegramLoginKey(loginId),
      JSON.stringify(cache),
      TELEGRAM_LOGIN_TTL_SECONDS,
    );

    const client = await this.telegramProvider.getOrCreateClient(
      user.id,
      databaseDirectory,
      true,
    );

    try {
      client
        .login({
          getPhoneNumber: async (retry) => {
            if (retry) throw new Error("Invalid phone number");
            return this.appConfig.superAdminPhone;
          },
          getAuthCode: async (retry) => {
            this.logger.log(
              `Auth code requested for loginId ${loginId}, retry: ${retry}`,
            );

            return new Promise<string>((resolve, reject) => {
              const existing = this.pendingAuthPromises.get(loginId);
              if (existing) {
                existing.resolveAuthCode = resolve;
                existing.rejectAuthCode = reject;
              } else {
                this.pendingAuthPromises.set(loginId, {
                  resolveAuthCode: resolve,
                  rejectAuthCode: reject,
                  resolvePassword: () => {},
                  rejectPassword: () => {},
                });
              }

              setTimeout(() => {
                reject(
                  new Error(
                    "Auth code timeout - user did not submit code in time",
                  ),
                );
                this.pendingAuthPromises.delete(loginId);
              }, TELEGRAM_LOGIN_TTL_SECONDS * 1000);
            });
          },
          getPassword: async (passwordHint, retry) => {
            this.logger.log(
              `2FA password requested for loginId ${loginId}, hint: ${passwordHint}, retry: ${retry}`,
            );

            return new Promise<string>((resolve, reject) => {
              const existing = this.pendingAuthPromises.get(loginId);
              if (existing) {
                existing.resolvePassword = resolve;
                existing.rejectPassword = reject;
              } else {
                this.pendingAuthPromises.set(loginId, {
                  resolveAuthCode: () => {},
                  rejectAuthCode: () => {},
                  resolvePassword: resolve,
                  rejectPassword: reject,
                });
              }

              setTimeout(() => {
                reject(
                  new Error(
                    "2FA password timeout - user did not submit password in time",
                  ),
                );
                this.pendingAuthPromises.delete(loginId);
              }, TELEGRAM_LOGIN_TTL_SECONDS * 1000);
            });
          },
        })
        .catch((error) => {
          this.logger.error(
            `Background Telegram login failed for loginId ${loginId}:`,
            error,
          );
          this.pendingAuthPromises.delete(loginId);
        });

      return { loginId };
    } catch (error) {
      this.logTelegramFailure("connectTelegram", error);
      throw this.mapTelegramError(error, "Failed to connect to Telegram");
    }
  }

  async verifyTelegram(loginId: string, code: string, twoFA?: string) {
    const { user, cached, authPromises } = await this.validateTelegramAuth(loginId);

    try {
      this.logger.log(`Resolving auth code for loginId ${loginId}`);
      authPromises.resolveAuthCode(code);

      if (twoFA) {
        this.logger.log(`Resolving 2FA password for loginId ${loginId}`);
        authPromises.resolvePassword(twoFA);
      }

      const client = await this.telegramProvider.getOrCreateClient(
        user.id,
        cached.databaseDirectory,
      );

      await this.pollTelegramAuthCompletion(client, user.id);

      const sessionToken = cached.databaseDirectory;

      await this.persistSessionAndFetchData(user, sessionToken);
      await this.cleanupAuthState(loginId);

      return { session: sessionToken };
    } catch (e: unknown) {
      this.logTelegramFailure("verifyTelegram", e);

      if (authPromises) {
        authPromises.rejectAuthCode(new Error("Verification failed"));
        authPromises.rejectPassword(new Error("Verification failed"));
      }
      this.pendingAuthPromises.delete(loginId);

      throw this.mapTelegramError(e, "Failed to verify Telegram");
    }
  }

  async connectX(userId: string): Promise<{ authUrl: string; state: string }> {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException("User not found");

    const state = randomBytes(16).toString("hex");

    const client = new TwitterApi({
      clientId: this.xConfig.X_OAUTH_CLIENT_ID,
      clientSecret: this.xConfig.X_OAUTH_CLIENT_SECRET,
    });

    const { url, codeVerifier } = client.generateOAuth2AuthLink(
      this.xConfig.X_OAUTH_REDIRECT_URI,
      {
        scope: this.xConfig.X_OAUTH_SCOPES.split(" "),
        state,
      },
    );

    const cache: XOAuthCache = {
      userId: user.id,
      codeVerifier,
      state,
    };

    await this.redis.set(
      this.buildXOAuthKey(state),
      JSON.stringify(cache),
      X_OAUTH_TTL_SECONDS,
    );

    this.logger.log(
      `Generated X OAuth URL for user ${user.id}, state: ${state}`,
    );

    return { authUrl: url, state };
  }

  async handleXCallback(code: string, state: string) {
    const raw = await this.redis.get(this.buildXOAuthKey(state));
    if (!raw) {
      throw new BadRequestException("OAuth state expired or invalid");
    }

    let cached: XOAuthCache;
    try {
      cached = JSON.parse(raw) as XOAuthCache;
    } catch (error) {
      this.logger.error("Failed to parse X OAuth cache", error);
      await this.redis.del(this.buildXOAuthKey(state));
      throw new InternalServerErrorException(
        "Unable to process X verification",
      );
    }

    const user = await this.userRepo.findOne({ id: cached.userId });
    if (!user) throw new NotFoundException("User not found");

    if (cached.state !== state) {
      throw new BadRequestException("State mismatch");
    }

    try {
      const client = new TwitterApi({
        clientId: this.xConfig.X_OAUTH_CLIENT_ID,
        clientSecret: this.xConfig.X_OAUTH_CLIENT_SECRET,
      });

      const {
        client: loggedClient,
        accessToken,
        refreshToken,
        expiresIn,
      } = await client.loginWithOAuth2({
        code,
        codeVerifier: cached.codeVerifier,
        redirectUri: this.xConfig.X_OAUTH_REDIRECT_URI,
      });

      const me = await loggedClient.v2.me();
      this.logger.log(
        `X authentication successful for user ${user.id}, X username: ${me.data.username}`,
      );

      await Promise.allSettled([
        this.persistXSession(
          user,
          accessToken,
          refreshToken ?? undefined,
          expiresIn,
        ),
        this.persistXConnectedAccount(user, me.data.id),
      ]);

      await this.redis.del(this.buildXOAuthKey(state));

      this.logger.log(`X connection successful for user ${user.id}`);

      // Fetch and store conversations after successful connection
      try {
        this.providerRegistry.register(this.xProvider);
        await this.xProvider.fetchAndStoreConversations(user.id, accessToken);
      } catch (error) {
        this.logger.error("Failed to fetch and store X conversations", error);
      }

      return {
        success: true,
        username: me.data.username,
        externalAccountId: me.data.id,
      };
    } catch (error) {
      this.logger.error("Failed to verify X OAuth", error);
      throw new InternalServerErrorException("Failed to connect X account");
    }
  }

  async verifyMFA(email: string, token: string): Promise<AuthTokens> {
    email = email.toLowerCase();
    const user = await this.userRepo.findOne({ email });
    if (!user) throw new NotFoundException("User not found");

    if (!user.twoFactorSecret) {
      throw new BadRequestException("MFA not configured for this user");
    }

    const storedSecret = user.twoFactorSecret;
    const isEncrypted = this.isEncryptedSecret(storedSecret);
    const secret = isEncrypted
      ? this.decryptSecret(storedSecret)
      : storedSecret;
    const isValid = authenticator.check(token, secret);
    if (!isValid) {
      this.logger.warn(`Invalid MFA token for user ${user.id}`);
      throw new BadRequestException("Invalid MFA token");
    }

    if (!isEncrypted) {
      void this.upgradeLegacySecret(user, secret);
    }

    return this.createAuthTokens(user);
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    const secret = this.jwtConfig.refreshSecret || this.jwtConfig.secret;

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        refreshToken,
        {
          secret,
        },
      );

      const user = await this.userRepo.findOne({ id: payload.sub });
      if (!user) {
        throw new UnauthorizedException("Invalid refresh token");
      }

      const accessToken = await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
      });

      return { accessToken };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to refresh access token: ${reason}`);
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  private async getPaRole(): Promise<RoleEntity> {
    const role = await this.roleRepo.findOne({ name: "PA" });
    if (!role) throw new NotFoundException('Role "PA" not found.');
    return role;
  }

  private async createOrTouchUserAndIssueOtp(
    email: string,
  ): Promise<{ otp: string }> {
    const otp = this.generateOtp();
    const expiresAt = this.computeOtpExpiry();

    await this.userRepo.getEntityManager().transactional(async (em) => {
      const uRepo = em.getRepository(UserEntity);
      const oRepo = em.getRepository(UserOtpEntity);

      const user = await uRepo.findOne({ email });
      if (!user) {
        throw new BadRequestException("User not found");
      }

      await oRepo.nativeDelete({ user: user.id });

      const otpEntity = oRepo.create({
        user,
        code: otp,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      em.persist(otpEntity);
      await em.flush();
    });

    return { otp };
  }

  async connectEmail(
    userId: string,
    credentials: {
      email: string;
      imapPassword: string;
      smtpPassword: string;
      imapHost: string;
      imapPort: number;
      imapSecure: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
    },
  ): Promise<{ success: boolean }> {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException("User not found");

    const encryptedCredentials =
      this.utilsService.encryptEmailCredentials(credentials);

    await this.emailProvider.validateCredentials(encryptedCredentials);

    await this.persistEmailSession(
      user,
      credentials.email,
      encryptedCredentials,
    );
    await this.persistEmailConnectedAccount(user, credentials.email);

    this.logger.log(
      `Email account ${credentials.email} connected for user ${userId}`,
    );

    return { success: true };
  }

  async registerMFA(email: string) {
    email = email.toLowerCase();
    const user = await this.userRepo.findOne({ email });
    if (!user) throw new NotFoundException("User not found");

    try {
      const secret = authenticator.generateSecret();
      const serviceName = "Omni";
      const otpauth = authenticator.keyuri(user.email, serviceName, secret);
      const base64Url = await qrode.toDataURL(otpauth);

      user.twoFactorSecret = this.encryptSecret(secret);
      await this.userRepo.getEntityManager().persistAndFlush(user);

      return { base64Url, secret };
    } catch (error) {
      this.logger.error("Failed to register MFA", error);
      throw new InternalServerErrorException("Failed to register MFA");
    }
  }

  private async validateTelegramAuth(loginId: string): Promise<{
    user: UserEntity;
    cached: TelegramLoginCache;
    authPromises: TelegramAuthPromises;
  }> {
    const user = await this.userRepo.findOne({
      email: this.appConfig.superAdminEmail,
    });
    if (!user) throw new NotFoundException("User not found");

    const raw = await this.redis.get(this.buildTelegramLoginKey(loginId));
    if (!raw) {
      throw new BadRequestException("loginId expired or invalid");
    }

    let cached: TelegramLoginCache;
    try {
      cached = JSON.parse(raw) as TelegramLoginCache;
    } catch (error) {
      this.logger.error("Failed to parse Telegram login cache", error);
      await this.redis.del(this.buildTelegramLoginKey(loginId));
      throw new InternalServerErrorException(
        "Unable to process Telegram verification",
      );
    }

    if (cached.userId !== user.id) {
      throw new ForbiddenException(
        "User does not have permission to access this resource",
      );
    }

    const authPromises = this.pendingAuthPromises.get(loginId);
    if (!authPromises) {
      throw new BadRequestException(
        "No pending authentication found for this loginId. Please restart the connection process.",
      );
    }

    return { user, cached, authPromises };
  }

  private async pollTelegramAuthCompletion(
    client: any,
    userId: string,
  ): Promise<void> {
    const maxWaitTime = 30000;
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        await client.invoke({ _: "getMe" });
        this.logger.log(`Telegram login successful for user ${userId}`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    try {
      await client.invoke({ _: "getMe" });
    } catch {
      throw new Error(
        "Login verification failed - authentication may have failed",
      );
    }
  }

  private async persistSessionAndFetchData(
    user: UserEntity,
    sessionToken: string,
  ): Promise<void> {
    await Promise.allSettled([
      this.persistTelegramSession(user, sessionToken),
      this.persistTelegramConnectedAccount(user),
    ]);

    await this.telegramEventListener.setupListenerForUser(user.id);
    this.logger.log(`Setup event listener for user ${user.id} after login`);

    try {
      this.providerRegistry.register(this.telegramProvider);
      await this.telegramProvider.fetchAndStoreContacts(user.id, sessionToken);
      await this.telegramProvider.fetchAndStoreConversations(
        user.id,
        sessionToken,
      );
    } catch (error) {
      this.logger.error("Failed to fetch and store Telegram data", error);
    }
  }

  private async cleanupAuthState(loginId: string): Promise<void> {
    await this.redis.del(this.buildTelegramLoginKey(loginId));
    this.pendingAuthPromises.delete(loginId);
  }

  private buildTelegramLoginKey(loginId: string): string {
    return `telegram-login:${loginId}`;
  }

  private async persistTelegramSession(
    user: UserEntity,
    sessionToken: string,
  ): Promise<void> {
    const existing = await this.socialSessionRepo.findOne({
      user,
      platform: SocialMediaPlatform.Telegram,
    });

    const em = this.socialSessionRepo.getEntityManager();

    if (existing) {
      existing.sessionToken = sessionToken;
      em.persist(existing);
    } else {
      const entity = this.socialSessionRepo.create({
        user,
        platform: SocialMediaPlatform.Telegram,
        sessionToken: sessionToken,
      });
      em.persist(entity);
    }

    await em.flush();
  }

  private async persistTelegramConnectedAccount(
    user: UserEntity,
  ): Promise<void> {
    const existing = await this.connectedAccountsRepo.findOne({
      user,
      platform: SocialMediaPlatform.Telegram,
    });

    const em = this.connectedAccountsRepo.getEntityManager();

    if (existing) {
      existing.status = "active";
      existing.lastPolledAt = new Date();
      em.persist(existing);
    } else {
      const entity = this.connectedAccountsRepo.create({
        user,
        platform: SocialMediaPlatform.Telegram,
        status: "active",
        jobKey: `telegram-poll-${user.id}`,
        lastPolledAt: new Date(),
        pollingInterval: 60,
      });
      em.persist(entity);
    }

    await em.flush();
  }

  private async persistEmailSession(
    user: UserEntity,
    emailAddress: string,
    encryptedCredentials: string,
  ): Promise<void> {
    const existing = await this.socialSessionRepo.findOne({
      user,
      platform: SocialMediaPlatform.Email,
    });

    const em = this.socialSessionRepo.getEntityManager();

    if (existing) {
      existing.accessToken = encryptedCredentials;
      em.persist(existing);
    } else {
      const entity = this.socialSessionRepo.create({
        user,
        platform: SocialMediaPlatform.Email,
        accessToken: encryptedCredentials,
      });
      em.persist(entity);
    }

    await em.flush();
  }

  private async persistEmailConnectedAccount(
    user: UserEntity,
    emailAddress: string,
  ): Promise<void> {
    const existing = await this.connectedAccountsRepo.findOne({
      user,
      platform: SocialMediaPlatform.Email,
      externalAccountId: emailAddress,
    });

    const em = this.connectedAccountsRepo.getEntityManager();

    if (existing) {
      existing.status = "active";
      existing.lastPolledAt = new Date(0);
      em.persist(existing);
    } else {
      const entity = this.connectedAccountsRepo.create({
        user,
        platform: SocialMediaPlatform.Email,
        status: "active",
        jobKey: `email-poll-${user.id}-${emailAddress}`,
        lastPolledAt: new Date(0),
        pollingInterval: 60,
        externalAccountId: emailAddress,
      });
      em.persist(entity);
    }

    await em.flush();
  }

  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.mfaConfig.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString("base64"),
      encrypted.toString("base64"),
      authTag.toString("base64"),
    ].join(".");
  }

  private decryptSecret(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      this.logger.error("Malformed encrypted secret payload");
      throw new InternalServerErrorException("Failed to verify MFA token");
    }

    const iv = Buffer.from(parts[0]!, "base64");
    const data = Buffer.from(parts[1]!, "base64");
    const authTag = Buffer.from(parts[2]!, "base64");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.mfaConfig.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch (error) {
      this.logger.error("Failed to decrypt MFA secret", error);
      throw new InternalServerErrorException("Failed to verify MFA token");
    }
  }

  private isEncryptedSecret(secret: string): boolean {
    const parts = secret.split(".");
    return parts.length === 3 && parts.every((part) => part.length > 0);
  }

  private async upgradeLegacySecret(
    user: UserEntity,
    secret: string,
  ): Promise<void> {
    try {
      const encrypted = this.encryptSecret(secret);
      user.twoFactorSecret = encrypted;
      await this.userRepo.getEntityManager().persistAndFlush(user);
    } catch (error) {
      user.twoFactorSecret = secret;
      this.logger.error(
        `Failed to upgrade legacy MFA secret for user ${user.id}`,
        error,
      );
    }
  }

  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  private computeOtpExpiry(): Date {
    return new Date(Date.now() + 10 * 60 * 1000);
  }

  private async createAuthTokens(user: UserEntity): Promise<AuthTokens> {
    const payload = {
      sub: user.id,
      email: user.email,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.jwtConfig.refreshSecret || this.jwtConfig.secret,
        expiresIn: this.jwtConfig.refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private logTelegramFailure(scope: string, error: unknown) {
    const payload =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.logger.error(`${scope}: ${payload}`);
  }

  private stringifyTelegramError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isTransientTelegramFailure(message: string): boolean {
    return /timeout|ec?onn?refused|network|eai_again/i.test(message);
  }

  private mapTelegramError(error: unknown, fallback: string): Error {
    const message = this.stringifyTelegramError(error);
    if (this.isTransientTelegramFailure(message)) {
      return new ServiceUnavailableException(
        "Telegram is temporarily unavailable. Please try again later.",
      );
    }
    if (error instanceof HttpException) {
      return error;
    }
    if (error instanceof Error) {
      return new InternalServerErrorException(fallback);
    }
    return new InternalServerErrorException(fallback);
  }

  private buildXOAuthKey(state: string): string {
    return `x-oauth:${state}`;
  }

  private async persistXSession(
    user: UserEntity,
    accessToken: string,
    refreshToken?: string,
    expiresIn?: number,
  ): Promise<void> {
    const existing = await this.socialSessionRepo.findOne({
      user,
      platform: SocialMediaPlatform.X,
    });

    const em = this.socialSessionRepo.getEntityManager();
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : undefined;

    if (existing) {
      existing.accessToken = accessToken;
      existing.refreshToken = refreshToken;
      existing.expiresAt = expiresAt;
      em.persist(existing);
    } else {
      const entity = this.socialSessionRepo.create({
        user,
        platform: SocialMediaPlatform.X,
        accessToken,
        refreshToken,
        expiresAt,
      });
      em.persist(entity);
    }

    await em.flush();
  }

  private async persistXConnectedAccount(
    user: UserEntity,
    externalAccountId: string,
  ): Promise<void> {
    const existing = await this.connectedAccountsRepo.findOne({
      user,
      platform: SocialMediaPlatform.X,
    });

    const em = this.connectedAccountsRepo.getEntityManager();

    if (existing) {
      existing.status = "active";
      existing.externalAccountId = externalAccountId;
      existing.lastPolledAt = new Date();
      em.persist(existing);
    } else {
      const entity = this.connectedAccountsRepo.create({
        user,
        platform: SocialMediaPlatform.X,
        status: "active",
        externalAccountId,
        jobKey: `x-poll-${user.id}`,
        lastPolledAt: new Date(),
        pollingInterval: 60,
      });
      em.persist(entity);
    }

    await em.flush();
  }
}
