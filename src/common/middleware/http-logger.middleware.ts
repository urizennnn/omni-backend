import { Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

export function httpLoggerMiddleware(
  req: Request & { id?: string },
  res: Response,
  next: NextFunction,
): void {
  const logger = new Logger("HTTP");
  const { method, originalUrl, ip } = req;
  const userAgent = req.get("user-agent") || "";
  const requestId = req.id || req.headers["x-request-id"];

  const startTime = Date.now();

  logger.log(
    `→ ${method} ${originalUrl} - ${ip} - ${userAgent} [${requestId}]`,
  );

  const originalEnd = res.end;
  const originalJson = res.json;

  res.end = function (
    chunk?: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): Response {
    const responseTime = Date.now() - startTime;
    const { statusCode } = res;
    const contentLength = res.get("content-length") || "-";

    const logMessage = `← ${method} ${originalUrl} ${statusCode} ${contentLength}b - ${responseTime}ms [${requestId}]`;

    if (statusCode >= 500) {
      logger.error(logMessage);
    } else if (statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.log(logMessage);
    }

    return originalEnd.call(this, chunk, encoding, callback);
  };

  res.json = function (body?: unknown): Response {
    const responseTime = Date.now() - startTime;
    const { statusCode } = res;
    const contentLength = JSON.stringify(body).length;

    const logMessage = `← ${method} ${originalUrl} ${statusCode} ${contentLength}b - ${responseTime}ms [${requestId}]`;

    if (statusCode >= 500) {
      logger.error(logMessage);
    } else if (statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.log(logMessage);
    }

    return originalJson.call(this, body);
  };

  next();
}
