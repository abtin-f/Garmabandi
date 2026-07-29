/* ═══════════════════════════════════════════════════════════
   fix-footer.js — بازچینش فوتر
   نماد اینماد به ستون سوم ft-top می‌رود (کنار ستون «شرکت») و
   آیکون‌های شبکه‌های اجتماعی از ft-bottom به زیر نماد منتقل می‌شوند.

   ⚠ با Node نوشته شده نه PowerShell: پاورشل ۵.۱ فایل .ps1 را با
   انکودینگ ANSI می‌خواند و متن فارسی داخل اسکریپت خراب می‌شود —
   دقیقاً همان بلایی که سر alt نماد آمد.
   اجرای دوباره‌اش بی‌خطر است.
   اجرا:  node fix-footer.js
   ═══════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, 'frontend');
const ENAMAD =
  `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=766293&Code=ENXngwuS9BlcrO9POja240UOTkYAuFa5'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=766293&Code=ENXngwuS9BlcrO9POja240UOTkYAuFa5' alt='نماد اعتماد الکترونیکی' style='cursor:pointer' code='ENXngwuS9BlcrO9POja240UOTkYAuFa5'></a>`;

/* alt نماد یک‌بار با اسکریپت PowerShell نوشته شد و به‌هم ریخت
   (پاورشل ۵.۱ فایل .ps1 را ANSI می‌خواند). این‌جا تعمیرش می‌کنیم. */
const BROKEN_ALT = "alt='Ù†Ù…Ø§Ø¯ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ú©ØªØ±ÙˆÙ†ÛŒÚ©ÛŒ'";
const GOOD_ALT   = "alt='نماد اعتماد الکترونیکی'";

let changed = 0;
for (const f of fs.readdirSync(FE).filter(x => x.endsWith('.html'))) {
  const p = path.join(FE, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes(BROKEN_ALT)) {
    html = html.split(BROKEN_ALT).join(GOOD_ALT);
    fs.writeFileSync(p, html, 'utf8');
    console.log('alt fixed: ' + f);
  }
  if (!html.includes('ft-bottom')) continue;              /* فوتر ندارد */
  if (html.includes('ft-trust-col')) { console.log('skip: ' + f); continue; }

  /* ۱) بلوک آیکون‌های شبکه اجتماعی را بردار */
  const socialsRe = /[ \t]*<div class="ft-socials">[\s\S]*?\n[ \t]*<\/div>\n/;
  const socials = html.match(socialsRe);
  if (!socials) { console.log('no socials: ' + f); continue; }
  html = html.replace(socialsRe, '');

  /* ۲) بلوک نمادِ قبلیِ فوتر را بردار (اگر هست).
     ⚠ ((?!<div)[\s\S])*? یعنی اجازه ندارد از روی یک <div دیگر رد شود.
     بدون این قید، در about.html که دو تا .ft-trust دارد (یکی داخل
     .abt-trust و یکی در فوتر)، رجکس از اولی شروع می‌کرد و تا
     .ft-bottom همه‌چیز — از جمله کل ft-top — را می‌بلعید. */
  html = html.replace(
    /[ \t]*<div class="ft-trust">((?!<div)[\s\S])*?<\/div>[ \t]*(?=<div class="ft-bottom">)/, '');

  /* ۳) ستون سوم را داخل ft-top، بعد از ft-cols بگذار */
  const inner = socials[0]
    .replace(/^\n/, '')
    .split('\n').map(l => (l.trim() ? '    ' + l : l)).join('\n');
  const col =
    `        <div class="ft-trust-col">\n` +
    `          <div class="ft-trust">\n` +
    `            ${ENAMAD}\n` +
    `          </div>\n` +
    inner.replace(/\n$/, '') + `\n` +
    `        </div>\n`;

  const anchor = /( {8}<\/div>\n)( {6}<\/div>\n {6}<div class="ft-divider">)/;
  if (!anchor.test(html)) { console.log('no anchor: ' + f); continue; }
  html = html.replace(anchor, (_m, a, b) => a + col + b);

  fs.writeFileSync(p, html, 'utf8');
  console.log('done: ' + f);
  changed++;
}
console.log(changed + ' file(s) updated');
