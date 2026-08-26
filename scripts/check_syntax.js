const fs = require('fs');
const path = 'server/src/services/llmService.js';
const s = fs.readFileSync(path,'utf8');
let braces=0, parens=0, brackets=0;
for(let i=0;i<s.length;i++){ const c=s[i]; if(c==='{') braces++; if(c==='}') braces--; if(c==='(') parens++; if(c===')') parens--; if(c==='[') brackets++; if(c===']') brackets--; }
console.log('braces',braces,'parens',parens,'brackets',brackets);
process.exit((braces||parens||brackets)?1:0);
