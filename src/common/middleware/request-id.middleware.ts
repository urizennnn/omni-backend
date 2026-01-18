import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

export function requestIdMiddleware(
  req: Request & { id?: string },
  res: Response,
  next: NextFunction,
) {
  const incoming = (req.headers["x-request-id"] ||
    req.headers["x-correlation-id"]) as string | undefined;
  const id = incoming || randomUUID();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
}
