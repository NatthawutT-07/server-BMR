const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.listOfItemHold.findMany({
    select: { codeProduct: true, consingItem: true },
    take: 50
  });
  console.log(JSON.stringify(items, null, 2));
  process.exit(0);
}

main();
