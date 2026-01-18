import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { ActivityLogEntity } from "@app/entities/activity-log.entity";
import { UserEntity } from "@app/entities/user.entity";

interface AddLogParams {
  userId?: string;
  description: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  method?: string;
  path?: string;
  ipAddress?: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
}

interface FetchLogsQuery {
  startDate?: string;
  endDate?: string;
  action?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(
    @InjectRepository(ActivityLogEntity)
    private readonly activityLogRepository: EntityRepository<ActivityLogEntity>,
  ) {}

  async addLog(params: AddLogParams) {
    const log = this.activityLogRepository.create({
      user: params.userId ? ({ id: params.userId } as UserEntity) : undefined,
      description: params.description,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      method: params.method,
      path: params.path,
      ipAddress: params.ipAddress,
      statusCode: params.statusCode,
      metadata: params.metadata,
    });

    await this.activityLogRepository.getEntityManager().persistAndFlush(log);
  }

  async fetchLogs(user: UserEntity, query: FetchLogsQuery) {
    const isSuperAdmin = user.role.name === "super-admin";

    const filters: any = {};

    if (isSuperAdmin) {
      if (query.userId) {
        filters.user = { id: query.userId };
      }
    } else {
      filters.user = { id: user.id };
    }

    if (query.action) {
      filters.action = query.action;
    }

    if (query.startDate || query.endDate) {
      filters.createdAt = {};
      if (query.startDate) {
        filters.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filters.createdAt.$lte = new Date(query.endDate);
      }
    }

    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const [logs, total] = await this.activityLogRepository.findAndCount(
      filters,
      {
        limit,
        offset,
        orderBy: { createdAt: "DESC" },
        populate: ["user"],
      },
    );

    return {
      logs: logs.map((log) => ({
        id: log.id,
        userId: log.user?.id,
        description: log.description,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        method: log.method,
        path: log.path,
        statusCode: log.statusCode,
        ipAddress: log.ipAddress,
        metadata: log.metadata,
        createdAt: log.createdAt,
        updatedAt: log.updatedAt,
      })),
      total,
      limit,
      offset,
    };
  }
}
