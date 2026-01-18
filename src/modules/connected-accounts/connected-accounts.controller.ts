import { Controller, Param, Req } from "@nestjs/common";
import { TypedRoute } from "@nestia/core";
import { ConnectedAccountsService } from "./connected-accounts.service";
import { Auth } from "@app/common/decorators";
import type { Request } from "express";
import { SocialMediaPlatform } from "@app/types";

@Controller("connected-accounts")
export class ConnectedAccountsController {
  constructor(
    private readonly connectedAccountsService: ConnectedAccountsService,
  ) {}

  @TypedRoute.Patch("/:platform/deactivate")
  @Auth()
  async deactivatePlatform(
    @Param("platform") platform: SocialMediaPlatform,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.connectedAccountsService.deactivatePlatform(
      req.user.id,
      platform,
    );
  }
}
