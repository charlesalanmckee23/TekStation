import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let passed = 0;
for (const [i, code] of scripts.entries()) {
  try { new vm.Script(code, { filename: `index-inline-${i}.js` }); passed++; }
  catch (err) { console.error(`Inline script ${i} failed:`, err.message); process.exit(1); }
}
console.log(`Verified ${passed} inline scripts.`);
for (const token of ["fetch(tsApi('/api/servers')", "fetch(tsApi('/api/vault')", "fetch(tsApi('/api/account'"]) {
  if (!html.includes(token)) throw new Error(`Missing native-safe API call: ${token}`);
}
if (!html.includes("window.TS_API_ORIGIN")) throw new Error('Missing native API routing bridge.');
console.log('Native API routing hooks present.');
