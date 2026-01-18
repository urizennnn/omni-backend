import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import { STATUS_CODES } from "http";
import { Request, Response } from "express";
import { SUCCESS_MESSAGE_KEY } from "../decorators/success-message.decorator";
import { ok } from "../response";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseInterceptor.name);
  constructor(private readonly reflector: Reflector) {}

  intercept<T>(ctx: ExecutionContext, next: CallHandler): Observable<T> {
    try {
      const http = ctx.switchToHttp();
      const res = http.getResponse<Response>();
      const req = http.getRequest<Request>();
      const requestId = req?.id || (req?.headers?.["x-request-id"] as string);

      const explicitMessage =
        this.reflector.get<string>(SUCCESS_MESSAGE_KEY, ctx.getHandler()) ??
        this.reflector.get<string>(SUCCESS_MESSAGE_KEY, ctx.getClass());
      const url = req.originalUrl ?? req.url;
      const isSwagger: boolean = url.startsWith("/api-docs");
      const isPusherAuth: boolean = url.includes("/pusher/auth");

      return next.handle().pipe(
        map((payload) => {
          if (typeof payload === "string") {
            try {
              payload = JSON.parse(payload);
            } catch (err) {
              this.logger.warn(
                `Failed to parse payload as JSON: ${err.message}`,
              );
            }
          }
          if (isSwagger) return payload;
          if (isPusherAuth) return payload;
          if (typeof payload === "string") return payload;
          if (payload && typeof payload.pipe === "function") return payload;
          if (Buffer.isBuffer(payload)) return payload;

          const isObject = payload !== null && typeof payload === "object";
          if (!isObject) return payload;

          const status = res.statusCode ?? 200;
          const defaultMessage = STATUS_CODES[status] ?? "OK";
          const hasOwnEnvelope = "success" in payload && "data" in payload;

          if (hasOwnEnvelope) return payload;

          const data = payload;
          const message = explicitMessage ?? defaultMessage;

          return ok(message, data, { requestId });
        }),
      );
    } catch (err) {
      throw err;
    }
  }
}
