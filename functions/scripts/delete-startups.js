const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'startup-tracker-app'
});

const db = admin.firestore();

async function deleteStartups() {
  const startupsToDelete = ['GetSetXplore', 'Aarogya Aadhar'];

  console.log('🔍 Searching for startups to delete in Firestore...\n');

  for (const targetName of startupsToDelete) {
    console.log(`Searching for: ${targetName}`);

    // Query Firestore for startups with matching names (case-insensitive)
    const startupsRef = db.collection('startups');
    const snapshot = await startupsRef.get();

    const matchingDocs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.name && data.name.toLowerCase().includes(targetName.toLowerCase())) {
        matchingDocs.push({ id: doc.id, name: data.name });
      }
    });

    if (matchingDocs.length === 0) {
      console.log(`❌ Not found: ${targetName}\n`);
      continue;
    }

    for (const startup of matchingDocs) {
      console.log(`🗑️  Deleting: ${startup.name} (${startup.id})`);
      await db.collection('startups').doc(startup.id).delete();
      console.log(`✅ Deleted ${startup.name}\n`);
    }
  }

  console.log('✨ Done!');
  process.exit(0);
}

deleteStartups().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
