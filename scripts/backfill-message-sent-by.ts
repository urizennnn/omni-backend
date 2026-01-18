#!/usr/bin/env ts-node

import { MikroORM } from "@mikro-orm/core";
import mikroOrmConfig from "../mikro-orm.config";
import { MessageEntity } from "../src/entities/messages.entity";
import { UserEntity } from "../src/entities/user.entity";
import { SocialMediaPlatform } from "../src/types";

type ArgValue = string | boolean | undefined;

const USAGE = `
Backfill message sentBy for outbound messages.

Usage:
  ts-node scripts/backfill-message-sent-by.ts --to-email <email> [options]
  ts-node scripts/backfill-message-sent-by.ts --to-user-id <id> [options]

Options:
  --from-email <email>            Update only messages currently assigned to this user
  --from-user-id <id>             Update only messages currently assigned to this user
  --platform <name|all>           Default: Email
  --account-id <id>               Limit to conversations with this accountId
  --conversation-id <id>          Limit to a specific conversation id
  --conversation-external-id <id> Limit to a specific conversation externalId
  --start <ISO date>              Filter by createdAt >= start
  --end <ISO date>                Filter by createdAt <= end
  --batch-size <number>           Default: 200
  --dry-run                       Only print the number of messages to update
  --help                          Show this help
`;

function parseArgs(argv: string[]): Record<string, ArgValue> {
  const args: Record<string, ArgValue> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
        i += 1;
      } else {
        args[key] = next;
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return args;
}

function parsePlatform(value?: string): SocialMediaPlatform | undefined {
  if (!value) return undefined;
  if (value.toLowerCase() === "all") return undefined;

  const match = Object.values(SocialMediaPlatform).find(
    (platform) => platform.toLowerCase() === value.toLowerCase(),
  );
  if (!match) {
    throw new Error(`Unknown platform: ${value}`);
  }
  return match;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

async function resolveUserId(
  em: MikroORM["em"],
  label: string,
  userId?: string,
  email?: string,
): Promise<string | null> {
  if (userId) {
    const user = await em.findOne(UserEntity, { id: userId });
    if (!user) {
      throw new Error(`No user found for ${label} id: ${userId}`);
    }
    return user.id;
  }

  if (email) {
    const normalized = email.trim().toLowerCase();
    const user = await em.findOne(UserEntity, { email: normalized });
    if (!user) {
      throw new Error(`No user found for ${label} email: ${email}`);
    }
    return user.id;
  }

  return null;
}

async function backfill() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE.trim());
    process.exit(0);
  }

  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em.fork();

  try {
    const toUserId = await resolveUserId(
      em,
      "target",
      args["to-user-id"] as string | undefined,
      args["to-email"] as string | undefined,
    );

    if (!toUserId) {
      throw new Error("Missing --to-email or --to-user-id");
    }

    const fromUserId = await resolveUserId(
      em,
      "source",
      args["from-user-id"] as string | undefined,
      args["from-email"] as string | undefined,
    );

    if (fromUserId && fromUserId === toUserId) {
      console.log("Source and target users are the same; nothing to update.");
      return;
    }

    const rawPlatform = args.platform as string | undefined;
    const platform = rawPlatform
      ? parsePlatform(rawPlatform)
      : SocialMediaPlatform.Email;
    const accountId = args["account-id"] as string | undefined;
    const conversationId = args["conversation-id"] as string | undefined;
    const conversationExternalId = args["conversation-external-id"] as
      | string
      | undefined;
    const start = parseDate(args.start as string | undefined);
    const end = parseDate(args.end as string | undefined);
    const batchSize = Number(args["batch-size"] ?? 200);
    const dryRun = Boolean(args["dry-run"]);

    const criteria: Record<string, any> = {
      direction: "outbound",
    };

    if (fromUserId) {
      criteria.sentBy = fromUserId;
    } else {
      criteria.sentBy = null;
    }

    if (start || end) {
      criteria.createdAt = {};
      if (start) criteria.createdAt.$gte = start;
      if (end) criteria.createdAt.$lte = end;
    }

    if (conversationId) {
      criteria.conversationId = conversationId;
    } else {
      const conversationCriteria: Record<string, any> = {};
      if (platform) conversationCriteria.platform = platform;
      if (accountId) conversationCriteria.accountId = accountId;
      if (conversationExternalId)
        conversationCriteria.externalId = conversationExternalId;

      if (Object.keys(conversationCriteria).length > 0) {
        criteria.conversationId = conversationCriteria;
      }
    }

    const count = await em.count(MessageEntity, criteria);
    console.log(`Found ${count} messages to update.`);

    if (dryRun || count === 0) {
      return;
    }

    let updated = 0;
    while (true) {
      const messages = await em.find(MessageEntity, criteria, {
        limit: batchSize,
      });
      if (messages.length === 0) break;

      const targetRef = em.getReference(UserEntity, toUserId);
      for (const message of messages) {
        message.sentBy = targetRef;
      }

      await em.flush();
      updated += messages.length;
      em.clear();
    }

    console.log(`Updated ${updated} messages.`);
  } catch (error) {
    console.error("Backfill failed:", error);
    throw error;
  } finally {
    await orm.close();
  }
}

backfill()
  .then(() => {
    console.log("Script completed successfully");
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
