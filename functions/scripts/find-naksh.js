const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function findNaksh() {
  const searchTerms = ['naksh', 'jewel', 'jewelry', 'jewellery'];

  console.log('🔍 Searching for Naksh Jewels emails...\n');

  // Search emails
  const emailsRef = db.collection('emails');
  const emailSnapshot = await emailsRef.get();

  console.log(`Searching ${emailSnapshot.size} emails...\n`);

  const matchingEmails = [];

  emailSnapshot.forEach(doc => {
    const data = doc.data();
    const subject = (data.subject || '').toLowerCase();
    const body = (data.body || '').toLowerCase();
    const from = (data.from || '').toLowerCase();

    for (const term of searchTerms) {
      if (subject.includes(term) || body.includes(term) || from.includes(term)) {
        matchingEmails.push({
          id: doc.id,
          from: data.from || 'N/A',
          subject: data.subject || 'N/A',
          body: (data.body || '').substring(0, 200),
        });
        break;
      }
    }
  });

  if (matchingEmails.length > 0) {
    console.log(`Found ${matchingEmails.length} matching emails:\n`);
    matchingEmails.forEach(email => {
      console.log(`📧 ${email.subject}`);
      console.log(`   From: ${email.from}`);
      console.log(`   ID: ${email.id}`);
      console.log(`   Body preview: ${email.body}...`);
      console.log();
    });
  } else {
    console.log('❌ No emails found for Naksh Jewels\n');
  }

  // Search proposal queue
  console.log('🔍 Searching proposal queue...\n');

  const proposalsRef = db.collection('proposalQueue');
  const proposalSnapshot = await proposalsRef.get();

  console.log(`Searching ${proposalSnapshot.size} proposals...\n`);

  const matchingProposals = [];

  proposalSnapshot.forEach(doc => {
    const data = doc.data();
    const companyName = (data.companyName || '').toLowerCase();
    const summary = (data.summary || '').toLowerCase();

    for (const term of searchTerms) {
      if (companyName.includes(term) || summary.includes(term)) {
        matchingProposals.push({
          id: doc.id,
          companyName: data.companyName || 'N/A',
          status: data.status || 'N/A',
        });
        break;
      }
    }
  });

  if (matchingProposals.length > 0) {
    console.log(`Found ${matchingProposals.length} matching proposals:\n`);
    matchingProposals.forEach(proposal => {
      console.log(`📋 ${proposal.companyName}`);
      console.log(`   Status: ${proposal.status}`);
      console.log(`   ID: ${proposal.id}`);
      console.log();
    });
  } else {
    console.log('❌ No proposals found for Naksh Jewels\n');
  }

  console.log('✨ Done!');
  process.exit(0);
}

findNaksh().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
