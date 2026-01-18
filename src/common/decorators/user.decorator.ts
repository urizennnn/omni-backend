import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UserEntity } from "@app/entities/user.entity";

export const User = createParamDecorator(
  (data: keyof UserEntity | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as UserEntity;

    return data ? user?.[data] : user;
  },
);
