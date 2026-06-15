const fs = require('fs');

const path = 'prisma/schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Replace Models
content = content.replace(/model ItemMinMax \{/g, 'model MinMaxAutoPO {');
content = content.replace(/model withdraw \{/g, 'model Withdraw {');
content = content.replace(/model ListOfItemHold \{/g, 'model MasterItem {');
content = content.replace(/model Template \{/g, 'model ShelfTemplate {');
content = content.replace(/model Sku \{/g, 'model SkuPosition {');
content = content.replace(/model Branch \{/g, 'model BranchMain {');
content = content.replace(/model Bill \{/g, 'model BillHeader {');

// Replace Relations in BranchMain
content = content.replace(/bills\s+Bill\[\]/g, 'bills       BillHeader[]');

// Replace Relations in BillHeader
content = content.replace(/branch\s+Branch\s+@relation/g, 'branch    BranchMain     @relation');

// Replace Relations in BillItem
content = content.replace(/bill\s+Bill\s+@relation/g, 'bill                                 BillHeader    @relation');

fs.writeFileSync(path, content, 'utf8');
console.log('Schema updated successfully.');
