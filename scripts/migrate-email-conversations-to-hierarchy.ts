#!/usr/bin/env ts-node

import { MikroORM } from "@mikro-orm/core";
import mikroOrmConfig from "../mikro-orm.config";
import { ConversationEntity } from "../src/entities/conversation.entity";
import { SocialMediaPlatform } from "../src/types";

async function migrateConversationsToHierarchy() {
  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em.fork();

  try {
    console.log("Starting email conversation hierarchy migration...");

    const emailConversations = await em.find(ConversationEntity, {
      platform: SocialMediaPlatform.Email,
      parentConversation: null,
      conversationType: null,
    });

    console.log(
      `Found ${emailConversations.length} email conversations to migrate`,
    );

    const domainMap = new Map<string, Map<string, ConversationEntity[]>>();

    for (const conv of emailConversations) {
      const platformData = conv.platformData as {
        participants?: string[];
      };
      let domain = "unknown";

      if (
        platformData?.participants &&
        platformData.participants.length > 0
      ) {
        const email = platformData.participants[0];
        const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
        domain = match ? match[1].toLowerCase() : "unknown";
      }

      const userKey = conv.user.id;
      if (!domainMap.has(userKey)) {
        domainMap.set(userKey, new Map());
      }

      const userDomains = domainMap.get(userKey)!;
      if (!userDomains.has(domain)) {
        userDomains.set(domain, []);
      }

      userDomains.get(domain)!.push(conv);
    }

    let totalParentsCreated = 0;
    let totalChildrenLinked = 0;

    for (const [userId, domains] of domainMap) {
      for (const [domain, children] of domains) {
        console.log(
          `Processing domain ${domain} for user ${userId} with ${children.length} conversations`,
        );

        const parent = em.create(ConversationEntity, {
          externalId: `domain:${domain}:${children[0].accountId}`,
          platform: SocialMediaPlatform.Email,
          accountId: children[0].accountId,
          name: domain,
          user: userId,
          unreadCount: children.reduce((sum, c) => sum + c.unreadCount, 0),
          state: "open",
          conversationType: "parent",
          domain,
          platformData: {
            isDomainParent: true,
            migratedAt: new Date().toISOString(),
            childCount: children.length,
          },
        });

        await em.persistAndFlush(parent);
        totalParentsCreated++;
        console.log(
          `Created parent conversation for domain ${domain} (${children.length} children)`,
        );

        for (const child of children) {
          child.parentConversation = parent;
          child.conversationType = "child";
          child.domain = domain;
          child.platformData = {
            ...child.platformData,
            domain,
          };
        }

        await em.flush();
        totalChildrenLinked += children.length;
        console.log(`Linked ${children.length} children to parent ${domain}`);
      }
    }

    console.log(
      `\n✅ Migration complete!\nCreated ${totalParentsCreated} parent conversations\nLinked ${totalChildrenLinked} child conversations`,
    );
  } catch (error) {
    console.error("Error during migration:", error);
    throw error;
  } finally {
    await orm.close();
  }
}

migrateConversationsToHierarchy()
  .then(() => {
    console.log("Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
