const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function cleanupAll() {
  console.log('🔍 Cleaning up all data for the three startups...\n');

  // 1. Delete Naksh Jewels email
  console.log('📧 Deleting Naksh Jewels email...');
  await db.collection('emails').doc('vPgUeqdjX5TO9XVVIhqM').delete();
  console.log('✅ Deleted Naksh Jewels email\n');

  // 2. Check for proposal queue entries
  console.log('🔍 Checking proposal queue...');
  const proposalsRef = db.collection('proposalQueue');
  const snapshot = await proposalsRef.get();

  const searchTerms = ['naksh', 'jewel', 'getset', 'xplore', 'aarogya', 'aadhar'];
  const proposalsToDelete = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const companyName = (data.companyName || '').toLowerCase();
    const summary = (data.summary || '').toLowerCase();

    for (const term of searchTerms) {
      if (companyName.includes(term) || summary.includes(term)) {
        proposalsToDelete.push({
          id: doc.id,
          companyName: data.companyName || 'N/A',
          status: data.status || 'N/A',
        });
        break;
      }
    }
  });

  if (proposalsToDelete.length > 0) {
    console.log(`Found ${proposalsToDelete.length} proposals to delete:\n`);
    for (const proposal of proposalsToDelete) {
      console.log(`📋 Deleting: ${proposal.companyName} (${proposal.status})`);
      await db.collection('proposalQueue').doc(proposal.id).delete();
      console.log(`✅ Deleted proposal: ${proposal.companyName}\n`);
    }
  } else {
    console.log('No proposal queue entries found\n');
  }

  // 3. Check for any conversation entries
  console.log('🔍 Checking conversations...');
  const conversationsRef = db.collection('conversations');
  const convSnapshot = await conversationsRef.get();

  const conversationsToDelete = [];

  convSnapshot.forEach(doc => {
    const data = doc.data();
    const subject = (data.subject || '').toLowerCase();

    for (const term of searchTerms) {
      if (subject.includes(term)) {
        conversationsToDelete.push({
          id: doc.id,
          subject: data.subject || 'N/A',
        });
        break;
      }
    }
  });

  if (conversationsToDelete.length > 0) {
    console.log(`Found ${conversationsToDelete.length} conversations to delete:\n`);
    for (const conv of conversationsToDelete) {
      console.log(`💬 Deleting: ${conv.subject}`);
      await db.collection('conversations').doc(conv.id).delete();
      console.log(`✅ Deleted conversation\n`);
    }
  } else {
    console.log('No conversations found\n');
  }

  console.log('✨ Done! All data cleaned up. Emails will be reprocessed on next check.');
  process.exit(0);
}

cleanupAll().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
