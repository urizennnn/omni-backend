import { Inject, Injectable, Logger } from "@nestjs/common";
import type Pusher from "pusher";
import { PUSHER_CLIENT } from "./pusher.constants";

export interface TriggerOptions {
  socketId?: string;
  info?: string;
}

export interface TriggerBatchEvent {
  channel: string;
  name: string;
  data: unknown;
  socketId?: string;
  info?: string;
}

@Injectable()
export class PusherService {
  private readonly logger = new Logger(PusherService.name);
  constructor(@Inject(PUSHER_CLIENT) private readonly client: Pusher) {}

  async trigger(
    channel: string,
    event: string,
    data: unknown,
    options?: TriggerOptions,
  ): Promise<void> {
    await this.client.trigger(channel, event, data, options);
  }

  async triggerBatch(events: TriggerBatchEvent[]): Promise<void> {
    await this.client.triggerBatch(events);
  }

  async authenticate(
    socketId: string,
    channel: string,
    data?: { user_id: string; user_info?: object },
  ) {
    if (channel.startsWith("presence-")) {
      if (!data) {
        throw new Error("Presence channel requires user data");
      }
      return this.client.authorizeChannel(socketId, channel, data);
    }
    return this.client.authorizeChannel(socketId, channel);
  }

  async getChannels(options?: {
    prefixFilter?: string;
    attributes?: string[];
  }) {
    return this.client.get({ path: "/channels", params: options });
  }

  async getChannel(channel: string, options?: { attributes?: string[] }) {
    return this.client.get({
      path: `/channels/${channel}`,
      params: options,
    });
  }

  async getChannelUsers(channel: string) {
    return this.client.get({ path: `/channels/${channel}/users` });
  }

  getClient(): Pusher {
    return this.client;
  }
}
