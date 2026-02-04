import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteEmails() {
  console.log('🔍 Searching for emails to delete from PostgreSQL...\n');

  const emailsToFind = [
    { term: 'naksh', name: 'Naksh Jewels' },
    { term: 'getsetxplore', name: 'GetSetXplore' },
    { term: 'aarogya', name: 'Aarogya Aadhar' },
  ];

  let totalDeleted = 0;

  for (const { term, name } of emailsToFind) {
    console.log(`🔍 Searching for: ${name}`);

    // Find emails matching the term in subject, body, or from
    const emails = await prisma.email.findMany({
      where: {
        OR: [
          { subject: { contains: term, mode: 'insensitive' } },
          { from: { contains: term, mode: 'insensitive' } },
          { body: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        subject: true,
        from: true,
        receivedAt: true,
      },
    });

    if (emails.length === 0) {
      console.log(`   ❌ No emails found\n`);
      continue;
    }

    console.log(`   Found ${emails.length} email(s)`);

    for (const email of emails) {
      console.log(`   📧 ${email.subject || 'No subject'}`);
      console.log(`      From: ${email.from || 'Unknown'}`);
      console.log(`      Date: ${email.receivedAt || 'Unknown'}`);

      await prisma.email.delete({
        where: { id: email.id },
      });

      console.log(`      ✅ Deleted\n`);
      totalDeleted++;
    }
  }

  await prisma.$disconnect();

  console.log(`✨ Done! Deleted ${totalDeleted} email(s) from PostgreSQL.`);
  console.log('Now click "Check Emails" to reprocess them.\n');
  process.exit(0);
}

deleteEmails().catch((error) => {
  console.error('❌ Error:', error);
  prisma.$disconnect();
  process.exit(1);
});
