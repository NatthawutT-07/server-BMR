const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            walkDir(dirPath, callback);
        } else {
            if (dirPath.endsWith('.js') || dirPath.endsWith('.jsx')) {
                callback(dirPath);
            }
        }
    });
}

const dirsToSearch = ['../backend-BMR/controllers', '../backend-BMR/services', '../backend-BMR/router', '../frontend-BMR/src'];

dirsToSearch.forEach(dir => {
    if (fs.existsSync(dir)) {
        walkDir(dir, (f) => {
            let content = fs.readFileSync(f, 'utf8');
            let original = content;

            // Prisma Calls
            content = content.replace(/prisma\.itemMinMax\b/g, 'prisma.minMaxAutoPO');
            content = content.replace(/prisma\.listOfItemHold\b/g, 'prisma.masterItem');
            content = content.replace(/prisma\.template\b/gi, 'prisma.shelfTemplate'); // matches Template and template
            content = content.replace(/prisma\.sku\b/g, 'prisma.skuPosition');
            content = content.replace(/prisma\.branch\b/g, 'prisma.branchMain');
            content = content.replace(/prisma\.bill\b/g, 'prisma.billHeader');

            // Raw SQL exact matches
            content = content.replace(/"ItemMinMax"/g, '"MinMaxAutoPO"');
            content = content.replace(/"withdraw"/g, '"Withdraw"');
            content = content.replace(/"ListOfItemHold"/g, '"MasterItem"');
            content = content.replace(/"Template"/g, '"ShelfTemplate"');
            content = content.replace(/"Sku"/g, '"SkuPosition"');
            content = content.replace(/"Branch"/g, '"BranchMain"');
            content = content.replace(/"Bill"/g, '"BillHeader"');

            // Variables in Frontend & Backend (Case-sensitive word boundaries)
            content = content.replace(/\bItemMinMax\b/g, 'MinMaxAutoPO');
            content = content.replace(/\bitemMinMax\b/g, 'minMaxAutoPO');
            content = content.replace(/\bListOfItemHold\b/g, 'MasterItem');
            content = content.replace(/\blistOfItemHold\b/g, 'masterItem');
            content = content.replace(/\btemplate\b/g, 'shelfTemplate');
            content = content.replace(/\bTemplate\b/g, 'ShelfTemplate');
            content = content.replace(/\bsku\b/g, 'skuPosition');
            content = content.replace(/\bSku\b/g, 'SkuPosition');
            // Risky common words but user explicitly requested consistency:
            content = content.replace(/\bbranch\b/g, 'branchMain');
            content = content.replace(/\bBranch\b/g, 'BranchMain');
            content = content.replace(/\bbill\b/g, 'billHeader');
            content = content.replace(/\bBill\b/g, 'BillHeader');
            
            // Fix edge cases where I might have replaced "branchMain_code" wrongly if \b failed, but \b should be safe.
            // But we must fix URLs like /api/shelf-shelfTemplate - wait, URL is in string.
            // Strings like "/api/shelf-template" might become "/api/shelf-shelfTemplate"
            content = content.replace(/shelf-shelfTemplate/g, 'shelf-template');
            content = content.replace(/upload-shelfTemplate/g, 'upload-template');
            
            // Fix component names that might have been mangled
            content = content.replace(/ShelfShelfTemplate/g, 'ShelfTemplate');
            content = content.replace(/shelfTemplateBarcodePanel/g, 'TemplateBarcodePanel');

            if (content !== original) {
                fs.writeFileSync(f, content, 'utf8');
                console.log("Updated", f);
            }
        });
    }
});
