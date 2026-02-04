const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function checkSettings() {
  console.log('🔍 Fetching organization data...\n');

  const orgsSnapshot = await db.collection('organizations').get();

  console.log(`Found ${orgsSnapshot.size} organization(s)\n`);

  orgsSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Organization: ${data.name || doc.id}`);
    console.log(`ID: ${doc.id}`);
    console.log(`Settings:`, JSON.stringify(data.settings, null, 2));
    console.log(`All fields:`, Object.keys(data));
    console.log();
  });

  process.exit(0);
}

checkSettings().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
