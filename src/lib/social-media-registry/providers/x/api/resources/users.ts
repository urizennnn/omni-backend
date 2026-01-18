import { HttpClient } from "@app/lib/http-client";
import { XUserResponse } from "../types";

export class UsersResource {
  constructor(
    private readonly client: HttpClient,
    private readonly onRateLimitHeaders?: (
      headers?: Record<string, unknown>,
    ) => void | Promise<void>,
  ) {}

  async me(): Promise<XUserResponse> {
    const result = await this.client.get<XUserResponse>("/users/me");

    if (this.onRateLimitHeaders && result.headers) {
      await this.onRateLimitHeaders(result.headers);
    }

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to fetch user");
    }
    return result.data;
  }

  async getById(userId: string): Promise<XUserResponse> {
    const result = await this.client.get<XUserResponse>(`/users/${userId}`);

    if (this.onRateLimitHeaders && result.headers) {
      await this.onRateLimitHeaders(result.headers);
    }

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to fetch user");
    }
    return result.data;
  }

  async getByUsername(username: string): Promise<XUserResponse> {
    const result = await this.client.get<XUserResponse>(
      `/users/by/username/${username}`,
    );

    if (this.onRateLimitHeaders && result.headers) {
      await this.onRateLimitHeaders(result.headers);
    }

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to fetch user");
    }
    return result.data;
  }
}
