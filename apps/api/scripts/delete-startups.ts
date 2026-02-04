import prisma from '../src/utils/prisma.js';

async function deleteStartups() {
  const startupsToDelete = ['naksh jewels', 'getsetexplore', 'aarogaya aadhar'];

  console.log('Searching for startups to delete...\n');

  for (const name of startupsToDelete) {
    const startups = await prisma.startup.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
      },
    });

    if (startups.length === 0) {
      console.log(`❌ Not found: ${name}`);
      continue;
    }

    for (const startup of startups) {
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
