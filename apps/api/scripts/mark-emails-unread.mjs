import { ImapFlow } from 'imapflow';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Simplified decryption (copied from encryption.ts)
function isEncrypted(value) {
  return value.startsWith('enc:');
}

function decrypt(encryptedValue) {
  if (!encryptedValue.startsWith('enc:')) {
    return encryptedValue;
  }

  const key = process.env.ENCRYPTION_KEY || 'default-key-change-me';
  const keyBuffer = Buffer.from(key.padEnd(32, '0').slice(0, 32));

  const parts = encryptedValue.slice(4).split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = Buffer.from(parts[1], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
}

async function markEmailsUnread() {
  console.log('🔍 Fetching email configuration...\n');

  // Get the organization's email config
  const org = await prisma.organization.findFirst({
    select: {
      name: true,
      settings: true,
    },
  });

  if (!org) {
    console.error('❌ No organization found');
    process.exit(1);
  }

  const settings = org.settings;
  const inboxConfig = settings?.emailInbox;

  if (!inboxConfig) {
    console.error('❌ No email configuration found in organization settings');
    process.exit(1);
  }

  console.log(`✅ Found email config for: ${org.name}`);
  console.log(`   Host: ${inboxConfig.host}`);
  console.log(`   User: ${inboxConfig.user}\n`);

  // Decrypt password if needed
  const password = inboxConfig.password
    ? isEncrypted(inboxConfig.password)
      ? decrypt(inboxConfig.password)
      : inboxConfig.password
    : '';

  if (!password) {
    console.error('❌ No email password configured');
    process.exit(1);
  }

  // Create IMAP client
  const client = new ImapFlow({
    host: inboxConfig.host,
    port: inboxConfig.port || 993,
    secure: inboxConfig.tls ?? true,
    auth: {
      user: inboxConfig.user || '',
      pass: password,
    },
    logger: false,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  });

  const emailsToFind = [
    { term: 'naksh', name: 'Naksh Jewels' },
    { term: 'getsetxplore', name: 'GetSetXplore' },
    { term: 'aarogya aadhar', name: 'Aarogya Aadhar' },
  ];

  try {
    console.log('🔌 Connecting to email server...\n');
    await client.connect();
    await client.mailboxOpen(inboxConfig.folder || 'INBOX');

    let totalMarked = 0;

    for (const { term, name } of emailsToFind) {
      console.log(`🔍 Searching for: ${name}`);

      // Search for all messages (seen and unseen) containing the term
      const searchResult = await client.search({
        or: [
          { subject: term },
          { from: term },
          { body: term },
        ],
      });

      const messages = Array.isArray(searchResult) ? searchResult : [];

      if (messages.length === 0) {
        console.log(`   ❌ No emails found\n`);
        continue;
      }

      console.log(`   Found ${messages.length} email(s)`);

      for (const uid of messages) {
        try {
          // Fetch the message to get details
          const message = await client.fetchOne(uid, {
            envelope: true,
            flags: true,
          });

          if (message && message.envelope) {
            const envelope = message.envelope;
            const flags = message.flags || new Set();
            const isRead = flags.has('\\Seen');

            console.log(`   📧 ${envelope.subject || 'No subject'}`);
            console.log(`      From: ${envelope.from?.[0]?.address || 'Unknown'}`);
            console.log(`      Status: ${isRead ? 'Read' : 'Unread'}`);

            if (isRead) {
              // Mark as unseen
              await client.messageFlagsRemove(uid, ['\\Seen']);
              console.log(`      ✅ Marked as UNREAD`);
              totalMarked++;
            } else {
              console.log(`      ℹ️  Already unread`);
            }
          }
        } catch (fetchError) {
          console.error(`   ❌ Error processing message ${uid}:`, fetchError);
        }
      }

      console.log();
    }

    await client.logout();

    console.log(`✨ Done! Marked ${totalMarked} email(s) as unread.`);
    console.log('These emails will be picked up on the next "Check Emails" run.\n');

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    try {
      await client.logout();
    } catch {
      // Ignore
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

markEmailsUnread();
