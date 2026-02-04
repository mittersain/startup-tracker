const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function listStartups() {
  console.log('🔍 Fetching all startups from Firestore...\n');

  const startupsRef = db.collection('startups');
  const snapshot = await startupsRef.get();

  console.log(`Found ${snapshot.size} startups:\n`);

  const startups = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    startups.push({
      id: doc.id,
      name: data.name || 'N/A',
      email: data.email || 'N/A',
    });
  });

  // Sort by name
  startups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  startups.forEach(startup => {
    console.log(`📋 ${startup.name}`);
    console.log(`   ID: ${startup.id}`);
    console.log(`   Email: ${startup.email}`);
    console.log();
  });

  console.log('✨ Done!');
  process.exit(0);
}

listStartups().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
