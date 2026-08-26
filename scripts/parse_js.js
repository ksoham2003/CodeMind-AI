const fs = require('fs');
const vm = require('vm');
const path = process.argv[2];
if(!path) { console.error('Usage: node parse_js.js <file>'); process.exit(2); }
const s = fs.readFileSync(path,'utf8');
try { new vm.Script(s); console.log('OK'); } catch(e){ console.error(e.stack||e); process.exit(1); }
