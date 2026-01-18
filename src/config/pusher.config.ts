import { registerAs } from "@nestjs/config";

type PusherConfig = {
  appId: string;
  pusherKey: string;
  pusherSecret: string;
  pusherCluster: string;
  webhookSecret: string;
};

export const PusherConfiguration = registerAs(
  "pusherConfig",
  (): PusherConfig => ({
    appId: process.env.PUSHER_APP_ID ?? "",
    pusherCluster: process.env.PUSHER_CLUSTER ?? "",
    pusherSecret: process.env.PUSHER_SECRET ?? "",
    pusherKey: process.env.PUSHER_KEY ?? "",
    webhookSecret: process.env.PUSHER_WEBHOOK_SECRET ?? "",
  }),
);
