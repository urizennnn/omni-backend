import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { MemoEntity } from "@app/entities/memo.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { UserEntity } from "@app/entities/user.entity";
import { CreateMemoDto } from "./dto/create-memo.dto";
import { UpdateMemoDto } from "./dto/update-memo.dto";

@Injectable()
export class MemoService {
  private readonly logger = new Logger(MemoService.name);

  constructor(
    @InjectRepository(MemoEntity)
    private readonly memoRepository: EntityRepository<MemoEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: EntityRepository<ConversationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: EntityRepository<UserEntity>,
  ) {}

  async createMemo(
    conversationId: string,
    userId: string,
    dto: CreateMemoDto,
  ) {
    const conversation = await this.conversationRepository.findOne({
      id: conversationId,
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    await this.checkPlatformAccess(userId, conversation);

    const memo = this.memoRepository.create({
      conversation,
      content: dto.content,
    });
    await this.memoRepository.getEntityManager().persistAndFlush(memo);
    this.logger.log(`Created memo for conversation ${conversationId}`);

    return {
      id: memo.id,
      content: memo.content,
      conversationId: conversation.id,
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    };
  }

  async updateMemo(memoId: string, userId: string, dto: UpdateMemoDto) {
    const memo = await this.memoRepository.findOne(
      { id: memoId },
      { populate: ["conversation"] },
    );

    if (!memo) {
      throw new NotFoundException("Memo not found");
    }

    await this.checkPlatformAccess(userId, memo.conversation);

    memo.content = dto.content;
    await this.memoRepository.getEntityManager().persistAndFlush(memo);

    this.logger.log(`Updated memo ${memoId}`);

    return {
      id: memo.id,
      content: memo.content,
      conversationId: memo.conversation.id,
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    };
  }

  async getMemos(conversationId: string, userId: string) {
    const conversation = await this.conversationRepository.findOne(
      { id: conversationId },
      { populate: ["memos"] },
    );

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    await this.checkPlatformAccess(userId, conversation);

    const memos = conversation.memos.getItems();

    return memos.map((memo) => ({
      id: memo.id,
      content: memo.content,
      conversationId: conversation.id,
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    }));
  }

  async deleteMemo(memoId: string, userId: string) {
    const memo = await this.memoRepository.findOne(
      { id: memoId },
      { populate: ["conversation"] },
    );

    if (!memo) {
      throw new NotFoundException("Memo not found");
    }

    await this.checkPlatformAccess(userId, memo.conversation);

    await this.memoRepository.getEntityManager().removeAndFlush(memo);
    this.logger.log(`Deleted memo ${memoId}`);
  }

  private async checkPlatformAccess(
    userId: string,
    conversation: ConversationEntity,
  ) {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ["role"] },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isSuperAdmin = user.role.name === "super-admin";

    if (isSuperAdmin) {
      return;
    }

    const platformAccess = user.platformAccess?.find(
      (access) => access.platform === conversation.platform,
    );

    if (!platformAccess || !platformAccess.viewMessages) {
      throw new ForbiddenException(
        `User does not have permission to view messages on ${conversation.platform}`,
      );
    }
  }
}
