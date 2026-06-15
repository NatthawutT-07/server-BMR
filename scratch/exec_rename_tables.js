const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function main() { 
  const statements = [
    'ALTER TABLE "ItemMinMax" RENAME TO "MinMaxAutoPO"',
    'ALTER TABLE "withdraw" RENAME TO "Withdraw"',
    'ALTER TABLE "ListOfItemHold" RENAME TO "MasterItem"',
    'ALTER TABLE "Template" RENAME TO "ShelfTemplate"',
    'ALTER TABLE "Sku" RENAME TO "SkuPosition"',
    'ALTER TABLE "Branch" RENAME TO "BranchMain"',
    'ALTER TABLE "Bill" RENAME TO "BillHeader"'
  ];

  for(const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log('SUCCESS: ', stmt);
    } catch(e) {
      console.log('FAILED: ', stmt, ' -> ', e.message);
    }
  }
}
main();
