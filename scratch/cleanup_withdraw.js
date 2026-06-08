const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning up duplicates in 'withdraw' table...");
  const deleted = await prisma.$executeRaw`
    DELETE FROM withdraw a
    USING withdraw b
    WHERE a.id > b.id
      AND a."docNumber" = b."docNumber"
      AND a."branchCode" = b."branchCode"
      AND a."codeProduct" = b."codeProduct"
  `;
  console.log(`Deleted ${deleted} duplicate rows.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
