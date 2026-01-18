import { TypedRoute } from "@nestia/core/lib";
import { Controller } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @TypedRoute.Get("live")
  live() {
    return { message: "live", data: { uptime: process.uptime() } };
  }

  @TypedRoute.Get("ready")
  ready() {
    return { message: "ready" };
  }
}
