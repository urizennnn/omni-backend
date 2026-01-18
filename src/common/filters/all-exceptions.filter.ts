import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { fail } from "../response";
import * as Sentry from "@sentry/nestjs";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.id || (request.headers["x-request-id"] as string);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "INTERNAL_ERROR";
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        message = res;
        code = exception.name;
      } else if (typeof res === "object" && res) {
        const maybe: Record<string, unknown> = res as Record<string, unknown>;
        message = (maybe.message as string) || exception.message;
        code = (maybe.code as string) || exception.name;
        const { message: _m, ...rest } = maybe;
        details = rest;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = exception.name || code;
    }

    const isPusherPath = request.path?.includes("/pusher") ||
                         request.path?.includes("/webhooks/pusher");
    const shouldReportToSentry =
      status >= 500 ||
      (isPusherPath && status >= 400);

    if (status >= 500) {
      this.logger.error(
        `500 Error: ${message}`,
        {
          code,
          details,
          path: request.path,
          method: request.method,
          requestId,
          stack: exception instanceof Error ? exception.stack : undefined,
        },
      );
    }

    if (shouldReportToSentry) {
      Sentry.captureException(exception, {
        contexts: {
          request: {
            method: request.method,
            url: request.url,
            path: request.path,
          },
        },
        tags: {
          statusCode: status,
          code,
          isPusherError: isPusherPath,
        },
      });
    }

    const payload = fail(
      message,
      { code, details, statusCode: status },
      { requestId },
    );
    response.status(status).json(payload);
  }
}
