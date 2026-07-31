/* متن‌های «دسترسی فوری پس از پرداخت» را با واقعیت کارت‌به‌کارت جایگزین می‌کند.
   Node به‌جای PowerShell استفاده می‌شود چون PowerShell 5.1 فایل .ps1 را
   ANSI می‌خواند و فارسی را خراب می‌کند. idempotent است. */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'frontend');

const SUBS = [
  [/پس از پرداخت، دسترسی فوری به دانلود دارید/g,
   'پس از تأیید فیش، فایل در پنل کاربری شما فعال می‌شود'],
  [/پرداخت شبیه‌سازی‌شده \(تست\)/g,
   'پرداخت به‌صورت کارت‌به‌کارت انجام می‌شود'],
  [/محتوا فوری پس از پرداخت در پنل شما/g,
   'فایل پس از تأیید فیش در پنل شما فعال می‌شود'],
  [/>\s*پرداخت و دانلود همه موارد\s*</g, '>ادامه و پرداخت<'],
  [/>\s*پرداخت و دانلود\s*</g, '>ادامه و پرداخت<'],
];

let touched = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
  const p = path.join(dir, f);
  const before = fs.readFileSync(p, 'utf8');
  let after = before;
  for (const [re, to] of SUBS) after = after.replace(re, to);
  if (after !== before) { fs.writeFileSync(p, after, 'utf8'); console.log('✔ ' + f); touched++; }
}
console.log(touched ? `${touched} فایل به‌روز شد` : 'چیزی برای تغییر نبود (از قبل اعمال شده)');
