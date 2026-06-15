const fs=require('fs'); 
let c=fs.readFileSync('services/admin/shelfService.js', 'utf8'); 
c=c.replace(/SUM\("value"\)/g, 'SUM("value_withdraw")'); 
c=c.replace(/SUM\("value"::numeric\)/g, 'SUM("value_withdraw"::numeric)'); 
fs.writeFileSync('services/admin/shelfService.js', c);
