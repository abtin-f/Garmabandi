/* تست خودکار فلوهای OTP — روی dev-memory-server.js اجرا کن */
const B = 'http://localhost:3001/api';
let pass = 0, fail = 0;
const post = async (p, b) => {
  const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + '  →  ' + JSON.stringify(extra)); }
}

(async () => {
  console.log('\n── ۱) ثبت‌نام با کد تایید ──');
  let r = await post('/auth/otp/send', { purpose: 'register', phone: '09121112233', password: '123456', firstName: 'علی', lastName: 'رضایی' });
  ok('کد ارسال شد', r.status === 200 && r.body.devCode, r);
  const code = r.body.devCode;

  r = await post('/auth/otp/verify', { purpose: 'register', phone: '09121112233', code: '00000' });
  ok('کد اشتباه رد می‌شود', r.status === 401, r);

  r = await post('/auth/otp/verify', { purpose: 'register', phone: '09121112233', code });
  ok('کد درست → حساب ساخته شد', r.status === 200 && r.body.token, r);
  const tk = r.body.token;

  r = await post('/auth/otp/verify', { purpose: 'register', phone: '09121112233', code });
  ok('کد یک‌بارمصرف است', r.status === 400, r);

  console.log('\n── ۲) نام و نام خانوادگی تکراری ──');
  r = await post('/auth/otp/send', { purpose: 'register', phone: '09129998877', password: '123456', firstName: 'علی', lastName: 'رضایی' });
  ok('نام تکراری → خطای NAME_TAKEN', r.status === 409 && r.body.code === 'NAME_TAKEN', r);

  r = await post('/auth/otp/send', { purpose: 'register', phone: '09129998877', password: '123456', firstName: 'علي', lastName: 'رضايي' });
  ok('نام تکراری با «ي» عربی هم گرفته می‌شود', r.status === 409 && r.body.code === 'NAME_TAKEN', r);

  r = await post('/auth/otp/send', { purpose: 'register', phone: '09121112233', password: '123456', firstName: 'رضا', lastName: 'محمدی' });
  ok('شماره تکراری → خطا', r.status === 409, r);

  r = await post('/auth/otp/send', { purpose: 'register', phone: '09129998877', password: '123456', firstName: 'رضا', lastName: 'محمدی' });
  ok('نام آزاد → کد ارسال می‌شود', r.status === 200 && r.body.devCode, r);
  await post('/auth/otp/verify', { purpose: 'register', phone: '09129998877', code: r.body.devCode });

  console.log('\n── ۳) فراموشی رمز ──');
  r = await post('/auth/otp/send', { purpose: 'reset', phone: '09355554444' });
  ok('شماره بدون حساب → NO_ACCOUNT', r.status === 404 && r.body.code === 'NO_ACCOUNT', r);

  r = await post('/auth/otp/send', { purpose: 'reset', phone: '09121112233' });
  ok('شماره دارای حساب → کد ارسال شد', r.status === 200 && r.body.devCode, r);
  const rcode = r.body.devCode;

  r = await post('/auth/otp/verify', { purpose: 'reset', phone: '09121112233', code: rcode });
  ok('کد درست → resetToken', r.status === 200 && r.body.resetToken, r);
  const rt = r.body.resetToken;

  r = await post('/auth/reset-password', { resetToken: 'bogus', password: 'newpass1' });
  ok('توکن جعلی رد می‌شود', r.status === 401, r);

  r = await post('/auth/reset-password', { resetToken: rt, password: '123' });
  ok('رمز کوتاه رد می‌شود', r.status === 400, r);

  r = await post('/auth/reset-password', { resetToken: rt, password: 'newpass1' });
  ok('رمز جدید ثبت شد', r.status === 200 && r.body.token, r);

  r = await post('/auth/reset-password', { resetToken: rt, password: 'newpass2' });
  ok('توکن یک‌بارمصرف است', r.status === 401, r);

  r = await post('/auth/login', { phone: '09121112233', password: 'newpass1' });
  ok('ورود با رمز جدید', r.status === 200 && r.body.token, r);

  r = await post('/auth/login', { phone: '09121112233', password: '123456' });
  ok('رمز قدیمی دیگر کار نمی‌کند', r.status === 401, r);

  console.log('\n── ۴) محدودیت ارسال مجدد ──');
  r = await post('/auth/otp/send', { purpose: 'reset', phone: '09129998877' });
  ok('اولین کد', r.status === 200, r);
  r = await post('/auth/otp/send', { purpose: 'reset', phone: '09129998877' });
  ok('ارسال دوباره‌ی سریع بلاک می‌شود', r.status === 429 && r.body.retryAfter > 0, r);

  console.log('\n── ۵) اعتبارسنجی ورودی ──');
  r = await post('/auth/otp/send', { purpose: 'register', phone: '0912', password: '123456', firstName: 'الف', lastName: 'ب' });
  ok('شماره نامعتبر رد می‌شود', r.status === 400, r);
  r = await post('/auth/otp/send', { purpose: 'register', phone: '09131234567', password: '123', firstName: 'الف', lastName: 'ب' });
  ok('رمز کوتاه رد می‌شود', r.status === 400, r);
  r = await post('/auth/otp/send', { purpose: 'register', phone: '09131234567', password: '123456', firstName: 'Ali', lastName: 'ب' });
  ok('نام انگلیسی رد می‌شود', r.status === 400, r);

  console.log('\n── ۶) مسیر قدیمی ثبت‌نام بسته است ──');
  r = await post('/auth/register', { phone: '09141112222', password: '123456', firstName: 'حسن', lastName: 'نوری' });
  ok('دور زدن تایید شماره ممکن نیست', r.status === 410 && r.body.code === 'USE_OTP', r);
  r = await post('/auth/login', { phone: '09141112222', password: '123456' });
  ok('حسابی هم ساخته نشده', r.status === 404, r);

  console.log(`\n═══ نتیجه: ${pass} موفق، ${fail} ناموفق ═══\n`);
  process.exit(fail ? 1 : 0);
})();
