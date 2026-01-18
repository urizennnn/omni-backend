#!/usr/bin/env node

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    host: null,
    user: null,
    password: null,
    port: 993,
    secure: true,
    mailbox: 'INBOX',
    limit: 10,
    search: 'ALL',
    rejectUnauthorized: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-h':
      case '--host':
        options.host = nextArg;
        i++;
        break;
      case '-u':
      case '--user':
        options.user = nextArg;
        i++;
        break;
      case '-p':
      case '--password':
        options.password = nextArg;
        i++;
        break;
      case '--port':
        options.port = parseInt(nextArg);
        i++;
        break;
      case '--no-secure':
        options.secure = false;
        break;
      case '--mailbox':
        options.mailbox = nextArg;
        i++;
        break;
      case '--limit':
        options.limit = parseInt(nextArg);
        i++;
        break;
      case '--search':
        options.search = nextArg;
        i++;
        break;
      case '--no-reject-unauthorized':
        options.rejectUnauthorized = false;
        break;
      case '--help':
        console.log(`
Usage: node debug-email-connection.js [options]

Required options:
  -h, --host <host>              IMAP host (e.g., imap.gmail.com)
  -u, --user <email>             Email address
  -p, --password <password>      Email password or app password

Optional:
  --port <port>                  IMAP port (default: 993)
  --no-secure                    Disable TLS/SSL
  --mailbox <name>               Mailbox to open (default: INBOX)
  --limit <count>                Maximum messages to fetch (default: 10)
  --search <criteria>            Search criteria (default: ALL)
  --no-reject-unauthorized       Disable TLS certificate validation (insecure)
  --help                         Show this help message

Examples:
  node debug-email-connection.js -h imap.gmail.com -u user@gmail.com -p "app-password"
  node debug-email-connection.js -h imap.gmail.com -u user@gmail.com -p "password" --limit 5
        `);
        process.exit(0);
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          console.error('Use --help for usage information');
          process.exit(1);
        }
    }
  }

  if (!options.host || !options.user || !options.password) {
    console.error('Error: --host, --user, and --password are required');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  return options;
}

const options = parseArgs();

async function debugEmailConnection() {
  console.log('='.repeat(80));
  console.log('EMAIL DEBUG CONNECTION SCRIPT');
  console.log('='.repeat(80));
  console.log();

  console.log('[CONFIG] Connection Settings:');
  console.log(`  Host:     ${options.host}`);
  console.log(`  Port:     ${options.port}`);
  console.log(`  User:     ${options.user}`);
  console.log(`  Password: ${'*'.repeat(options.password.length)}`);
  console.log(`  Secure:   ${options.secure}`);
  console.log(`  Mailbox:  ${options.mailbox}`);
  console.log(`  Limit:    ${options.limit}`);
  console.log(`  Search:   ${options.search}`);
  console.log();

  let client;

  try {
    console.log('[STEP 1] Creating IMAP client...');

    client = new ImapFlow({
      host: options.host,
      port: parseInt(options.port),
      secure: options.secure,
      auth: {
        user: options.user,
        pass: options.password,
      },
      logger: {
        debug: (obj) => console.log('[IMAP DEBUG]', obj),
        info: (obj) => console.log('[IMAP INFO]', obj),
        warn: (obj) => console.warn('[IMAP WARN]', obj),
        error: (obj) => console.error('[IMAP ERROR]', obj),
      },
      tls: {
        rejectUnauthorized: options.rejectUnauthorized,
      },
    });

    console.log('[STEP 2] Connecting to IMAP server...');
    await client.connect();
    console.log('[SUCCESS] Connected to IMAP server');
    console.log();

    console.log('[STEP 3] Opening mailbox:', options.mailbox);
    const mailbox = await client.mailboxOpen(options.mailbox);
    console.log('[SUCCESS] Mailbox opened');
    console.log('[MAILBOX INFO]', mailbox);

    if (!mailbox.exists || mailbox.exists === 0) {
      console.log('[INFO] Mailbox is empty, no messages to fetch');
      return;
    }

    console.log(`[STEP 4] Fetching messages (search: ${options.search}, limit: ${options.limit})...`);

    const searchCriteria = options.search === 'ALL' ? { all: true } : options.search;

    let fetchedCount = 0;
    const limit = parseInt(options.limit);

    for await (const msg of client.fetch(searchCriteria, {
      uid: true,
      flags: true,
      bodyStructure: true,
      envelope: true,
      internalDate: true,
      size: true,
      source: true,
    }, {
      uid: true,
    })) {
      if (fetchedCount >= limit) {
        console.log(`[INFO] Reached limit of ${limit} messages`);
        break;
      }

      fetchedCount++;

      console.log();
      console.log('─'.repeat(80));
      console.log(`[MESSAGE ${fetchedCount}] UID: ${msg.uid}`);
      console.log('─'.repeat(80));

      console.log('[RAW MESSAGE DATA]');
      console.log('  UID:          ', msg.uid);
      console.log('  Flags:        ', msg.flags);
      console.log('  Size:         ', msg.size, 'bytes');
      console.log('  Internal Date:', msg.internalDate);

      if (msg.envelope) {
        console.log('[ENVELOPE]');
        console.log('  From:    ', msg.envelope.from?.[0]?.address || 'N/A');
        console.log('  To:      ', msg.envelope.to?.[0]?.address || 'N/A');
        console.log('  Subject: ', msg.envelope.subject || '(no subject)');
        console.log('  Date:    ', msg.envelope.date);
        console.log('  Message-ID:', msg.envelope.messageId);
      }

      if (msg.bodyStructure) {
        console.log('[BODY STRUCTURE]', JSON.stringify(msg.bodyStructure, null, 2));
      }

      if (msg.source) {
        console.log();
        console.log('[STEP] Parsing message with mailparser...');

        try {
          const parsed = await simpleParser(msg.source);

          console.log('[PARSED MESSAGE]');
          console.log('  From:         ', parsed.from?.text || 'N/A');
          console.log('  To:           ', parsed.to?.text || 'N/A');
          console.log('  Subject:      ', parsed.subject || '(no subject)');
          console.log('  Date:         ', parsed.date);
          console.log('  Message-ID:   ', parsed.messageId);
          console.log('  In-Reply-To:  ', parsed.inReplyTo);
          console.log('  References:   ', parsed.references);
          console.log('  Text Length:  ', parsed.text?.length || 0, 'chars');
          console.log('  HTML Length:  ', parsed.html ? (typeof parsed.html === 'string' ? parsed.html.length : 'present') : 0, 'chars');
          console.log('  Attachments:  ', parsed.attachments?.length || 0);

          if (parsed.attachments && parsed.attachments.length > 0) {
            console.log('[ATTACHMENTS]');
            parsed.attachments.forEach((att, idx) => {
              console.log(`  [${idx + 1}] ${att.filename || 'unnamed'}`);
              console.log(`      Type: ${att.contentType}`);
              console.log(`      Size: ${att.size} bytes`);
            });
          }

          console.log();
          console.log('[TEXT CONTENT] (first 200 chars)');
          console.log(parsed.text?.substring(0, 200) || '(no text content)');
          if (parsed.text && parsed.text.length > 200) {
            console.log('... (truncated)');
          }
        } catch (parseError) {
          console.error('[ERROR] Failed to parse message:', parseError.message);
        }
      } else {
        console.log('[WARNING] No source available for this message');
      }
    }

    console.log();
    console.log('='.repeat(80));
    console.log(`[COMPLETE] Successfully fetched ${fetchedCount} message(s)`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error();
    console.error('✗'.repeat(80));
    console.error('[FATAL ERROR]');
    console.error('✗'.repeat(80));
    console.error('Error Name:   ', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Code:   ', error.code);
    console.error();
    console.error('[STACK TRACE]');
    console.error(error.stack);
    console.error('✗'.repeat(80));
    process.exit(1);
  } finally {
    if (client) {
      try {
        console.log();
        console.log('[CLEANUP] Closing IMAP connection...');
        await client.logout();
        console.log('[SUCCESS] Connection closed gracefully');
      } catch (logoutError) {
        console.error('[ERROR] Failed to logout:', logoutError.message);
      }
    }
  }
}

debugEmailConnection().catch((error) => {
  console.error('[UNCAUGHT ERROR]', error);
  process.exit(1);
});
