import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import type { Request } from "express";
import { UserEntity } from "@app/entities/user.entity";
import { JwtConfiguration } from "@app/config/jwt.config";
import { ConfigType } from "@nestjs/config";
import { Roles } from "@app/types";
import { ROLE_KEY } from "../decorators/auth.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  constructor(
    private readonly jwtService: JwtService,
    @Inject(JwtConfiguration.KEY)
    private readonly jwtConfig: ConfigType<typeof JwtConfiguration>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: UserEntity }>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Missing authorization token");
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        {
          secret: this.jwtConfig.secret,
        },
      );

      const user = await this.userRepo.findOne(
        { id: payload.sub },
        { populate: ['role'] }
      );
      if (!user) {
        throw new UnauthorizedException("User not found for token");
      }

      if (user.status === "disabled") {
        throw new ForbiddenException("User account is disabled");
      }
      if (user.status === "inactive") {
        throw new ForbiddenException("User account is inactive");
      }
      if (user.status === "pending") {
        throw new ForbiddenException("User account is pending activation");
      }

      request.user = user;

      const requiredRole = this.reflector.get<Roles | undefined>(
        ROLE_KEY,
        context.getHandler()
      );

      if (requiredRole && user.role.name !== requiredRole) {
        throw new ForbiddenException(
          "User does not have permission to access this resource"
        );
      }

      return true;
    } catch (error) {
      this.logger.error("JWT verification failed", error);
      throw new UnauthorizedException("Invalid authorization token");
    }
  }

  private extractTokenFromHeader(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;

    return token;
  }
}
