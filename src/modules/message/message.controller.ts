import { Body, Controller, Query, UseGuards } from "@nestjs/common";
import { MessageService } from "./message.service";
import { TypedRoute } from "@nestia/core/lib";
import { JwtAuthGuard } from "@app/common/guards/jwt-auth.guard";
import { User } from "@app/common/decorators/user.decorator";
import {
  FetchConversationsQuery,
  FetchAllConversationsQuery,
  FetchMessagesQuery,
  WipeEmailInboxBody,
} from "./types";

@Controller("messages")
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @TypedRoute.Get("/conversations")
  async fetchConversations(
    @User("id") userId: string,
    @Query() query: FetchConversationsQuery,
  ) {
    return this.messageService.fetchConversations(
      userId,
      query.platform,
      query.cursor,
      query.limit,
    );
  }

  @TypedRoute.Get("/conversations/all")
  async fetchAllConversations(
    @User("id") userId: string,
    @Query() query: FetchAllConversationsQuery,
  ) {
    return this.messageService.fetchAllConversationsPaginated(
      userId,
      query.cursor,
      query.limit,
    );
  }

  @TypedRoute.Get()
  async fetchMessages(
    @User("id") userId: string,
    @Query() query: FetchMessagesQuery,
  ) {
    return this.messageService.fetchMessagesInConversation(
      query.conversationId,
      userId,
      query.threadId,
      query.cursor,
      query.limit,
    );
  }

  @TypedRoute.Post("/email/cleanup")
  async wipeEmailInbox(
    @User("id") userId: string,
    @Body() body: WipeEmailInboxBody,
  ) {
    return this.messageService.wipeEmailInbox(userId, body);
  }
}
