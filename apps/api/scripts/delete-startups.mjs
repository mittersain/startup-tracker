import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteStartups() {
  const startupsToDelete = ['naksh jewels', 'getsetexplore', 'aarogaya aadhar'];

  console.log('Searching for startups to delete...\n');

  // Get all startups and filter in JavaScript (for SQLite compatibility)
  const allStartups = await prisma.startup.findMany();

  for (const targetName of startupsToDelete) {
    const matchingStartups = allStartups.filter(s =>
      s.name.toLowerCase().includes(targetName.toLowerCase())
    );

    if (matchingStartups.length === 0) {
      console.log(`❌ Not found: ${targetName}`);
      continue;
    }

    for (const startup of matchingStartups) {
      console.log(`🗑️  Deleting: ${startup.name} (${startup.id})`);
      await prisma.startup.delete({
        where: { id: startup.id },
      });
      console.log(`✅ Deleted ${startup.name}\n`);
    }
  }

  console.log('Done!');
  await prisma.$disconnect();
}

deleteStartups().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
