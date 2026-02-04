const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function resetEmails() {
  const startupNames = ['naksh jewels', 'getsetxplore', 'aarogya aadhar', 'aarogya', 'getset'];

  console.log('🔍 Searching for emails related to deleted startups...\n');

  // Get all emails
  const emailsRef = db.collection('emails');
  const snapshot = await emailsRef.get();

  console.log(`Found ${snapshot.size} total emails. Searching for matches...\n`);

  const emailsToDelete = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const subject = (data.subject || '').toLowerCase();
    const body = (data.body || '').toLowerCase();
    const from = (data.from || '').toLowerCase();

    // Check if email contains any of the startup names
    for (const name of startupNames) {
      if (subject.includes(name) || body.includes(name) || from.includes(name)) {
        emailsToDelete.push({
          id: doc.id,
          from: data.from || 'N/A',
          subject: data.subject || 'N/A',
          receivedAt: data.receivedAt ? new Date(data.receivedAt._seconds * 1000).toISOString() : 'N/A',
        });
        break;
      }
    }
  });

  if (emailsToDelete.length === 0) {
    console.log('❌ No matching emails found\n');
    process.exit(0);
  }

  console.log(`Found ${emailsToDelete.length} emails to delete:\n`);

  for (const email of emailsToDelete) {
    console.log(`📧 ${email.subject}`);
    console.log(`   From: ${email.from}`);
    console.log(`   Date: ${email.receivedAt}`);
    console.log(`   ID: ${email.id}`);
    console.log();
  }

  console.log('🗑️  Deleting emails...\n');

  for (const email of emailsToDelete) {
    await db.collection('emails').doc(email.id).delete();
    console.log(`✅ Deleted: ${email.subject}`);
  }

  console.log('\n✨ Done! Emails will be reprocessed on next check.');
  process.exit(0);
}

resetEmails().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
