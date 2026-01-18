import { Controller, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { TypedRoute } from "@nestia/core";
import { ActivityLogsService } from "./activity-logs.service";
import { FetchLogsQuery } from "./dto/fetch-logs.dto";
import { Auth, SuccessMessage } from "@app/common/decorators";
import { User } from "@app/common/decorators/user.decorator";
import { UserEntity } from "@app/entities/user.entity";

@Controller("activity-logs")
@Auth()
export class ActivityLogsController {
  constructor(private readonly activityLogsService: ActivityLogsService) {}

  @TypedRoute.Get()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Activity logs retrieved successfully")
  async fetchLogs(
    @User() user: UserEntity,
    @Query() query: FetchLogsQuery,
  ) {
    return this.activityLogsService.fetchLogs(user, query);
  }
}
