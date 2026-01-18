import {
  createHttpClient,
  HttpClient,
  AuthHeaderType,
} from "@app/lib/http-client";
import { UsersResource } from "./resources/users";
import { DirectMessagesResource } from "./resources/direct-messages";
import { XRateLimiterService } from "../x-rate-limiter.service";

export class XApi {
  private readonly client: HttpClient;
  public readonly users: UsersResource;
  public readonly directMessages: DirectMessagesResource;

  constructor(
    accessToken: string,
    private readonly rateLimiter?: XRateLimiterService,
    private readonly userId?: string,
    baseURL = "https://api.x.com/2",
  ) {
    this.client = createHttpClient({
      baseURL,
      token: accessToken,
      headerType: AuthHeaderType.Bearer,
    });

    const rateLimitCallback = this.handleRateLimitHeaders.bind(this);
    this.users = new UsersResource(this.client, rateLimitCallback);
    this.directMessages = new DirectMessagesResource(
      this.client,
      rateLimitCallback,
    );
  }

  private async handleRateLimitHeaders(
    headers?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.rateLimiter || !this.userId || !headers) {
      return;
    }
  }

  async getBackoffMs(): Promise<number | null> {
    if (!this.rateLimiter || !this.userId) {
      return null;
    }
    return this.rateLimiter.getBackoffMs(this.userId);
  }

  getRateLimiter(): XRateLimiterService | undefined {
    return this.rateLimiter;
  }

  getUserId(): string | undefined {
    return this.userId;
  }
}

export * from "./types";
