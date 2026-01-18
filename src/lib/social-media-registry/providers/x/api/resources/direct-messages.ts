import { HttpClient } from "@app/lib/http-client";
import {
  XDmEventsResponse,
  XListDmEventsParams,
  XSendDmParams,
  XSendDmResponse,
  XCreateDmConversationParams,
} from "../types";
import { Logger } from "@nestjs/common";

export class DirectMessagesResource {
  private readonly logger = new Logger(DirectMessagesResource.name);
  constructor(
    private readonly client: HttpClient,
    private readonly onRateLimitHeaders?: (
      headers?: Record<string, unknown>,
    ) => void | Promise<void>,
  ) {}

  async listEvents(params?: XListDmEventsParams): Promise<XDmEventsResponse> {
    const queryParams: Record<string, string | number> = {
      max_results: params?.max_results ?? 50,
      "dm_event.fields":
        "id,text,event_type,created_at,sender_id,participant_ids",
      expansions: "sender_id,participant_ids",
      "user.fields": "id,name,username",
    };

    if (params?.since_id) {
      queryParams.since_id = params.since_id;
    }
    if (params?.until_id) {
      queryParams.until_id = params.until_id;
    }
    if (params?.pagination_token) {
      queryParams.pagination_token = params.pagination_token;
    }
    if (params?.event_types) {
      queryParams.event_types = params.event_types;
    }
    if (params?.dm_conversation_id) {
      queryParams.dm_conversation_id = params.dm_conversation_id;
    }

    try {
      const result = await this.client.get<XDmEventsResponse>("/dm_events", {
        params: queryParams,
      });

      if (this.onRateLimitHeaders && result.headers) {
        await this.onRateLimitHeaders(result.headers);
      }

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to list DM events");
      }
      return result.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("429")) {
        this.logger.warn("Received 429 rate limit response for listEvents");
      }
      throw error;
    }
  }

  async sendToParticipant(
    participantId: string,
    message: XSendDmParams,
  ): Promise<XSendDmResponse> {
    try {
      const result = await this.client.post<XSendDmResponse>(
        `/dm_conversations/with/${participantId}/messages`,
        message,
      );

      if (this.onRateLimitHeaders && result.headers) {
        await this.onRateLimitHeaders(result.headers);
      }

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to send DM to participant");
      }
      return result.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("429")) {
        this.logger.warn(
          "Received 429 rate limit response for sendToParticipant",
        );
      }
      throw error;
    }
  }

  async sendToConversation(
    conversationId: string,
    message: XSendDmParams,
  ): Promise<XSendDmResponse> {
    const result = await this.client.post<XSendDmResponse>(
      `/dm_conversations/${conversationId}/messages`,
      message,
    );

    if (this.onRateLimitHeaders && result.headers) {
      await this.onRateLimitHeaders(result.headers);
    }

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to send DM to conversation");
    }
    return result.data;
  }

  async createConversation(
    params: XCreateDmConversationParams,
  ): Promise<XSendDmResponse> {
    const result = await this.client.post<XSendDmResponse>(
      "/dm_conversations",
      params,
    );

    if (this.onRateLimitHeaders && result.headers) {
      await this.onRateLimitHeaders(result.headers);
    }

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to create conversation");
    }
    return result.data;
  }
}
