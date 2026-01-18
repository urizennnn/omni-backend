import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap, catchError } from "rxjs";
import { Request, Response } from "express";
import { ActivityLogsService } from "@app/modules/activity-logs/activity-logs.service";
import { UserEntity } from "@app/entities/user.entity";

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActivityLogInterceptor.name);

  constructor(private readonly activityLogsService: ActivityLogsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: UserEntity }>();
    const res = http.getResponse<Response>();

    const { method, originalUrl, url, ip, headers } = req;
    const path = originalUrl || url;

    if (this.shouldSkipLogging(path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.logActivity(req, res, path, method, ip);
        } catch (error) {
          this.logger.error("Failed to log activity", error);
        }
      }),
      catchError(async (error) => {
        try {
          await this.logActivity(req, res, path, method, ip, error.status);
        } catch (logError) {
          this.logger.error("Failed to log activity on error", logError);
        }
        throw error;
      }),
    );
  }

  private shouldSkipLogging(path: string): boolean {
    const skipPaths = [
      "/api/health",
      "/api-docs",
      "/api/docs",
      "/api/pusher",
    ];

    return skipPaths.some((skipPath) => path.startsWith(skipPath));
  }

  private async logActivity(
    req: Request & { user?: UserEntity },
    res: Response,
    path: string,
    method: string,
    ip: string | undefined,
    errorStatus?: number,
  ) {
    const user = req.user;
    const statusCode = errorStatus || res.statusCode;
    const ipAddress =
      (req.headers["x-forwarded-for"] as string) || ip || "unknown";

    const description = this.generateDescription(
      user,
      method,
      path,
      statusCode,
    );
    const action = this.generateAction(method, path);

    await this.activityLogsService.addLog({
      userId: user?.id,
      description,
      action,
      method,
      path,
      ipAddress,
      statusCode,
      metadata: {
        userAgent: req.headers["user-agent"],
      },
    });
  }

  private generateDescription(
    user: UserEntity | undefined,
    method: string,
    path: string,
    statusCode: number,
  ): string {
    const userName = user
      ? `${user.firstName} ${user.lastName}`
      : "Anonymous";
    const actionVerb = this.getActionVerb(method);
    const pathSegment = this.getPathSegment(path);

    return `${userName} ${actionVerb} ${pathSegment}`;
  }

  private getActionVerb(method: string): string {
    const verbMap: Record<string, string> = {
      GET: "viewed",
      POST: "created",
      PATCH: "updated",
      PUT: "updated",
      DELETE: "deleted",
    };

    return verbMap[method] || "accessed";
  }

  private getPathSegment(path: string): string {
    const cleanPath = path.replace("/api/", "").split("?")[0];
    return cleanPath || "resource";
  }

  private generateAction(method: string, path: string): string {
    const cleanPath = path.replace("/api/", "").split("?")[0];

    if (!cleanPath) return "api.access";

    const segments = cleanPath.split("/").filter(Boolean);

    if (segments.length === 0) return "api.access";

    const resource = segments[0];
    const actionMap: Record<string, string> = {
      GET: "fetch",
      POST: "create",
      PATCH: "update",
      PUT: "update",
      DELETE: "delete",
    };

    const action = actionMap[method] || "access";
    return `${resource}.${action}`;
  }
}
