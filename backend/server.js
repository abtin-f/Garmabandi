require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const { db, init: initDB } = require('./db-mysql');

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'thermal-book-secret-2024';

/* gzip compression — large transfer-size win for HTML/CSS/JS on slow mobile
   networks. Loaded defensively: if the package isn't installed on the host,
   the server still boots (just without gzip). Binary/already-compressed
   responses (images, zips, file downloads) are skipped automatically. */
try {
  const compression = require('compression');
  app.use(compression());
} catch { console.warn('⚠ compression not installed — serving without gzip'); }

app.use(cors({ origin: '*', exposedHeaders: ['Content-Disposition', 'Content-Length'] }));
/* Files are uploaded via multipart (multer), not base64 JSON, so the
   JSON body limit can stay small — only text fields pass through here. */
app.use(express.json({ limit: '2mb' }));

/* ─── حالت تعمیر سایت ───
   وضعیت در فایل maintenance.flag ذخیره می‌شود (با restart هم می‌ماند).
   وقتی فعال است، همه‌ی بازدیدکنندگان صفحه‌ی maintenance.html را
   می‌بینند — به‌جز: مسیرهای API، فایل‌های assets، و خود پنل ادمین
   (تا ادمین بتواند حالت تعمیر را خاموش کند). */
const MAINT_FLAG = path.join(__dirname, 'maintenance.flag');
function isMaintenance() { return fs.existsSync(MAINT_FLAG); }

/* ─── ریست درآمد ───
   به‌جای حذف سفارش‌ها (که سابقهٔ خرید و دسترسی دانلود کاربران را از بین می‌برد)
   فقط یک «نقطهٔ صفرِ درآمد» ذخیره می‌کنیم؛ درآمد از این تاریخ به بعد شمرده می‌شود.
   تاریخچهٔ سفارش‌ها و خریدهای کاربران دست‌نخورده می‌ماند. */
const REVENUE_FLAG = path.join(__dirname, 'revenue-reset.flag');
function revenueResetAt() {
  try { return fs.existsSync(REVENUE_FLAG) ? new Date(fs.readFileSync(REVENUE_FLAG, 'utf8').trim()) : null; }
  catch { return null; }
}

/* استخراج توکن از هدر Authorization یا کوکی tb_tk
   (ناوبری مرورگر هدر نمی‌فرستد، ولی کوکی را می‌فرستد) */
function tokenFromReq(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const c = req.headers.cookie || '';
  const m = /(?:^|;\s*)tb_tk=([^;]+)/.exec(c);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return null;
}
/* آیا درخواست از طرف یک ادمینِ معتبر است؟ */
function isAdminRequest(req) {
  const t = tokenFromReq(req);
  if (!t) return false;
  try {
    const payload = jwt.verify(t, JWT_SECRET);
    const u = db.get('users').find({ id: payload.id }).value();
    return !!(u && u.isAdmin && !u.banned);
  } catch { return false; }
}

app.use((req, res, next) => {
  if (!isMaintenance()) return next();
  const p = req.path;
  /* این مسیرها در حالت تعمیر هم باید کار کنند */
  if (p.startsWith('/api/') ||
      p.startsWith('/assets/') ||
      p.startsWith('/uploads/') ||
      p === '/admin.html' ||
      p === '/maintenance.html' ||
      p === '/sw.js' ||
      p === '/manifest.json' ||
      p === '/robots.txt' ||
      p === '/sitemap.xml') {
    return next();
  }
  /* ادمین‌ها در حالت تعمیر هم سایت را عادی می‌بینند (صفحه تعمیر فقط برای کاربران عادی) */
  if (isAdminRequest(req)) return next();
  /* بقیه‌ی بازدیدکنندگان → صفحه‌ی تعمیر */
  res.status(503).sendFile(path.join(__dirname, '../frontend/maintenance.html'));
});

/* وضعیت حالت تعمیر — عمومی (برای بررسی سمت کلاینت) */
app.get('/api/maintenance', (req, res) => {
  res.json({ maintenance: isMaintenance(), isAdmin: isAdminRequest(req) });
});

app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders: (res, fp) => {
    /* correct MIME for the PWA manifest + keep the service worker un-cached
       so clients always pick up a new version */
    if (fp.endsWith('manifest.json')) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    if (fp.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));
/* Uploaded product images live in backend/uploads and are served at /uploads */
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ─── DIRECT FILE UPLOADS (multipart, no base64) ───
   Uploading via base64 inside JSON inflates payloads ~33% and forces
   the whole file into memory. multer streams the raw bytes straight
   to disk — fast, memory-light, and supports large files. */
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    /* keep original extension; unique, safe name */
    const ext = path.extname(file.originalname || '').slice(0, 12).replace(/[^.\w]/g, '');
    const kind = file.fieldname === 'image' ? 'img' : 'file';
    cb(null, `${kind}_${uuidv4()}${ext || ''}`);
  }
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },   /* 50 MB cap per file */
  /* No fileFilter → the downloadable file accepts ANY extension.
     Image validation is done per-field below. */
});

const auth = async (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'توکن یافت نشد' });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    /* مسدودسازی فوری: حتی اگر توکن معتبر باشد، کاربر بن‌شده رد می‌شود */
    const u = db.get('users').find({ id: req.user.id }).value();
    if (u && u.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    next();
  }
  catch { res.status(401).json({ error: 'توکن نامعتبر' }); }
};
const adminAuth = async (req, res, next) => {
  auth(req, res, () => {
    const u = db.get('users').find({ id: req.user.id }).value();
    if (!u?.isAdmin) return res.status(403).json({ error: 'دسترسی ادمین لازم است' });
    next();
  });
};

/* ─── Strip heavy / private fields from product objects ───
   The downloadable file is stored on disk (filePath) and streamed only
   by /api/download. Listings expose a lightweight `hasFile` flag +
   `fileSizeMB` so the UI knows a file exists, without shipping bytes
   or leaking the server-side path. Legacy base64 `fileData` (if any
   old product still has it) is also stripped. */
function lightProduct(p) {
  if (!p) return p;
  const { fileData, filePath, fileMime, ...rest } = p;
  return { ...rest, hasFile: !!(filePath || fileData), fileSizeMB: p.fileSizeMB || 0 };
}
function lightProducts(arr) { return (arr || []).map(lightProduct); }

/* ─── اعتبارسنجی نام (مطابق فرانت‌اند) ───
   • نام: بدون حروف انگلیسی، حداکثر ۱۰ کاراکتر
   • نام خانوادگی: حداکثر ۱۵ کاراکتر
   خروجی: پیام خطا (string) یا null اگر معتبر بود */
function validateNameServer(firstName, lastName) {
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (/[A-Za-z]/.test(fn)) return 'نام نباید شامل حروف انگلیسی باشد';
  if (fn.length > 10)      return 'نام حداکثر ۱۰ کاراکتر است';
  if (/[A-Za-z]/.test(ln)) return 'نام خانوادگی نباید شامل حروف انگلیسی باشد';
  if (ln.length > 15)      return 'نام خانوادگی حداکثر ۱۵ کاراکتر است';
  return null;
}

/* ─── آیا این نام و نام خانوادگی قبلاً ثبت شده؟ ───
   مقایسه بدون حساسیت به فاصله/نیم‌فاصله و شکل حروف عربی/فارسی
   (ی/ي و ک/ك) تا «علی رضایی» و «علي رضايي» یکی حساب شوند.
   exceptId: هنگام ویرایش پروفایل، خودِ کاربر نادیده گرفته می‌شود. */
function normFa(s) {
  return String(s || '')
    .replace(/[يى]/g, 'ی')      /* ي ,ى → ی */
    .replace(/ك/g, 'ک')              /* ك → ک */
    .replace(/[‌‏‎]/g, ' ')/* نیم‌فاصله → فاصله */
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}
function fullNameTaken(firstName, lastName, exceptId) {
  const key = normFa(firstName) + '|' + normFa(lastName);
  if (key === '|') return false;
  return db.get('users').value().some(u =>
    u.id !== exceptId && (normFa(u.firstName) + '|' + normFa(u.lastName)) === key);
}

/* ═══════════════════════════════════════════════════════════
   OTP — تایید شماره موبایل با کد پیامکی (پنل sms.ir)
   ───────────────────────────────────────────────────────────
   نکته‌ی مهم: کاربر قبل از تایید شماره در دیتابیس ساخته نمی‌شود.
   اطلاعات ثبت‌نام (با رمزِ از قبل هش‌شده) در حافظه نگه داشته
   می‌شود و فقط بعد از تایید کد به جدول users نوشته می‌شود.
═══════════════════════════════════════════════════════════ */
const crypto = require('crypto');

const OTP_LEN          = 5;                 /* طول کد */
const OTP_TTL_MS       = 2 * 60 * 1000;     /* اعتبار کد: ۲ دقیقه */
const OTP_RESEND_MS    = 60 * 1000;         /* فاصله‌ی ارسال مجدد: ۶۰ ثانیه */
const OTP_MAX_ATTEMPTS = 5;                 /* تلاش اشتباه مجاز */
const OTP_MAX_PER_HOUR = 6;                 /* سقف درخواست کد برای هر شماره در ساعت */
const RESET_TTL_MS     = 10 * 60 * 1000;    /* اعتبار توکن تغییر رمز */

/* در حالت توسعه، کد در پاسخ API هم برمی‌گردد. روی سرور واقعی
   حتماً OTP_DEV_MODE=false باشد وگرنه کد لو می‌رود. */
const OTP_DEV_MODE = String(process.env.OTP_DEV_MODE || '').toLowerCase() === 'true';

const SMS_API_KEY     = (process.env.SMS_API_KEY || '').trim();
const SMS_TEMPLATE_ID = parseInt(process.env.SMS_TEMPLATE_ID || '0', 10);
const SMS_PARAM_NAME  = (process.env.SMS_PARAM_NAME || 'CODE').trim();

const otpStore    = new Map();   /* 'purpose:phone' → {code, exp, tries, sentAt, payload} */
const otpHourly   = new Map();   /* phone → [timestamp, ...] */
const resetTokens = new Map();   /* token → {phone, exp} */

const otpKey  = (purpose, phone) => purpose + ':' + phone;
const nowIso  = () => new Date().toISOString();

/* کد با crypto تولید می‌شود، نه Math.random */
function genOtp() {
  let s = '';
  for (let i = 0; i < OTP_LEN; i++) s += crypto.randomInt(0, 10);
  return s;
}
/* مقایسه‌ی زمان‌ثابت */
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
/* سقف درخواست در ساعت */
function hourlyAllowed(phone) {
  const now = Date.now();
  const arr = (otpHourly.get(phone) || []).filter(t => now - t < 3600e3);
  otpHourly.set(phone, arr);
  return arr.length < OTP_MAX_PER_HOUR;
}
function hourlyMark(phone) {
  const arr = otpHourly.get(phone) || [];
  arr.push(Date.now());
  otpHourly.set(phone, arr);
}

/* پاکسازی دوره‌ای رکوردهای منقضی */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore)    if (v.exp < now) otpStore.delete(k);
  for (const [k, v] of resetTokens) if (v.exp < now) resetTokens.delete(k);
}, 60_000).unref?.();

/* ─── ارسال واقعی پیامک از طریق sms.ir ───
   مستندات: POST https://api.sms.ir/v1/send/verify
   هدر x-api-key + بدنه‌ی {mobile, templateId, parameters:[{name,value}]} */
async function sendOtpSms(phone, code) {
  if (!SMS_API_KEY || !SMS_TEMPLATE_ID) {
    console.log(`📵 [OTP] پنل پیامک تنظیم نشده — کد ${phone}: ${code}`);
    return { sent: false, reason: 'not-configured' };
  }
  const ctrl = AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined;
  let r, d;
  try {
    r = await fetch('https://api.sms.ir/v1/send/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': SMS_API_KEY,
      },
      body: JSON.stringify({
        mobile: phone,
        templateId: SMS_TEMPLATE_ID,
        parameters: [{ name: SMS_PARAM_NAME, value: String(code) }],
      }),
      signal: ctrl,
    });
    d = await r.json().catch(() => ({}));
  } catch (e) {
    console.error('❌ sms.ir:', e.message);
    throw new Error('ارتباط با سامانه‌ی پیامک برقرار نشد — دوباره تلاش کنید');
  }
  if (!r.ok || d.status !== 1) {
    console.error('❌ sms.ir:', r.status, JSON.stringify(d));
    throw new Error(d.message || 'ارسال پیامک ناموفق بود');
  }
  return { sent: true, messageId: d.data?.messageId };
}

/* ─── ساخت و ارسال کد (مشترک بین ثبت‌نام و فراموشی رمز) ─── */
async function issueOtp(purpose, phone, payload) {
  const key = otpKey(purpose, phone);
  const prev = otpStore.get(key);
  if (prev && Date.now() - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - prev.sentAt)) / 1000);
    const err = new Error(`تا ارسال مجدد کد ${wait} ثانیه صبر کنید`);
    err.status = 429; err.retryAfter = wait; throw err;
  }
  if (!hourlyAllowed(phone)) {
    const err = new Error('تعداد درخواست کد بیش از حد مجاز — کمی بعد تلاش کنید');
    err.status = 429; throw err;
  }
  const code = genOtp();
  const info = await sendOtpSms(phone, code);
  hourlyMark(phone);
  otpStore.set(key, { code, exp: Date.now() + OTP_TTL_MS, tries: 0, sentAt: Date.now(), payload: payload || null });
  return { code, info };
}

/* ─── بررسی کد ─── */
function checkOtp(purpose, phone, code) {
  const key = otpKey(purpose, phone);
  const rec = otpStore.get(key);
  if (!rec)                 return { ok: false, status: 400, error: 'کدی برای این شماره ارسال نشده — دوباره درخواست کنید' };
  if (rec.exp < Date.now()) { otpStore.delete(key); return { ok: false, status: 410, error: 'کد منقضی شده — کد جدید بگیرید' }; }
  if (rec.tries >= OTP_MAX_ATTEMPTS) { otpStore.delete(key); return { ok: false, status: 429, error: 'تعداد تلاش بیش از حد — کد جدید بگیرید' }; }
  if (!safeEqual(String(code || '').trim(), rec.code)) {
    rec.tries++;
    return { ok: false, status: 401, error: `کد وارد شده اشتباه است (${OTP_MAX_ATTEMPTS - rec.tries} تلاش باقی مانده)` };
  }
  otpStore.delete(key);            /* کد یک‌بارمصرف است */
  return { ok: true, payload: rec.payload };
}

/* ═══ ۱) درخواست کد ═══
   purpose = 'register'  → اعتبارسنجی کامل فرم ثبت‌نام و نگه‌داشتن اطلاعات
   purpose = 'reset'     → فقط شماره؛ باید از قبل حساب داشته باشد          */
app.post('/api/auth/otp/send', async (req, res) => {
  try {
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
    const phone = String(req.body.phone || '').trim();
    if (!/^09[0-9]{9}$/.test(phone)) return res.status(400).json({ error: 'فرمت شماره اشتباه است' });

    let payload = null;

    if (purpose === 'register') {
      const { password, firstName, lastName } = req.body;
      if (!password || password.length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر' });
      const nameErr = validateNameServer(firstName, lastName);
      if (nameErr) return res.status(400).json({ error: nameErr });
      if (db.get('users').find({ phone }).value())
        return res.status(409).json({ error: 'این شماره قبلاً ثبت شده — وارد شوید' });
      /* ── بررسی تکراری بودن نام و نام خانوادگی ── */
      if (fullNameTaken(firstName, lastName))
        return res.status(409).json({ code: 'NAME_TAKEN',
          error: 'این نام و نام خانوادگی قبلاً ثبت شده است — لطفاً نام دیگری وارد کنید' });
      payload = {
        phone,
        password: await bcrypt.hash(password, 10),   /* رمز پیش از ذخیره در حافظه هش می‌شود */
        firstName: String(firstName || '').trim(),
        lastName:  String(lastName  || '').trim(),
      };
    } else {
      /* ── فراموشی رمز: اگر شماره حساب ندارد، اصلاً پیامک نفرست ── */
      const u = db.get('users').find({ phone }).value();
      if (!u) return res.status(404).json({ code: 'NO_ACCOUNT',
        error: 'این شماره حساب کاربری ندارد — ابتدا ثبت‌نام کنید' });
      if (u.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است. با پشتیبانی تماس بگیرید.' });
    }

    const { code } = await issueOtp(purpose, phone, payload);
    res.json({
      success: true, phone, purpose,
      length: OTP_LEN, ttl: Math.floor(OTP_TTL_MS / 1000), resendIn: Math.floor(OTP_RESEND_MS / 1000),
      ...(OTP_DEV_MODE ? { devCode: code } : {}),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) });
  }
});

/* ═══ ۲) بررسی کد ═══
   register → حساب ساخته می‌شود و توکن ورود برمی‌گردد
   reset    → یک توکن کوتاه‌مدت برای تعیین رمز جدید برمی‌گردد */
app.post('/api/auth/otp/verify', async (req, res) => {
  try {
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'register';
    const phone = String(req.body.phone || '').trim();
    const r = checkOtp(purpose, phone, req.body.code);
    if (!r.ok) return res.status(r.status).json({ error: r.error });

    if (purpose === 'reset') {
      const u = db.get('users').find({ phone }).value();
      if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
      const rt = crypto.randomBytes(24).toString('hex');
      resetTokens.set(rt, { phone, exp: Date.now() + RESET_TTL_MS });
      return res.json({ success: true, resetToken: rt, ttl: Math.floor(RESET_TTL_MS / 1000) });
    }

    /* ثبت‌نام — تازه حالا کاربر ساخته می‌شود */
    const p = r.payload;
    if (!p) return res.status(400).json({ error: 'اطلاعات ثبت‌نام یافت نشد — دوباره تلاش کنید' });
    if (db.get('users').find({ phone }).value())
      return res.status(409).json({ error: 'این شماره در این فاصله ثبت شد — وارد شوید' });
    if (fullNameTaken(p.firstName, p.lastName))
      return res.status(409).json({ code: 'NAME_TAKEN', error: 'این نام و نام خانوادگی قبلاً ثبت شده است' });

    const user = {
      id: uuidv4(), phone, password: p.password,
      firstName: p.firstName, lastName: p.lastName,
      isAdmin: false, phoneVerified: true,
      createdAt: nowIso(), purchases: [],
    };
    await db.get('users').push(user).write();
    const token = jwt.sign({ id: user.id, phone, isAdmin: false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: {
      id: user.id, phone, firstName: user.firstName, lastName: user.lastName,
      isAdmin: false, purchases: [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ ۳) تعیین رمز جدید (پس از تایید کد در فلوی فراموشی رمز) ═══ */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { resetToken, password } = req.body;
    const rec = resetTokens.get(String(resetToken || ''));
    if (!rec || rec.exp < Date.now()) {
      resetTokens.delete(String(resetToken || ''));
      return res.status(401).json({ error: 'مهلت تعیین رمز تمام شد — از ابتدا تلاش کنید' });
    }
    if (!password || password.length < 6) return res.status(400).json({ error: 'رمز حداقل ۶ کاراکتر' });
    const u = db.get('users').find({ phone: rec.phone }).value();
    if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
    const hashed = await bcrypt.hash(password, 10);
    await db.get('users').find({ phone: rec.phone })
      .assign({ password: hashed, phoneVerified: true }).write();
    resetTokens.delete(resetToken);
    const token = jwt.sign({ id: u.id, phone: u.phone, isAdmin: u.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: {
      id: u.id, phone: u.phone, firstName: u.firstName || '', lastName: u.lastName || '',
      isAdmin: u.isAdmin, purchases: u.purchases || [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AUTH
/* ─── مسیر قدیمی ثبت‌نام — بسته شده ───
   اگر باز بماند، هر کسی می‌تواند با یک درخواست مستقیم بدون تایید
   شماره حساب بسازد و کل مرحله‌ی کد پیامکی را دور بزند.
   ثبت‌نام فقط از مسیر otp/send → otp/verify انجام می‌شود.
   (کاربری که هنوز نسخه‌ی قدیمی صفحه در کشِ مرورگرش است، این پیام
   را می‌بیند و با یک رفرش نسخه‌ی جدید را می‌گیرد.) */
app.post('/api/auth/register', (req, res) => {
  res.status(410).json({
    code: 'USE_OTP',
    error: 'ثبت‌نام نیازمند تایید شماره موبایل است — لطفاً صفحه را رفرش کنید و دوباره تلاش کنید',
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = db.get('users').find({ phone }).value();
    if (!user) return res.status(404).json({ error: 'کاربر یافت نشد — ابتدا ثبت‌نام کنید' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'رمز اشتباه' });
    if (user.banned) return res.status(403).json({ error: 'حساب شما مسدود شده است. با پشتیبانی تماس بگیرید.' });
    const token = jwt.sign({ id: user.id, phone, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, phone, firstName: user.firstName||'', lastName: user.lastName||'', isAdmin: user.isAdmin, purchases: user.purchases } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = db.get('users').find({ id: req.user.id }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json({ id: u.id, phone: u.phone, firstName: u.firstName||'', lastName: u.lastName||'', isAdmin: u.isAdmin, purchases: u.purchases, createdAt: u.createdAt, termsAccepted: !!u.termsAccepted, termsAcceptedAt: u.termsAcceptedAt||null });
});

app.put('/api/auth/profile', auth, async (req, res) => {
  const { firstName, lastName } = req.body;
  const nameErr = validateNameServer(firstName, lastName);
  if (nameErr) return res.status(400).json({ error: nameErr });
  if (fullNameTaken(firstName, lastName, req.user.id))
    return res.status(409).json({ code: 'NAME_TAKEN', error: 'این نام و نام خانوادگی قبلاً ثبت شده است — لطفاً نام دیگری وارد کنید' });
  await db.get('users').find({ id: req.user.id }).assign({ firstName: (firstName||'').trim(), lastName: (lastName||'').trim() }).write();
  res.json({ success: true });
});

// PRODUCTS
app.get('/api/products', async (req, res) => {
  let p = db.get('products').value();
  const { type, q, featured } = req.query;
  if (type && type !== 'all') p = p.filter(x => x.type === type);
  if (featured === 'true') p = p.filter(x => x.featured);
  if (q) p = p.filter(x => x.title.includes(q) || x.description?.includes(q) || x.tags?.some(t => t.includes(q)));
  res.json(lightProducts(p));
});

app.get('/api/products/:id', async (req, res) => {
  const p = db.get('products').find({ id: req.params.id }).value();
  if (!p) return res.status(404).json({ error: 'محصول یافت نشد' });
  res.json(lightProduct(p));
});

app.get('/api/qr/:qrPage', async (req, res) => {
  const prod = db.get('products').value().find(p => p.qrPage === req.params.qrPage || p.id === req.params.qrPage);
  if (prod) return res.json({ found: true, productId: prod.id, title: prod.title, price: prod.price });
  res.status(404).json({ found: false, error: 'محصولی با این QR یافت نشد' });
});

// REVIEWS
app.get('/api/reviews/:productId', async (req, res) => {
  const reviews = db.get('reviews').filter({ productId: req.params.productId }).value();
  const enriched = reviews.map(r => {
    const u = db.get('users').find({ id: r.userId }).value();
    return { ...r, userName: u ? (`${u.firstName||''} ${u.lastName||''}`.trim() || u.phone) : 'کاربر' };
  });
  res.json(enriched);
});

app.post('/api/reviews/:productId', auth, async (req, res) => {
  const { text, rating } = req.body;
  if (!text || text.trim().length < 5) return res.status(400).json({ error: 'نظر باید حداقل ۵ کاراکتر باشد' });
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'امتیاز ۱ تا ۵' });
  if (db.get('reviews').find({ productId: req.params.productId, userId: req.user.id }).value()) return res.status(409).json({ error: 'قبلاً نظر ثبت کرده‌اید' });
  const review = { id: uuidv4(), productId: req.params.productId, userId: req.user.id, text: text.trim(), rating: parseInt(rating), createdAt: new Date().toISOString() };
  await db.get('reviews').push(review).write();
  const allRevs = db.get('reviews').filter({ productId: req.params.productId }).value();
  const avg = allRevs.reduce((s,r) => s+r.rating, 0) / allRevs.length;
  await db.get('products').find({ id: req.params.productId }).assign({ rating: Math.round(avg*10)/10, reviewCount: allRevs.length }).write();
  const u = db.get('users').find({ id: req.user.id }).value();
  res.json({ ...review, userName: `${u.firstName||''} ${u.lastName||''}`.trim() || u.phone });
});

// SEARCH
app.post('/api/search', async (req, res) => {
  const { q, mode } = req.body;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'عبارت جستجو کوتاه است' });
  const products = db.get('products').value();
  const articles = db.get('articles').value();
  if (mode === 'ai') {
    const ctx = articles.map(a => `## ${a.title}\n${a.content}\nتگ: ${a.tags.join(', ')}`).join('\n\n');
    let answer = '';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY||'','anthropic-version':'2023-06-01'}, body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:400, system:`متخصص عایق‌بندی ساختمان ایرانی. پاسخ فارسی مختصر:\n\n${ctx}`, messages:[{role:'user',content:q}] }) });
      if (r.ok) { const d = await r.json(); answer = d.content?.[0]?.text || ''; }
    } catch {}
    if (!answer) {
      const words = q.split(/\s+/).filter(w=>w.length>2);
      const scored = articles.map(a => ({...a, s: words.reduce((s,w) => s+(a.title.includes(w)?3:0)+(a.content.includes(w)?1:0)+(a.tags.some(t=>t.includes(w))?2:0),0)})).sort((a,b)=>b.s-a.s);
      answer = scored[0]?.s > 0 ? scored[0].content.substring(0,350)+'...' : 'اطلاعات مرتبط یافت نشد.';
    }
    const words = q.split(/\s+/).filter(w=>w.length>2);
    const related = products.filter(p => p.tags?.some(t => words.some(k => t.includes(k)||k.includes(t)))).slice(0,4);
    res.json({ mode:'ai', answer, relatedProducts: related });
  } else {
    const matchP = products.filter(p => p.title.includes(q)||p.description?.includes(q)||p.tags?.some(t=>t.includes(q)||q.includes(t)));
    const matchA = articles.filter(a => a.title.includes(q)||a.content.includes(q)||a.tags?.some(t=>t.includes(q)||q.includes(t)));
    res.json({ mode:'general', products: matchP, articles: matchA, total: matchP.length+matchA.length });
  }
});

// ORDERS
app.post('/api/orders/create', auth, async (req, res) => {
  const { productId } = req.body;
  const product = db.get('products').find({ id: productId }).value();
  if (!product) return res.status(404).json({ error: 'محصول یافت نشد' });
  const user = db.get('users').find({ id: req.user.id }).value();
  if (user.purchases?.includes(productId)) return res.status(409).json({ error: 'قبلاً خریده‌اید' });
  const disc = product.discount ? Math.round(product.price*(1-product.discount/100)) : product.price;
  const order = { id: uuidv4(), userId: req.user.id, productId, productTitle: product.title, productType: product.type, amount: disc, status: 'pending', createdAt: new Date().toISOString() };
  await db.get('orders').push(order).write();
  res.json({ success: true, orderId: order.id, amount: disc, product });
});

app.post('/api/orders/pay/:orderId', auth, async (req, res) => {
  const order = db.get('orders').find({ id: req.params.orderId, userId: req.user.id }).value();
  if (!order) return res.status(404).json({ error: 'سفارش یافت نشد' });
  // Simulate occasional failures for demo
  const simulateFail = req.body.simulateFail;
  const status = simulateFail ? 'failed' : 'paid';
  await db.get('orders').find({ id: req.params.orderId }).assign({ status, paidAt: new Date().toISOString(), paymentRef: status==='paid'?'SIM-'+Math.random().toString(36).substring(2,10).toUpperCase():null }).write();
  if (status === 'paid') {
    const u = db.get('users').find({ id: req.user.id }).value();
    const purchases = Array.isArray(u.purchases) ? u.purchases.slice() : [];
    if (!purchases.includes(order.productId)) purchases.push(order.productId);
    await await db.get('users').find({ id: req.user.id }).assign({ purchases }).write();
  }
  res.json({ success: status==='paid', message: status==='paid'?'پرداخت موفق':'پرداخت ناموفق', productId: order.productId });
});

app.get('/api/orders/my', auth, async (req, res) => {
  const orders = db.get('orders').filter({ userId: req.user.id, status: 'paid' }).value();
  /* Fix 3: chronological — most recent purchase first (descending) */
  const sorted = [...orders].sort((a, b) => {
    const ta = new Date(a.paidAt || a.createdAt || 0).getTime();
    const tb = new Date(b.paidAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  res.json(sorted.map(o => ({ ...o, product: lightProduct(db.get('products').find({ id: o.productId }).value()) })));
});

// ─── TERMS ACCEPTANCE ───
app.post('/api/terms/accept', auth, async (req, res) => {
  const u = db.get('users').find({ id: req.user.id }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  db.get('users').find({ id: req.user.id })
    .assign({ termsAccepted: true, termsAcceptedAt: new Date().toISOString() }).write();
  res.json({ success: true, termsAcceptedAt: new Date().toISOString() });
});

// ─── FILE DOWNLOAD (purchased products) ───
app.get('/api/download/:productId', auth, async (req, res) => {
  const product = db.get('products').find({ id: req.params.productId }).value();
  if (!product) return res.status(404).json({ error: 'محصول یافت نشد' });
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user?.purchases?.includes(req.params.productId))
    return res.status(403).json({ error: 'این محصول را خریداری نکرده‌اید' });

  /* Preferred path: file stored on disk → stream it (memory-efficient) */
  if (product.filePath) {
    const abs = path.join(__dirname, product.filePath);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      res.setHeader('Content-Type', product.fileMime || 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `attachment; filename="${encodeURIComponent(product.fileName || (product.id+'.bin'))}"`);
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(abs).pipe(res);
    }
  }
  /* Legacy fallback: product still has inline base64 fileData */
  if (product.fileData) {
    const m = /^data:(.+?);base64,(.*)$/.exec(product.fileData);
    if (m) {
      const buf = Buffer.from(m[2], 'base64');
      res.setHeader('Content-Type', m[1] || 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `attachment; filename="${encodeURIComponent(product.fileName||'download')}"`);
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    }
  }
  /* Placeholder: synthesize a sized buffer so progress metrics are real.
     Use the product's declared fileName/extension if available — never
     force .pdf. */
  const sizeMB = product.fileSizeMB || 12;
  const buf = Buffer.alloc(sizeMB * 1024 * 1024, 0x20);
  Buffer.from(`Thermal Book — ${product.title}\n(نمونه فایل دیجیتال)\n`, 'utf8').copy(buf);
  const fallbackName = product.fileName || ((product.id || 'file') + '.txt');
  res.setHeader('Content-Type', product.fileMime || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="${encodeURIComponent(fallbackName)}"`);
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

// RECOMMENDATIONS
app.get('/api/recommendations', auth, async (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  const purchases = user?.purchases || [];
  const allProds = db.get('products').value();
  const boughtTags = purchases.flatMap(pid => allProds.find(x=>x.id===pid)?.tags||[]);
  const remaining = allProds.filter(p => !purchases.includes(p.id));
  const scored = remaining.map(p => ({...p, score:(p.tags||[]).filter(t=>boughtTags.includes(t)).length})).sort((a,b)=>b.score-a.score);
  res.json(lightProducts(scored.slice(0,6)));
});

// ─── SUPPORT TICKETS (threaded chat) ───
/* sanitize: strip dangerous control chars, keep newlines/punctuation/unicode,
   clamp to `max` chars. */
function sanitizeMsg(s, max = 2000){
  if(typeof s!=='string')return '';
  /* remove only dangerous control characters, keep newlines/tabs + all
     printable punctuation and unicode */
  let out=s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');
  return out.slice(0, max);
}
const TICKET_STATUSES = ['pending','answered','waiting','closed'];

/* بازگرداندن تیکت به مدل گفتگوی نخ‌دار:
   اگر تیکت قدیمی فقط message/adminReply داشت، آن را به messages تبدیل می‌کند.
   روی آبجکت کش اثر می‌گذارد تا تیکت‌های قدیمی هم چت‌محور شوند. */
function normalizeTicket(t){
  if(!t)return t;
  if(!Array.isArray(t.messages) || t.messages.length===0){
    const msgs=[];
    if(t.message)    msgs.push({ id: uuidv4(), sender:'user',  text: t.message,    image: t.image||null, createdAt: t.createdAt });
    if(t.adminReply) msgs.push({ id: uuidv4(), sender:'admin', text: t.adminReply, image: null,          createdAt: t.repliedAt || t.createdAt });
    t.messages = msgs;
  }
  if(t.status==='open')   t.status='pending';
  return t;
}
function appendMessage(t, sender, text, image){
  if(!Array.isArray(t.messages)) t.messages=[];
  const msg={ id: uuidv4(), sender, text: text||'', image: image||null, createdAt: new Date().toISOString() };
  t.messages.push(msg);
  return msg;
}
/* validate an optional uploaded image; returns path | null,
   or sends 400 and returns false on a bad file */
function ticketImagePath(req, res){
  if(!req.file) return null;
  if(!/^image\//.test(req.file.mimetype)){
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: 'فقط فایل تصویری مجاز است' });
    return false;
  }
  return `/uploads/${req.file.filename}`;
}

/* user submits a NEW ticket (first message + optional image) */
app.post('/api/tickets', auth, upload.single('image'), async (req, res) => {
  const u = db.get('users').find({ id: req.user.id }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const subject = (req.body.subject || '').trim().slice(0, 120);
  const message = sanitizeMsg(req.body.message || '', 250);
  if (!subject)  return res.status(400).json({ error: 'موضوع الزامی است' });
  if (!message)  return res.status(400).json({ error: 'متن پیام الزامی است' });

  const imagePath = ticketImagePath(req, res);
  if (imagePath === false) return;

  const now = new Date().toISOString();
  const ticket = {
    id: uuidv4(),
    userId: u.id,
    userName: ((u.firstName||'') + ' ' + (u.lastName||'')).trim() || 'کاربر',
    userPhone: u.phone,
    subject,
    status: 'pending',                 /* pending | answered | waiting */
    messages: [{ id: uuidv4(), sender: 'user', text: message, image: imagePath, createdAt: now }],
    /* legacy columns kept populated for backward compatibility */
    message, image: imagePath, adminReply: null,
    createdAt: now,
    repliedAt: now
  };
  await db.get('tickets').push(ticket).write();
  res.json({ success: true, ticket });
});

/* user lists their own tickets (newest activity first, full thread) */
app.get('/api/tickets/my', auth, async (req, res) => {
  const mine = db.get('tickets').filter({ userId: req.user.id }).value();
  const sorted = [...mine].map(normalizeTicket)
    .sort((a,b)=>new Date(b.repliedAt||b.createdAt)-new Date(a.repliedAt||a.createdAt));
  res.json(sorted);
});

/* user fetches a single ticket they own (chat view) */
app.get('/api/tickets/:id', auth, async (req, res) => {
  const t = db.get('tickets').find({ id: req.params.id }).value();
  if (!t || t.userId !== req.user.id) return res.status(404).json({ error: 'تیکت یافت نشد' });
  res.json(normalizeTicket(t));
});

/* user posts a reply into their ticket thread (optional image) */
app.post('/api/tickets/:id/messages', auth, upload.single('image'), async (req, res) => {
  const t = db.get('tickets').find({ id: req.params.id }).value();
  if (!t || t.userId !== req.user.id) return res.status(404).json({ error: 'تیکت یافت نشد' });
  /* a closed ticket is fully locked — no new messages from anyone */
  if (t.status === 'closed') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'این تیکت بسته شده است و امکان ارسال پیام وجود ندارد' });
  }
  const text = sanitizeMsg(req.body.message || '', 250);
  const imagePath = ticketImagePath(req, res);
  if (imagePath === false) return;
  if (!text && !imagePath) return res.status(400).json({ error: 'متن پیام الزامی است' });
  normalizeTicket(t);
  appendMessage(t, 'user', text, imagePath);
  const repliedAt = new Date().toISOString();
  /* a user reply puts the ball back in support's court */
  await db.get('tickets').find({ id: req.params.id })
    .assign({ messages: t.messages, status: 'pending', repliedAt }).write();
  res.json({ success: true, ticket: t });
});

/* admin: list all tickets (newest activity first) */
app.get('/api/admin/tickets', adminAuth, async (req, res) => {
  const all = db.get('tickets').value().map(normalizeTicket);
  const sorted = [...all].sort((a,b)=>new Date(b.repliedAt||b.createdAt)-new Date(a.repliedAt||a.createdAt));
  res.json(sorted);
});

/* admin: fetch one ticket (full thread) */
app.get('/api/admin/tickets/:id', adminAuth, async (req, res) => {
  const t = db.get('tickets').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  res.json(normalizeTicket(t));
});

/* admin: post a reply into the thread (optional image) */
app.post('/api/admin/tickets/:id/messages', adminAuth, upload.single('image'), async (req, res) => {
  const t = db.get('tickets').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  /* a closed ticket is locked — admin must reopen it before replying */
  if (t.status === 'closed') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'تیکت بسته است — برای پاسخ ابتدا آن را بازگشایی کنید' });
  }
  const text = sanitizeMsg(req.body.message || '', 2000);
  const imagePath = ticketImagePath(req, res);
  if (imagePath === false) return;
  if (!text && !imagePath) return res.status(400).json({ error: 'متن پاسخ الزامی است' });
  normalizeTicket(t);
  appendMessage(t, 'admin', text, imagePath);
  /* an admin reply marks the ticket answered unless an explicit status is sent */
  let status = 'answered';
  if (req.body.status && TICKET_STATUSES.includes(req.body.status)) status = req.body.status;
  const repliedAt = new Date().toISOString();
  await db.get('tickets').find({ id: req.params.id })
    .assign({ messages: t.messages, status, adminReply: text || t.adminReply, repliedAt }).write();
  res.json({ success: true, ticket: t });
});

/* admin: change ticket status only (pending | answered | waiting) */
app.put('/api/admin/tickets/:id', adminAuth, async (req, res) => {
  const t = db.get('tickets').find({ id: req.params.id }).value();
  if (!t) return res.status(404).json({ error: 'تیکت یافت نشد' });
  const patch = {};
  /* backward-compat: a plain adminReply becomes an admin message */
  if (req.body.adminReply !== undefined && req.body.adminReply !== null && String(req.body.adminReply).trim()){
    normalizeTicket(t);
    appendMessage(t, 'admin', sanitizeMsg(req.body.adminReply, 2000), null);
    patch.messages = t.messages;
    patch.adminReply = sanitizeMsg(req.body.adminReply, 2000);
    patch.status = 'answered';
  }
  if (req.body.status){
    let s = req.body.status;
    if (s==='open') s='pending';
    if (TICKET_STATUSES.includes(s)) patch.status = s;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'تغییری ارسال نشد' });
  patch.repliedAt = new Date().toISOString();
  await db.get('tickets').find({ id: req.params.id }).assign(patch).write();
  res.json({ success: true });
});

// ADMIN
/* top-selling product by aggregate paid-order volume (all-time) */
function topSellingProduct() {
  const paid = db.get('orders').value().filter(o => o.status === 'paid');
  const agg = {};
  paid.forEach(o => {
    const k = o.productId || 'unknown';
    if (!agg[k]) agg[k] = { productId: k, count: 0, revenue: 0, title: o.productTitle || '' };
    agg[k].count++; agg[k].revenue += (o.amount || 0);
  });
  let top = null;
  for (const k in agg) if (!top || agg[k].count > top.count) top = agg[k];
  if (top) { const p = db.get('products').find({ id: top.productId }).value(); if (p) top.title = p.title; }
  return top;
}

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const allOrders = db.get('orders').value();
  const paidAll = allOrders.filter(o => o.status==='paid');
  const failed = allOrders.filter(o => o.status==='failed');
  const pending = allOrders.filter(o => o.status==='pending');
  /* revenue respects the reset marker; order counts do not */
  const resetAt = revenueResetAt();
  const paidRev = resetAt ? paidAll.filter(o => o.paidAt && new Date(o.paidAt) >= resetAt) : paidAll;
  const today = new Date().toDateString();
  const todayPaid = paidRev.filter(o => o.paidAt && new Date(o.paidAt).toDateString()===today);
  res.json({
    totalUsers: db.get('users').value().length,
    totalOrders: paidAll.length,
    failedOrders: failed.length,
    pendingOrders: pending.length,
    totalRevenue: paidRev.reduce((s,o)=>s+(o.amount||0),0),
    todayOrders: todayPaid.length,
    todayRevenue: todayPaid.reduce((s,o)=>s+(o.amount||0),0),
    revenueResetAt: resetAt ? resetAt.toISOString() : null,
    topProduct: topSellingProduct()
  });
});

/* ─── تحلیل درآمد برای مودال داشبورد ─── */
app.get('/api/admin/revenue', adminAuth, async (req, res) => {
  const resetAt = revenueResetAt();
  const now = new Date();
  let paid = db.get('orders').value().filter(o => o.status==='paid' && o.paidAt);
  if (resetAt) paid = paid.filter(o => new Date(o.paidAt) >= resetAt);
  const sum = arr => arr.reduce((s,o)=>s+(o.amount||0),0);
  const since = d => paid.filter(o => new Date(o.paidAt) >= d);
  const last7   = new Date(now.getTime() - 7*24*3600*1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart  = new Date(now.getFullYear(), 0, 1);
  const todayStr = now.toDateString();
  res.json({
    total:      sum(paid),
    today:      sum(paid.filter(o => new Date(o.paidAt).toDateString()===todayStr)),
    last7Days:  sum(since(last7)),
    thisMonth:  sum(since(monthStart)),
    thisYear:   sum(since(yearStart)),
    orderCount: paid.length,
    resetAt:    resetAt ? resetAt.toISOString() : null,
    topProduct: topSellingProduct()
  });
});

/* ریست درآمد انباشته — فقط نقطهٔ صفر را جابه‌جا می‌کند (سفارش‌ها حذف نمی‌شوند) */
app.post('/api/admin/revenue/reset', adminAuth, async (req, res) => {
  try {
    const at = new Date().toISOString();
    fs.writeFileSync(REVENUE_FLAG, at);
    res.json({ success: true, resetAt: at });
  } catch (e) {
    res.status(500).json({ error: 'خطا در ریست درآمد' });
  }
});

/* ─── حالت تعمیر — وضعیت و تغییر ─── */
app.get('/api/admin/maintenance', adminAuth, async (req, res) => {
  res.json({ maintenance: isMaintenance() });
});
app.put('/api/admin/maintenance', adminAuth, async (req, res) => {
  const on = req.body.enabled === true;
  try {
    if (on) {
      fs.writeFileSync(MAINT_FLAG, new Date().toISOString());
    } else if (fs.existsSync(MAINT_FLAG)) {
      fs.unlinkSync(MAINT_FLAG);
    }
    res.json({ success: true, maintenance: on });
  } catch (e) {
    res.status(500).json({ error: 'خطا در تغییر وضعیت' });
  }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const { status } = req.query;
  let orders = db.get('orders').value().slice(-100).reverse();
  if (status && status !== 'all') orders = orders.filter(o => o.status === status);
  res.json(orders.map(o => ({...o, userPhone: db.get('users').find({id:o.userId}).value()?.phone, userName: (() => { const u = db.get('users').find({id:o.userId}).value(); return u ? (`${u.firstName||''} ${u.lastName||''}`.trim()||u.phone) : '—'; })() })));
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const { q } = req.query;
  let users = db.get('users').value();
  if (q) users = users.filter(u => u.phone.includes(q)||(u.firstName||'').includes(q)||(u.lastName||'').includes(q));
  res.json(users.map(u => ({ id:u.id, phone:u.phone, firstName:u.firstName||'', lastName:u.lastName||'', isAdmin:u.isAdmin, banned:!!u.banned, createdAt:u.createdAt, purchaseCount:(u.purchases||[]).length, termsAccepted:!!u.termsAccepted, termsAcceptedAt:u.termsAcceptedAt||null })));
});

/* ─── Feature 4: مدیریت کاربران (ارتقا/تنزل نقش، مسدودسازی) ─── */
app.put('/api/admin/users/:id/role', adminAuth, async (req, res) => {
  const u = db.get('users').find({ id: req.params.id }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'نمی‌توانید نقش خودتان را تغییر دهید' });
  const makeAdmin = req.body.isAdmin === true;
  await db.get('users').find({ id: req.params.id }).assign({ isAdmin: makeAdmin }).write();
  res.json({ success: true, isAdmin: makeAdmin });
});

app.put('/api/admin/users/:id/ban', adminAuth, async (req, res) => {
  const u = db.get('users').find({ id: req.params.id }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'نمی‌توانید خودتان را مسدود کنید' });
  const banned = req.body.banned === true;
  await db.get('users').find({ id: req.params.id }).assign({ banned }).write();
  res.json({ success: true, banned });
});

app.post('/api/admin/make-admin', async (req, res) => {
  const { phone, secret } = req.body;
  if (secret !== (process.env.ADMIN_SECRET||'thermal2024admin')) return res.status(403).json({ error: 'رمز اشتباه' });
  const u = db.get('users').find({ phone }).value();
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  await db.get('users').find({ phone }).assign({ isAdmin: true }).write();
  res.json({ success: true });
});

app.put('/api/admin/products/:id', adminAuth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]),
  async (req, res) => {
  const existing = db.get('products').find({ id: req.params.id }).value();
  if (!existing) return res.status(404).json({ error: 'محصول یافت نشد' });
  const b = req.body || {};
  const patch = {};

  /* scalar fields — only apply the ones actually sent */
  ['title','description','type','qrPage'].forEach(k => {
    if (b[k] !== undefined) patch[k] = (b[k] || '').trim() || null;
  });
  ['price','originalPrice','discount','chapterNum','pages','freePages'].forEach(k => {
    if (b[k] !== undefined) patch[k] = parseInt(b[k]) || (k==='price'?0:null);
  });
  if (b.tags !== undefined)
    patch.tags = (b.tags || '').split(/[,،]/).map(t => t.trim()).filter(Boolean);
  if (b.featured !== undefined) patch.featured = parseMaybe(b.featured) === true;

  /* new image (multipart) → write, drop old uploaded image */
  const imgFile = req.files?.image?.[0];
  if (imgFile) {
    if (!/^image\//.test(imgFile.mimetype)) {
      fs.unlink(imgFile.path, () => {});
      return res.status(400).json({ error: 'فایل تصویر معتبر نیست' });
    }
    if ((existing.image||'').startsWith('/uploads/'))
      { try { fs.unlinkSync(path.join(__dirname, existing.image.slice(1))); } catch {} }
    patch.image = `/uploads/${imgFile.filename}`;
  } else if (typeof b.image === 'string' && b.image.startsWith('data:')) {
    const m = /^data:image\/(\w+);base64,(.*)$/.exec(b.image);
    if (m) {
      const fn = `img_${req.params.id}_${Date.now()}.${m[1]==='jpeg'?'jpg':m[1]}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fn), Buffer.from(m[2], 'base64'));
      patch.image = `/uploads/${fn}`;
    }
  }

  /* new downloadable file (multipart, any ext) → write, drop old file */
  const digFile = req.files?.file?.[0];
  if (digFile) {
    if (existing.filePath)
      { try { fs.unlinkSync(path.join(__dirname, existing.filePath)); } catch {} }
    patch.filePath   = `uploads/${digFile.filename}`;
    patch.fileName   = digFile.originalname;
    patch.fileMime   = digFile.mimetype || 'application/octet-stream';
    patch.fileSizeMB = Math.max(1, Math.round(digFile.size / 1048576 * 10) / 10);
  }
  /* if no new file → existing one is left untouched */

  await db.get('products').find({ id: req.params.id }).assign(patch).write();
  res.json({ success: true });
});

/* helper: parse a value that may arrive as a string (multipart) or native */
function parseMaybe(v){
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

app.post('/api/admin/products', adminAuth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]),
  async (req, res) => {
  try {
    const b = req.body || {};
    const pid = uuidv4();
    const product = {
      id: pid,
      title: (b.title || '').trim(),
      description: (b.description || '').trim(),
      type: b.type || 'book',
      price: parseInt(b.price) || 0,
      originalPrice: parseInt(b.originalPrice) || null,
      discount: parseInt(b.discount) || 0,
      chapterNum: parseInt(b.chapterNum) || null,
      pages: parseInt(b.pages) || null,
      freePages: parseInt(b.freePages) || 0,
      qrPage: (b.qrPage || '').trim() || null,
      tags: (b.tags || '').split(/[,،]/).map(t => t.trim()).filter(Boolean),
      featured: parseMaybe(b.featured) === true,
      rating: 0, reviewCount: 0,
      createdAt: new Date().toISOString()
    };
    if (!product.title)  return res.status(400).json({ error: 'عنوان الزامی است' });
    if (!product.price)  return res.status(400).json({ error: 'قیمت الزامی است' });

    /* ── product image (multipart) ── */
    const imgFile = req.files?.image?.[0];
    if (imgFile) {
      if (!/^image\//.test(imgFile.mimetype)) {
        fs.unlink(imgFile.path, () => {});
        return res.status(400).json({ error: 'فایل تصویر معتبر نیست' });
      }
      product.image = `/uploads/${imgFile.filename}`;
    } else if (typeof b.image === 'string' && b.image.startsWith('data:')) {
      /* legacy base64 fallback */
      const m = /^data:image\/(\w+);base64,(.*)$/.exec(b.image);
      if (m) {
        const fn = `img_${pid}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fn), Buffer.from(m[2], 'base64'));
        product.image = `/uploads/${fn}`;
      }
    } else {
      product.image = '';
    }

    /* ── downloadable digital file (multipart, ANY extension) ── */
    const digFile = req.files?.file?.[0];
    if (digFile) {
      product.filePath    = `uploads/${digFile.filename}`;
      product.fileName    = digFile.originalname;
      product.fileMime    = digFile.mimetype || 'application/octet-stream';
      product.fileSizeMB  = Math.max(1, Math.round(digFile.size / 1048576 * 10) / 10);
    } else if (typeof b.fileData === 'string' && b.fileData.startsWith('data:')) {
      /* legacy base64 fallback */
      const m = /^data:(.+?);base64,(.*)$/.exec(b.fileData);
      if (m) {
        const ext = (b.fileName && b.fileName.includes('.')) ? b.fileName.split('.').pop() : 'bin';
        const fn = `file_${pid}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fn), Buffer.from(m[2], 'base64'));
        product.filePath   = `uploads/${fn}`;
        product.fileName   = b.fileName || fn;
        product.fileMime   = m[1];
        product.fileSizeMB = parseInt(b.fileSizeMB) || 1;
      }
    }

    await db.get('products').push(product).write();
    res.json({ success: true, product: lightProduct(product) });
  } catch (e) {
    res.status(500).json({ error: 'خطا در ایجاد محصول' });
  }
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  const prod = db.get('products').find({ id: req.params.id }).value();
  /* clean up any files this product owns on disk */
  if (prod) {
    [prod.filePath, (prod.image||'').startsWith('/uploads/') ? prod.image.slice(1) : null]
      .filter(Boolean)
      .forEach(rel => { try { fs.unlinkSync(path.join(__dirname, rel)); } catch {} });
  }
  await db.get('products').remove({ id: req.params.id }).write();
  res.json({ success: true });
});

// ─── PRODUCT BUNDLES / PACKS ───
/* A bundle is stored as a product with type:'bundle' so it appears in the
   shop naturally, plus a bundleItems array of the contained product ids
   and a single custom price for the whole pack. */
app.post('/api/admin/bundles', adminAuth, upload.single('image'), async (req, res) => {
  const b = req.body || {};
  const title = (b.title || '').trim();
  const price = parseInt(b.price) || 0;
  let items = [];
  try { items = JSON.parse(b.items || '[]'); } catch { items = []; }
  items = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!title)            return res.status(400).json({ error: 'عنوان پکیج الزامی است' });
  if (!price || price<=0) return res.status(400).json({ error: 'قیمت پکیج الزامی است' });
  if (items.length < 2)  return res.status(400).json({ error: 'حداقل ۲ محصول برای پکیج لازم است' });

  /* validate the contained products exist */
  const all = db.get('products').value();
  const valid = items.filter(id => all.some(p => p.id === id));
  if (valid.length < 2) return res.status(400).json({ error: 'محصولات انتخاب‌شده معتبر نیستند' });

  const pid = uuidv4();
  let image = '';
  if (req.file && /^image\//.test(req.file.mimetype)) image = `/uploads/${req.file.filename}`;

  /* sum of individual prices — for showing the saving */
  const originalPrice = valid.reduce((s,id)=>{
    const p = all.find(x=>x.id===id); return s + (p ? (p.price||0) : 0);
  }, 0);

  const bundle = {
    id: pid,
    type: 'bundle',
    title,
    description: (b.description || '').trim(),
    price,
    originalPrice: originalPrice > price ? originalPrice : null,
    discount: originalPrice > price ? Math.round((1 - price/originalPrice) * 100) : 0,
    image,
    bundleItems: valid,
    featured: b.featured === 'true' || b.featured === true,
    tags: ['پکیج','مجموعه'],
    rating: 0, reviewCount: 0,
    createdAt: new Date().toISOString()
  };
  await db.get('products').push(bundle).write();
  res.json({ success: true, bundle: lightProduct(bundle) });
});

/* list bundles (admin) — products of type bundle, with their items resolved */
app.get('/api/admin/bundles', adminAuth, async (req, res) => {
  const all = db.get('products').value();
  const bundles = all.filter(p => p.type === 'bundle').map(bnd => ({
    ...lightProduct(bnd),
    items: (bnd.bundleItems||[]).map(id => {
      const p = all.find(x => x.id === id);
      return p ? { id:p.id, title:p.title, type:p.type, price:p.price } : null;
    }).filter(Boolean)
  }));
  res.json(bundles.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});

app.delete('/api/admin/bundles/:id', adminAuth, async (req, res) => {
  const bnd = db.get('products').find({ id: req.params.id, type:'bundle' }).value();
  if (!bnd) return res.status(404).json({ error: 'پکیج یافت نشد' });
  if ((bnd.image||'').startsWith('/uploads/'))
    { try { fs.unlinkSync(path.join(__dirname, bnd.image.slice(1))); } catch {} }
  await db.get('products').remove({ id: req.params.id }).write();
  res.json({ success: true });
});

/* ─── Feature 5: مدیریت نظرات (کامنت‌ها) ─── */
app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  const reviews = db.get('reviews').value();
  const enriched = reviews.map(r => {
    const u = db.get('users').find({ id: r.userId }).value();
    const p = db.get('products').find({ id: r.productId }).value();
    return {
      ...r,
      userName: u ? (`${u.firstName||''} ${u.lastName||''}`.trim() || u.phone) : 'کاربر',
      productTitle: p ? p.title : 'محصول حذف‌شده',
    };
  });
  enriched.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json(enriched);
});

app.delete('/api/admin/reviews/:id', adminAuth, async (req, res) => {
  const rev = db.get('reviews').find({ id: req.params.id }).value();
  if (!rev) return res.status(404).json({ error: 'نظر یافت نشد' });
  const pid = rev.productId;
  await db.get('reviews').remove({ id: req.params.id }).write();
  /* بازمحاسبه‌ی امتیاز محصول */
  const rest = db.get('reviews').filter({ productId: pid }).value();
  const avg = rest.length ? rest.reduce((s,r)=>s+r.rating,0)/rest.length : 0;
  await db.get('products').find({ id: pid }).assign({ rating: Math.round(avg*10)/10, reviewCount: rest.length }).write();
  res.json({ success: true });
});

app.put('/api/admin/reviews/:id/reply', adminAuth, async (req, res) => {
  const rev = db.get('reviews').find({ id: req.params.id }).value();
  if (!rev) return res.status(404).json({ error: 'نظر یافت نشد' });
  const reply = (req.body.reply || '').trim();
  await db.get('reviews').find({ id: req.params.id })
    .assign({ adminReply: reply, adminReplyAt: reply ? new Date().toISOString() : null }).write();
  res.json({ success: true, adminReply: reply });
});

/* ─── Multer error handler — clean messages for upload failures ─── */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: 'حجم فایل بیش از حد مجاز (۵۰ مگابایت) است' });
    return res.status(400).json({ error: 'خطا در آپلود فایل' });
  }
  if (err) return res.status(500).json({ error: 'خطای سرور' });
  next();
});

/* ─── داده‌های اولیه (فقط اگر جدول خالی باشد) ─── */
async function seedData() {
  if (db.get('products').value().length === 0) {
    const products = [
    { id:'prod_full_book', type:'book', featured:true, title:'گرمابندی ساختمان — نسخه کامل PDF', description:'۴۵۰ صفحه، ۱۲ فصل، ۳۰۰+ تصویر فنی با QR Code. جامع‌ترین مرجع گرمابندی ایران.', price:285000, originalPrice:350000, pages:450, chapters:12, tags:['گرمابندی','عایق','نظام مهندسی','کامل'], rating:4.8, reviewCount:47, image:'' },
    { id:'ch_01', type:'chapter', featured:true, chapterNum:1, title:'فصل ۱ — اصول عایق‌بندی حرارتی', description:'مفاهیم پایه، ضوابط نظام مهندسی، انواع مواد عایق', price:45000, pages:38, freePages:10, tags:['اصول','عایق','ضریب U'], rating:4.9, reviewCount:23, qrPage:'ch_01_p1', image:'' },
    { id:'ch_02', type:'chapter', chapterNum:2, title:'فصل ۲ — سیستم‌های گرمایشی HVAC', description:'تحلیل و طراحی سیستم‌های حرارتی، دیگ بخار، فن‌کویل، رادیاتور', price:45000, pages:42, tags:['HVAC','گرمایش','رادیاتور'], rating:4.7, reviewCount:18, qrPage:'ch_02_p1', image:'' },
    { id:'ch_03', type:'chapter', featured:true, chapterNum:3, title:'فصل ۳ — دیوارهای خارجی مرکب', description:'سیستم‌های ETICS، رویه‌های اجرایی، جزئیات گوشه', price:45000, pages:36, tags:['دیوار','ETICS','عایق خارجی'], rating:4.6, reviewCount:31, qrPage:'ch_03_p1', image:'' },
    { id:'ch_04', type:'chapter', chapterNum:4, title:'فصل ۴ — بخار بند و رطوبت', description:'کنترل رطوبت، کندانسیشن، لایه بخار بند', price:45000, pages:40, tags:['بخار بند','رطوبت','کندانس'], rating:4.8, reviewCount:15, qrPage:'ch_04_p1', image:'' },
    { id:'ch_05', type:'chapter', chapterNum:5, title:'فصل ۵ — سقف‌های تخت و شیب‌دار', description:'جزئیات اجرایی، waterproofing، عایق‌های سقفی', price:45000, pages:35, tags:['سقف','شیروانی','آب‌بندی'], rating:4.5, reviewCount:12, qrPage:'ch_05_p1', image:'' },
    { id:'detail_D01C163', type:'image', featured:true, title:'دتایل D01C163 — دیوار مرکب', description:'سکشن اجرایی کامل دیوار مرکب خارجی DWG+PDF با QR', price:18000, tags:['دیوار','پشم سنگ','دتایل'], qrCode:'D01C163', rating:4.9, reviewCount:8, qrPage:'detail_D01C163', image:'' },
    { id:'detail_D01C163c', type:'image', title:'دتایل D01C163c — سقف مرکب', description:'سکشن سه‌بعدی و پلان اجرایی سقف مرکب', price:18000, tags:['سقف','دتایل'], qrCode:'D01C163c', rating:4.6, reviewCount:5, qrPage:'detail_D01C163c', image:'' },
    { id:'art_condensation', type:'article', featured:true, title:'راه‌حل مشکلات کندانسیشن', description:'بررسی عوامل کندانس در دیوار و سقف', price:8000, pages:14, tags:['کندانس','رطوبت'], rating:4.8, reviewCount:21, image:'' },
    { id:'art_coldwall', type:'article', title:'چرا دیوار شمالی سرد است؟', description:'دلایل فنی و راه‌حل بهسازی', price:8000, pages:10, tags:['دیوار سرد','بهسازی'], rating:4.5, reviewCount:14, image:'' },
    { id:'art_uvalue', type:'article', title:'محاسبه ضریب U — راهنمای عملی', description:'محاسبه ضریب انتقال حرارت با مثال‌های عددی', price:8000, pages:12, tags:['ضریب U','محاسبه'], rating:4.7, reviewCount:19, image:'' },
  ];
    for (const p of products) await db.get('products').push(p).write();
  }
  if (db.get('articles').value().length === 0) {
    const articles = [
    { id:'kb1', title:'کندانسیشن و رطوبت', content:'کندانسیشن بخار آب درون جداره‌ها زمانی رخ می‌دهد که دما از نقطه شبنم پایین‌تر رود. راه‌حل: بخاربند پلی‌اتیلن در سمت گرم دیوار.', tags:['کندانس','رطوبت','بخار بند','دیوار'], relatedProducts:['ch_04','art_condensation'] },
    { id:'kb2', title:'ضریب U و عملکرد حرارتی', content:'ضریب U معیار ارزیابی عملکرد حرارتی است. حداکثر ضریب U دیوار خارجی ۰.۶ W/m²K طبق نظام مهندسی ایران.', tags:['ضریب U','محاسبه','انتقال حرارت'], relatedProducts:['art_uvalue','ch_01'] },
    { id:'kb3', title:'دیوار سرد و بهسازی', content:'علل: ضریب U بالا، پل حرارتی، نشت هوا. راه‌حل: عایق ETICS، درزگیری، رادیاتور زیر پنجره.', tags:['دیوار سرد','پل حرارتی','ETICS'], relatedProducts:['ch_03','art_coldwall'] },
    { id:'kb4', title:'عایق سقف', content:'۳۰٪ اتلاف حرارت از سقف. پلی‌استایرن ۱۰-۱۵ سانت برای سقف تخت. حداقل ۱۲ سانت مناطق سرد.', tags:['سقف','پلی‌استایرن','عایق سقف'], relatedProducts:['ch_05'] },
    { id:'kb5', title:'HVAC و گرمایش', content:'گرمایش از کف بهترین آسایش را دارد. رادیاتور زیر پنجره از سرما جلوگیری می‌کند.', tags:['HVAC','گرمایش از کف','رادیاتور'], relatedProducts:['ch_02'] },
  ];
    for (const a of articles) await db.get('articles').push(a).write();
  }
}

/* ─── راه‌اندازی سرور پس از اتصال به دیتابیس ─── */
/* ─── مسیرهای ناشناخته ───
   درخواست‌های API ناموجود → خطای JSON
   بقیه (صفحات) → صفحه ۴۰۴ با کد وضعیت صحیح */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'مسیر یافت نشد' });
  }
  res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'));
});

(async () => {
  try {
    await initDB({
      host:     process.env.DB_HOST || 'localhost',
      port:     process.env.DB_PORT || 3306,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      socketPath: process.env.DB_SOCKET || undefined,
    });
    console.log('✅ اتصال به دیتابیس MySQL برقرار شد');
    await seedData();
    app.listen(PORT, () => console.log(`\n🔥 http://localhost:${PORT}\n`));
  } catch (e) {
    console.error('❌ اتصال به دیتابیس ناموفق بود:', e.message);
    process.exit(1);
  }
})();