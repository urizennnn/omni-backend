import { Controller, HttpCode, HttpStatus } from "@nestjs/common";
import { TypedRoute, TypedParam, TypedBody } from "@nestia/core";
import { MemoService } from "./memo.service";
import { CreateMemoDto } from "./dto/create-memo.dto";
import { UpdateMemoDto } from "./dto/update-memo.dto";
import { Auth, SuccessMessage } from "@app/common/decorators";
import { User } from "@app/common/decorators/user.decorator";

@Controller("memo")
@Auth()
export class MemoController {
  constructor(private readonly memoService: MemoService) {}

  @TypedRoute.Post(":conversationId")
  @HttpCode(HttpStatus.CREATED)
  @SuccessMessage("Memo created successfully")
  async createMemo(
    @TypedParam("conversationId") conversationId: string,
    @User("id") userId: string,
    @TypedBody() body: CreateMemoDto,
  ) {
    return this.memoService.createMemo(conversationId, userId, body);
  }

  @TypedRoute.Patch(":memoId")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Memo updated successfully")
  async updateMemo(
    @TypedParam("memoId") memoId: string,
    @User("id") userId: string,
    @TypedBody() body: UpdateMemoDto,
  ) {
    return this.memoService.updateMemo(memoId, userId, body);
  }

  @TypedRoute.Get(":conversationId")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Memos retrieved successfully")
  async getMemos(
    @TypedParam("conversationId") conversationId: string,
    @User("id") userId: string,
  ) {
    return this.memoService.getMemos(conversationId, userId);
  }

  @TypedRoute.Delete(":memoId")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Memo deleted successfully")
  async deleteMemo(
    @TypedParam("memoId") memoId: string,
    @User("id") userId: string,
  ) {
    return this.memoService.deleteMemo(memoId, userId);
  }
}
