const fs = require('fs');

const filesToUpdate = [
    { path: '../backend-BMR/services/admin/shelfService.js' },
    { path: '../backend-BMR/controllers/admin/stockBrandLookup.js' },
    { path: '../backend-BMR/controllers/admin/upload/uploadWithdraw.js' }
];

filesToUpdate.forEach(f => {
    if (!fs.existsSync(f.path)) return;
    let content = fs.readFileSync(f.path, 'utf8');
    let original = content;

    if (f.path.includes('uploadWithdraw.js')) {
        content = content.replace(/docNumber/g, 'document_reference');
        content = content.replace(/docStatus/g, 'document_status');
        content = content.replace(/r\.date/g, 'r.date_withdraw');
        // also fix the schema insert mapping
        content = content.replace(/"date"/g, '"date_withdraw"');
        content = content.replace(/\$\{r\.date\}/g, '${r.date_withdraw}');
    }

    if (f.path.includes('shelfService.js') || f.path.includes('stockBrandLookup.js')) {
        content = content.replace(/"docStatus"/g, '"document_status"');
        // For withdraw queries
        // AND to_date("date", 'DD/MM/YYYY') -> AND to_date("date_withdraw", 'DD/MM/YYYY')
        content = content.replace(/to_date\("date",/g, 'to_date("date_withdraw",');
    }

    if (content !== original) {
        fs.writeFileSync(f.path, content, 'utf8');
        console.log("Updated", f.path);
    }
});
