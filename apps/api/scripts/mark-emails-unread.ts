import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import prisma from '../src/utils/prisma.js';
import { decrypt, isEncrypted } from '../src/utils/encryption.js';

async function markEmailsUnread() {
  console.log('🔍 Fetching email configuration...\n');

  // Get the organization's email config
  const org = await prisma.organization.findFirst({
    select: {
      id: true,
      name: true,
      emailHost: true,
      emailPort: true,
      emailUser: true,
      emailPassword: true,
      emailTls: true,
      emailFolder: true,
    },
  });

  if (!org || !org.emailHost) {
    console.error('❌ No email configuration found');
    process.exit(1);
  }

  console.log(`✅ Found email config for: ${org.name}`);
  console.log(`   Host: ${org.emailHost}`);
  console.log(`   User: ${org.emailUser}\n`);

  // Decrypt password if needed
  const password = org.emailPassword
    ? isEncrypted(org.emailPassword)
      ? decrypt(org.emailPassword)
      : org.emailPassword
    : '';

  if (!password) {
    console.error('❌ No email password configured');
    process.exit(1);
  }

  // Create IMAP client
  const client = new ImapFlow({
    host: org.emailHost,
    port: org.emailPort || 993,
    secure: org.emailTls ?? true,
    auth: {
      user: org.emailUser || '',
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
    await client.mailboxOpen(org.emailFolder || 'INBOX');

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
            source: true
          });

          if (message && typeof message === 'object' && 'envelope' in message) {
            const envelope = message.envelope as any;
            const flags = (message.flags || []) as string[];
            const isRead = flags.includes('\\Seen');

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
