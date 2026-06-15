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
            content = content.replace(/prisma\.template\b/gi, 'prisma.shelfTemplate'); 
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

            // Variables in Frontend & Backend
            // I will use regex that explicitly avoids replacing if it is preceded by a slash (like /Template or /Branch)
            // or followed by .jsx or .js
            const safeReplace = (word, replacement) => {
                const regex = new RegExp(`(?<![/\\\\\\w-])\\b${word}\\b(?![\\w.-])`, 'g');
                content = content.replace(regex, replacement);
            };

            safeReplace('ItemMinMax', 'MinMaxAutoPO');
            safeReplace('itemMinMax', 'minMaxAutoPO');
            safeReplace('ListOfItemHold', 'MasterItem');
            safeReplace('listOfItemHold', 'masterItem');
            safeReplace('template', 'shelfTemplate');
            safeReplace('Template', 'ShelfTemplate');
            safeReplace('sku', 'skuPosition');
            safeReplace('Sku', 'SkuPosition');
            safeReplace('branch', 'branchMain');
            safeReplace('Branch', 'BranchMain');
            safeReplace('bill', 'billHeader');
            safeReplace('Bill', 'BillHeader');

            // Fix any accidental URL breaks
            content = content.replace(/shelf-shelfTemplate/g, 'shelf-template');
            content = content.replace(/upload-shelfTemplate/g, 'upload-template');

            // Since we avoided slashes, import paths like './Template' will remain intact!
            // But what about the component name? 
            // import ShelfTemplate from './Template' -> That's perfectly fine!

            if (content !== original) {
                fs.writeFileSync(f, content, 'utf8');
                console.log("Updated", f);
            }
        });
    }
});
