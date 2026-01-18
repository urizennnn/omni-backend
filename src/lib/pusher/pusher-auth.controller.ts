import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  UnauthorizedException,
  Headers,
  Query,
  Inject,
} from "@nestjs/common";
import { PusherService } from "./pusher.service";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { UserEntity } from "@app/entities/user.entity";
import { JwtConfiguration } from "@app/config/jwt.config";
import { ConfigType } from "@nestjs/config";
import { CacheService } from "@app/common/cache/cache.service";

interface AuthRequest {
  socket_id: string;
  channel_name: string;
}

@Controller("pusher")
export class PusherAuthController {
  private readonly logger = new Logger(PusherAuthController.name);

  constructor(
    private readonly pusherService: PusherService,
    private readonly jwtService: JwtService,
    @Inject(JwtConfiguration.KEY)
    private readonly jwtConfig: ConfigType<typeof JwtConfiguration>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    private readonly cacheService: CacheService,
  ) {}

  @HttpCode(200)
  @Post("auth")
  async authenticate(
    @Body() body: AuthRequest,
    @Headers("X-Pusher-Auth") authHeader?: string,
    @Query("token") tokenQuery?: string,
  ) {
    this.logger.log("Received Pusher authentication request");
    try {
      const { socket_id, channel_name } = body;
      this.logger.log(
        `Authenticating socket '${socket_id}' for channel '${channel_name}' `,
      );

      const token = this.extractToken(authHeader, tokenQuery);

      if (!token) {
        this.logger.error("No authentication token provided");
        throw new UnauthorizedException("Missing authentication token");
      }

      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string }>(
          token,
          {
            secret: this.jwtConfig.secret,
          },
        );

        const user = await this.userRepo.findOne({ id: payload.sub });
        if (!user) {
          this.logger.error(`User not found for token: ${payload.sub}`);
          throw new UnauthorizedException("User not found");
        }

        this.logger.log(
          `User ${user.id} authenticated for channel ${channel_name}`,
        );

        await this.cacheService.cachePusherSocketUser(socket_id, user.id);

        const result = await this.pusherService.authenticate(
          socket_id,
          channel_name,
        );
        this.logger.log(
          `Private channel authentication successful (no JWT verification)`,
        );
        return result;
      } catch (error) {
        this.logger.error(
          `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new UnauthorizedException("Invalid authentication token");
      }
    } catch (error) {
      this.logger.error("Unexpected error during authentication");
      this.logger.error(error);
    }
  }

  private extractToken(
    authHeader?: string,
    tokenQuery?: string,
  ): string | null {
    if (authHeader) {
      const [scheme, token] = authHeader.split(" ");
      if (scheme === "Bearer" && token) {
        return token;
      }
    }

    if (tokenQuery) {
      return tokenQuery;
    }

    return null;
  }
}
