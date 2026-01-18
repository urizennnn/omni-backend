import { TypedBody, TypedParam, TypedRoute } from "@nestia/core";
import { Controller, Req, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { Auth, SuccessMessage } from "@app/common/decorators";
import { UserService } from "./user.service";
import type { Request } from "express";
import { PlatformAccess } from "@app/entities/user.entity";

interface GetUsersQuery {
  limit?: number;
  offset?: number;
}

@Controller("user")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @TypedRoute.Get("whoami")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User details retrieved successfully")
  async whoami(@Req() req: Request & { user: { id: string } }) {
    const user = await this.userService.getUserById(req.user.id);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber ?? undefined,
      status: user.status,
      disabled: user.disabled,
      emailVerifiedAt: user.emailVerifiedAt,
      platformAccess: user.platformAccess,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @TypedRoute.Get("all")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Users retrieved successfully")
  async getAllUsers(@Query() query: GetUsersQuery) {
    const limit = query.limit ? Number(query.limit) : 10;
    const offset = query.offset ? Number(query.offset) : 0;
    const result = await this.userService.getAllUsers(limit, offset);

    return {
      users: result.users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber ?? undefined,
        status: user.status,
        disabled: user.disabled,
        emailVerifiedAt: user.emailVerifiedAt,
        platformAccess: user.platformAccess,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @TypedRoute.Post("disable/:targetUserId")
  @Auth("super-admin")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User disabled successfully")
  async disableUser(
    @TypedParam("targetUserId") targetUserId: string,
    @Req() req: Request & { user: { id: string } }
  ) {
    return this.userService.disableUser(targetUserId, req.user.id);
  }

  @TypedRoute.Post("enable/:targetUserId")
  @Auth("super-admin")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User enabled successfully")
  async enableUser(
    @TypedParam("targetUserId") targetUserId: string,
    @Req() req: Request & { user: { id: string } }
  ) {
    return this.userService.enableUser(targetUserId, req.user.id);
  }

  @TypedRoute.Get("permissions/:targetUserId")
  @Auth("super-admin")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User permissions retrieved successfully")
  async viewPermissions(@TypedParam("targetUserId") targetUserId: string) {
    return this.userService.viewPermissions(targetUserId);
  }
  @TypedRoute.Patch("permissions/:targetUserId")
  @Auth("super-admin")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User permissions updated successfully")
  async updateUserPlatformAccess(
    @TypedParam("targetUserId") targetUserId: string,
    @TypedBody() platformAccess: PlatformAccess[],
  ) {
    return this.userService.updateUserPlatformAccess(
      targetUserId,
      platformAccess,
    );
  }

  @TypedRoute.Delete(":targetUserId")
  @Auth("super-admin")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("User deleted successfully")
  async deleteUser(
    @TypedParam("targetUserId") targetUserId: string,
    @Req() req: Request & { user: { id: string } }
  ) {
    return this.userService.deleteUser(targetUserId, req.user.id);
  }
}
