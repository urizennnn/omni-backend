import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as crypto from "crypto";
import { ConfigType } from "@nestjs/config";
import { PusherConfiguration } from "@app/config/pusher.config";
import {
  PusherReadMessageEvent,
  PusherSendMessageEvent,
  PusherWebhookPayload,
} from "./types";
import { QueueName, JobName } from "@app/lib/queue/queue.constants";
import {
  PusherSendMessageJobData,
  PusherReadMessageJobData
} from "@app/lib/queue/pusher-webhook.processor";

@Controller("webhooks/pusher")
export class PusherWebhookController {
  constructor(
    @InjectQueue(QueueName.PusherWebhooks)
    private readonly webhooksQueue: Queue<PusherSendMessageJobData | PusherReadMessageJobData>,
    @Inject(PusherConfiguration.KEY)
    private readonly pusherConfig: ConfigType<typeof PusherConfiguration>,
  ) {}

  @Post("messages")
  @HttpCode(200)
  async handleWebhook(
    @Body() payload: PusherWebhookPayload,
    @Headers("x-pusher-key") pusherKey: string,
    @Headers("x-pusher-signature") pusherSignature: string,
  ): Promise<{ success: boolean }> {
    const webhookSecret = this.pusherConfig.webhookSecret;

    if (webhookSecret && webhookSecret !== "") {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(payload))
        .digest("hex");

      if (pusherSignature !== expectedSignature) {
        throw new UnauthorizedException("Invalid signature");
      }
    }

    for (const event of payload.events) {
      if (
        event.name === "client_event" &&
        event.event === "client-send-message"
      ) {
        try {
          const data: PusherSendMessageEvent = JSON.parse(event.data);
          console.log("Received Pusher send message event:", data);

          await this.webhooksQueue.add(
            JobName.ProcessPusherSendMessage,
            {
              data,
              channel: event.channel,
              socketId: event.socket_id,
            },
            {
              jobId: `webhook-send-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              removeOnComplete: true,
              removeOnFail: false,
              attempts: 3,
              backoff: {
                type: "exponential",
                delay: 5000,
              },
            }
          );
        } catch (error) {
          console.error("Failed to enqueue Pusher webhook event:", error);
        }
      }
      if (
        event.name === "client_event" &&
        event.event === "client-read-message"
      ) {
        try {
          const data: PusherReadMessageEvent = JSON.parse(event.data);

          await this.webhooksQueue.add(
            JobName.ProcessPusherReadMessage,
            {
              data,
              channel: event.channel,
              socketId: event.socket_id,
            },
            {
              jobId: `webhook-read-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              removeOnComplete: true,
              removeOnFail: false,
              attempts: 3,
              backoff: {
                type: "exponential",
                delay: 5000,
              },
            }
          );
        } catch (error) {
          console.error("Failed to enqueue Pusher webhook event:", error);
        }
      }
    }
    return { success: true };
  }
}
