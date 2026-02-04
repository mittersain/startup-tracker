const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function deleteFromProposalQueue() {
  console.log('🔍 Searching for proposals in queue...\n');

  const searchTerms = ['naksh', 'jewel', 'getset', 'xplore', 'aarogya', 'aadhar'];

  const proposalsRef = db.collection('proposalQueue');
  const snapshot = await proposalsRef.get();

  console.log(`Found ${snapshot.size} total proposals in queue\n`);

  const proposalsToDelete = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const companyName = (data.companyName || data.startupName || '').toLowerCase();
    const emailSubject = (data.emailSubject || '').toLowerCase();
    const emailFrom = (data.emailFrom || '').toLowerCase();

    for (const term of searchTerms) {
      if (companyName.includes(term) || emailSubject.includes(term) || emailFrom.includes(term)) {
        proposalsToDelete.push({
          id: doc.id,
          name: data.companyName || data.startupName || 'Unknown',
          status: data.status || 'N/A',
          emailSubject: data.emailSubject || 'N/A',
        });
        break;
      }
    }
  });

  if (proposalsToDelete.length === 0) {
    console.log('❌ No matching proposals found in queue\n');
    process.exit(0);
  }

  console.log(`Found ${proposalsToDelete.length} proposals to delete:\n`);

  for (const proposal of proposalsToDelete) {
    console.log(`📋 ${proposal.name}`);
    console.log(`   Status: ${proposal.status}`);
    console.log(`   Subject: ${proposal.emailSubject}`);
    console.log(`   ID: ${proposal.id}`);

    await db.collection('proposalQueue').doc(proposal.id).delete();
    console.log(`   ✅ Deleted\n`);
  }

  console.log('✨ Done! Proposals deleted from queue.');
  console.log('Now click "Check Emails" to reprocess them.\n');
  process.exit(0);
}

deleteFromProposalQueue().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
