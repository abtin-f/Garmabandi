/* نسخه را در هر سه جای لازم بالا می‌برد: package.json، sw.js، فوتر صفحه‌ها.
   بدون تغییر VERSION در sw.js، مرورگر کاربر app.js قدیمی را از کش اجرا می‌کند. */
const fs = require('fs');
const path = require('path');
const root = __dirname;
const NEW = process.argv[2];
if (!NEW) { console.error('usage: node bump-version.js 2.1.0'); process.exit(1); }

const pkgPath = path.join(root, 'backend', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const OLD = pkg.version;
pkg.version = NEW;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json  ${OLD} → ${NEW}`);

const swPath = path.join(root, 'frontend', 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const before = sw;
sw = sw.replace(/(VERSION\s*=\s*['"])([^'"]+)(['"])/, `$1${NEW}$3`);
fs.writeFileSync(swPath, sw, 'utf8');
console.log(sw !== before ? `sw.js         VERSION → ${NEW}` : '⚠ sw.js: الگوی VERSION پیدا نشد');

let n = 0;
for (const f of fs.readdirSync(path.join(root, 'frontend')).filter(x => x.endsWith('.html'))) {
  const p = path.join(root, 'frontend', f);
  const b = fs.readFileSync(p, 'utf8');
  const a = b.replace(/(class="ft-version"[^>]*>)\s*نسخه\s*v[\d.]+/g, `$1نسخه v${NEW}`);
  if (a !== b) { fs.writeFileSync(p, a, 'utf8'); n++; }
}
console.log(`فوتر          ${n} صفحه`);
