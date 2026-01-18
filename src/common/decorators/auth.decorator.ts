import { UseGuards, applyDecorators, SetMetadata } from "@nestjs/common";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { Roles } from "@app/types";

export const ROLE_KEY = 'required_role';

export function Auth(role?: Roles) {
  const decorators = [UseGuards(JwtAuthGuard)];

  if (role) {
    decorators.push(SetMetadata(ROLE_KEY, role));
  }

  return applyDecorators(...decorators);
}
