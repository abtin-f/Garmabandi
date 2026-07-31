/* ═══════════════════════════════════════════════════════════
   dev-test-c2c.js — تست پرداخت کارت‌به‌کارت
   ───────────────────────────────────────────────────────────
   تمرکز اصلی: راه‌های دور زدن پرداخت و گرفتن فایل رایگان.

   اجرا (در دو ترمینال):
     node dev-memory-server.js
     node dev-test-c2c.js
═══════════════════════════════════════════════════════════ */
const BASE = process.env.BASE || 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
const J = (tok, body) => ({
  headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function call(method, path, tok, body) {
  const o = J(tok, body); o.method = method;
  const r = await fetch(BASE + path, o);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
/* یک PNG ۱×۱ واقعی — multer فقط به mimetype نگاه می‌کند ولی بگذار فایل سالم باشد */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

async function postReceipt(tok, orderId, { code, bytes = PNG, type = 'image/png', name = 'r.png', omitFile = false } = {}) {
  const fd = new FormData();
  if (!omitFile) fd.append('receipt', new Blob([bytes], { type }), name);
  if (code !== undefined) fd.append('trackingCode', code);
  const r = await fetch(`${BASE}/api/orders/${orderId}/receipt`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd,
  });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

async function login(phone, password) {
  const { d } = await call('POST', '/api/auth/login', null, { phone, password });
  return d.token;
}
/* کاربر تازه از مسیر OTP (سرور تستی کد را در پاسخ برمی‌گرداند) */
async function makeUser(phone, firstName, lastName) {
  const s = await call('POST', '/api/auth/otp/send', null,
    { purpose: 'register', phone, password: 'test1234', firstName, lastName });
  if (!s.d.devCode) throw new Error('devCode نیامد — سرور با OTP_DEV_MODE اجرا شده؟ ' + JSON.stringify(s.d));
  const v = await call('POST', '/api/auth/otp/verify', null, { purpose: 'register', phone, code: s.d.devCode });
  return v.d.token;
}

(async () => {
  console.log('\n═══ پرداخت کارت‌به‌کارت ═══\n');

  const admin = await login('09120000000', 'admin123');
  ok('ورود ادمین', !!admin);

  const st = Date.now().toString().slice(-6);
  const buyer = await makeUser('0913' + st + '1', 'خریدار', 'یکم' + st);
  const other = await makeUser('0913' + st + '2', 'خریدار', 'دوم' + st);
  ok('ساخت دو کاربر تست', !!buyer && !!other);

  const prods = (await call('GET', '/api/products', null)).d;
  const target = prods.find(p => !['p1', 'p2'].includes(p.id)) || prods[0];
  ok('محصول تست پیدا شد', !!target, target && target.id);

  /* ─── ۱. مسیر پرداخت شبیه‌سازی‌شده باید بسته باشد ─── */
  console.log('\n── راه‌های دور زدن ──');
  const legacy = await call('POST', '/api/orders/pay/anything', buyer, {});
  ok('مسیر قدیمی pay بسته است (410)', legacy.status === 410 && legacy.d.code === 'USE_RECEIPT', legacy);

  /* ─── ۲. ساخت سفارش ─── */
  await call('POST', '/api/terms/accept', buyer, {});
  const c = await call('POST', '/api/orders/create', buyer, { productId: target.id });
  ok('ساخت سفارش', c.status === 200 && !!c.d.orderId, c.d);
  const order = c.d;
  ok('مبلغ یکتا بیشتر از مبلغ پایه است', order.payAmount > order.amount, { amount: order.amount, pay: order.payAmount });
  ok('اختلاف مبلغ یکتا کمتر از ۱۰۰ تومان است', order.payAmount - order.amount < 100);
  ok('شماره کارت برگردانده شد', /^\d{16}$/.test(String(order.cardNumber || '')));

  /* دستکاری قیمت از سمت کلاینت */
  const tamper = await call('POST', '/api/orders/create', other, { productId: target.id, amount: 1000, payAmount: 1000, price: 1 });
  await call('POST', '/api/terms/accept', other, {});
  ok('مبلغ ارسالی کلاینت نادیده گرفته می‌شود',
    tamper.d.payAmount > 1000 && tamper.d.amount === order.amount, { got: tamper.d.payAmount });

  /* سفارش دوباره برای همان محصول، همان سفارش را برمی‌گرداند */
  const again = await call('POST', '/api/orders/create', buyer, { productId: target.id });
  ok('سفارش تکراری، همان سفارش قبلی است', again.d.orderId === order.orderId && again.d.reused === true);

  /* ─── ۳. دانلود قبل از تأیید باید قفل باشد ─── */
  const dlEarly = await fetch(`${BASE}/api/download/${target.id}`, { headers: { Authorization: 'Bearer ' + buyer } });
  ok('دانلود قبل از پرداخت قفل است (403)', dlEarly.status === 403, dlEarly.status);

  /* ─── ۴. اعتبارسنجی فیش ─── */
  console.log('\n── بارگذاری فیش ──');
  const noFile = await postReceipt(buyer, order.orderId, { code: '123456', omitFile: true });
  ok('بدون فایل رد می‌شود', noFile.status === 400, noFile);

  const badType = await postReceipt(buyer, order.orderId, { code: '123456', type: 'text/html', name: 'x.html' });
  ok('فایل HTML رد می‌شود', badType.status === 400, badType);

  const shortCode = await postReceipt(buyer, order.orderId, { code: '12' });
  ok('کد پیگیری کوتاه رد می‌شود', shortCode.status === 400, shortCode);

  const big = await postReceipt(buyer, order.orderId, { code: '123456', bytes: Buffer.alloc(3 * 1024 * 1024, 1) });
  ok('فایل بزرگ‌تر از ۲ مگابایت رد می‌شود', big.status === 400, big.status);

  const CODE = 'TRK' + st;
  const good = await postReceipt(buyer, order.orderId, { code: CODE });
  ok('ثبت فیش درست', good.status === 200 && good.d.status === 'pending_review', good);

  const twice = await postReceipt(buyer, order.orderId, { code: CODE + '9' });
  ok('ثبت دوباره فیش روی سفارشِ در حال بررسی رد می‌شود', twice.status === 409, twice);

  /* همان کد پیگیری روی سفارش کاربر دوم */
  const dup = await postReceipt(other, tamper.d.orderId, { code: CODE });
  ok('کد پیگیری تکراری رد می‌شود', dup.status === 409, dup);

  /* ─── ۵. دسترسی به فیش ─── */
  console.log('\n── دسترسی به فیش ──');
  const rcMine = await fetch(`${BASE}/api/orders/${order.orderId}/receipt`, { headers: { Authorization: 'Bearer ' + buyer } });
  ok('صاحب سفارش فیش خودش را می‌بیند', rcMine.status === 200, rcMine.status);
  const rcOther = await fetch(`${BASE}/api/orders/${order.orderId}/receipt`, { headers: { Authorization: 'Bearer ' + other } });
  ok('کاربر دیگر فیش را نمی‌بیند (403)', rcOther.status === 403, rcOther.status);
  const rcAnon = await fetch(`${BASE}/api/orders/${order.orderId}/receipt`);
  ok('بدون توکن فیش باز نمی‌شود (401)', rcAnon.status === 401, rcAnon.status);
  const rcAdmin = await fetch(`${BASE}/api/orders/${order.orderId}/receipt`, { headers: { Authorization: 'Bearer ' + admin } });
  ok('ادمین فیش را می‌بیند', rcAdmin.status === 200, rcAdmin.status);
  /* فیش نباید از مسیر عمومی uploads قابل دسترسی باشد */
  const pub = await fetch(`${BASE}/uploads/${(await call('GET', '/api/admin/orders', admin)).d.find(o => o.id === order.orderId)?.receiptPath}`);
  ok('فیش از مسیر عمومی /uploads قابل دانلود نیست', pub.status === 404, pub.status);

  /* ─── ۶. تأیید و رد ─── */
  console.log('\n── تأیید و رد ──');
  const approveByUser = await call('POST', `/api/admin/orders/${order.orderId}/approve`, buyer, {});
  ok('کاربر عادی نمی‌تواند سفارش خودش را تأیید کند (403)', approveByUser.status === 403, approveByUser);

  const dlStill = await fetch(`${BASE}/api/download/${target.id}`, { headers: { Authorization: 'Bearer ' + buyer } });
  ok('دانلود هنوز قفل است', dlStill.status === 403, dlStill.status);

  const appr = await call('POST', `/api/admin/orders/${order.orderId}/approve`, admin, {});
  ok('ادمین تأیید می‌کند', appr.status === 200 && appr.d.status === 'paid', appr);

  const dlNow = await fetch(`${BASE}/api/download/${target.id}`, { headers: { Authorization: 'Bearer ' + buyer } });
  ok('بعد از تأیید، دانلود باز می‌شود', dlNow.status === 200, dlNow.status);
  const dlOther = await fetch(`${BASE}/api/download/${target.id}`, { headers: { Authorization: 'Bearer ' + other } });
  ok('کاربر دیگر همچنان قفل است', dlOther.status === 403, dlOther.status);

  const appr2 = await call('POST', `/api/admin/orders/${order.orderId}/approve`, admin, {});
  ok('تأیید دوباره رد می‌شود (409)', appr2.status === 409, appr2);

  const rej = await call('POST', `/api/admin/orders/${order.orderId}/reject`, admin, { reason: 'تست' });
  ok('سفارش تأییدشده قابل رد نیست (409)', rej.status === 409, rej);

  /* جریان رد کردن روی کاربر دوم */
  const ok2 = await postReceipt(other, tamper.d.orderId, { code: 'TRK2' + st });
  ok('ثبت فیش کاربر دوم', ok2.status === 200, ok2);
  const noReason = await call('POST', `/api/admin/orders/${tamper.d.orderId}/reject`, admin, { reason: 'x' });
  ok('رد بدون دلیل معتبر رد می‌شود (400)', noReason.status === 400, noReason);
  const rej2 = await call('POST', `/api/admin/orders/${tamper.d.orderId}/reject`, admin, { reason: 'مبلغ واریزی کمتر از مبلغ سفارش است' });
  ok('رد با دلیل', rej2.status === 200 && rej2.d.status === 'rejected', rej2);

  const mine2 = (await call('GET', '/api/orders/my', other)).d;
  const rejOrder = mine2.find(o => o.id === tamper.d.orderId);
  ok('دلیل رد به کاربر برمی‌گردد', rejOrder?.rejectReason?.includes('مبلغ'), rejOrder?.rejectReason);
  ok('سفارش ردشده قفل است', rejOrder?.unlocked === false);

  const dlRej = await fetch(`${BASE}/api/download/${target.id}`, { headers: { Authorization: 'Bearer ' + other } });
  ok('کاربرِ ردشده نمی‌تواند دانلود کند', dlRej.status === 403, dlRej.status);

  /* بعد از رد، کاربر می‌تواند فیش تازه بفرستد */
  const retry = await postReceipt(other, tamper.d.orderId, { code: 'TRK3' + st });
  ok('بعد از رد می‌شود فیش تازه فرستاد', retry.status === 200, retry);

  /* ─── ۷. رگرسیون باگ‌های گزارش‌شده روی سایت زنده ─── */
  console.log('\n── رگرسیون ──');

  /* باگ ۳ الف: پاسخ ورود باید termsAccepted داشته باشد، وگرنه مودال
     قوانین سر هر خرید دوباره باز می‌شود */
  const lg = await call('POST', '/api/auth/login', null, { phone: '09120000000', password: 'admin123' });
  ok('پاسخ ورود termsAccepted دارد', lg.d.user && 'termsAccepted' in lg.d.user, Object.keys(lg.d.user || {}));
  ok('پاسخ ورود رمز عبور را لو نمی‌دهد', lg.d.user && !('password' in lg.d.user));
  const meRes = await call('GET', '/api/auth/me', admin);
  ok('/auth/me همان شکل را برمی‌گرداند',
    ['termsAccepted', 'purchases', 'isAdmin', 'phone'].every(k => k in meRes.d), Object.keys(meRes.d));

  /* باگ ۳ ب: توکن نامعتبر باید ۴۰۱ بدهد تا فرانت نشست را پاک کند */
  const badTok = await call('GET', '/api/orders/my', 'not.a.real.token');
  ok('توکن خراب → ۴۰۱', badTok.status === 401, badTok);

  /* باگ ۱: چند بار زدن دکمه‌ی خرید نباید چند سفارش بسازد */
  const p2 = prods.find(p => p.id !== target.id && !['p1', 'p2'].includes(p.id));
  const a1 = await call('POST', '/api/orders/create', other, { productId: p2.id });
  const a2 = await call('POST', '/api/orders/create', other, { productId: p2.id });
  const a3 = await call('POST', '/api/orders/create', other, { productId: p2.id });
  ok('سه بار خرید = یک سفارش', a1.d.orderId === a2.d.orderId && a2.d.orderId === a3.d.orderId,
    [a1.d.orderId, a2.d.orderId, a3.d.orderId]);
  const openSame = (await call('GET', '/api/orders/my', other)).d
    .filter(o => o.productId === p2.id && !['expired', 'paid'].includes(o.status));
  ok('فقط یک سفارش باز برای آن محصول دیده می‌شود', openSame.length === 1, openSame.length);

  /* باگ ۲: سفارش بدون فیش نه تأیید می‌شود نه رد — ادمین نباید گیر کند */
  const apprNoReceipt = await call('POST', `/api/admin/orders/${a1.d.orderId}/approve`, admin, {});
  ok('سفارش بدون فیش تأیید نمی‌شود (۴۰۹)', apprNoReceipt.status === 409, apprNoReceipt);
  const adminList = (await call('GET', '/api/admin/orders', admin)).d;
  ok('هیچ سفارشی با وضعیت قدیمی pending نمانده',
    !adminList.some(o => o.status === 'pending'),
    adminList.filter(o => o.status === 'pending').length);

  /* مهاجرت: چهار سفارش قدیمیِ تکراری روی p9 باید به یک سفارشِ باز
     تبدیل شده باشند (بقیه expired) */
  const oldRows = adminList.filter(o => o.id.startsWith('legacy-'));
  ok('چهار سفارش قدیمی هنوز در دیتابیس هستند', oldRows.length === 4, oldRows.length);
  const legacyOpen = oldRows.filter(o => !['expired', 'paid'].includes(o.status));
  ok('فقط یکی از آن‌ها باز مانده', legacyOpen.length === 1, legacyOpen.map(o => o.status));
  ok('سفارش بازِ مهاجرت‌یافته awaiting_payment است', legacyOpen[0]?.status === 'awaiting_payment', legacyOpen[0]?.status);
  ok('مبلغ یکتا برایش ساخته شد', legacyOpen[0]?.payAmount > 18000, legacyOpen[0]?.payAmount);
  const adminMine = (await call('GET', '/api/orders/my', admin)).d.filter(o => o.productId === 'p9' && o.status !== 'expired');
  ok('در پنل کاربر فقط یک ردیف برای آن محصول می‌ماند', adminMine.length === 1, adminMine.length);

  /* ─── ۸. وضعیت در پنل کاربر ─── */
  console.log('\n── پنل کاربر ──');
  const mine = (await call('GET', '/api/orders/my', buyer)).d;
  const paid = mine.find(o => o.id === order.orderId);
  ok('سفارش تأییدشده unlocked است', paid?.unlocked === true);
  ok('شماره کارت در سفارش تأییدشده فرستاده نمی‌شود', paid?.cardNumber === undefined);

  console.log(`\n═══ ${pass} قبول، ${fail} رد ═══\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n💥', e); process.exit(1); });
