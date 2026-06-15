const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        if (fs.statSync(dirPath).isDirectory()) {
            walkDir(dirPath, callback);
        } else if (dirPath.endsWith('.js') || dirPath.endsWith('.jsx')) {
            callback(dirPath);
        }
    });
}

const dirsToSearch = ['../backend-BMR/controllers', '../backend-BMR/services', '../frontend-BMR/src'];

dirsToSearch.forEach(dir => {
    if (fs.existsSync(dir)) {
        walkDir(dir, (f) => {
            let content = fs.readFileSync(f, 'utf8');
            let original = content;

            // Replace missing object access (because the previous regex ignored `(?![\\w.-])` which includes dot)
            const safeReplaceDot = (word, replacement) => {
                const regex = new RegExp(`(?<![\\w-])\\b${word}\\b\\.`, 'g');
                content = content.replace(regex, `${replacement}.`);
            };

            safeReplaceDot('template', 'shelfTemplate');
            safeReplaceDot('Template', 'ShelfTemplate');
            safeReplaceDot('sku', 'skuPosition');
            safeReplaceDot('Sku', 'SkuPosition');
            safeReplaceDot('branch', 'branchMain');
            safeReplaceDot('Branch', 'BranchMain');
            safeReplaceDot('bill', 'billHeader');
            safeReplaceDot('Bill', 'BillHeader');
            safeReplaceDot('listOfItemHold', 'masterItem');
            safeReplaceDot('itemMinMax', 'minMaxAutoPO');

            if (content !== original) {
                fs.writeFileSync(f, content, 'utf8');
                console.log("Updated", f);
            }
        });
    }
});
