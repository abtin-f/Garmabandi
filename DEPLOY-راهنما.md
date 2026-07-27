# راهنمای راه‌اندازی روی هاست cPanel

## پیش‌نیاز: دیتابیس MySQL را در cPanel ساخته‌ای ✓

## مرحله ۱ — ساخت جدول‌ها
۱. در cPanel وارد **phpMyAdmin** شو
۲. دیتابیس `deeppeed_garmabandi` را از منوی سمت چپ انتخاب کن
۳. تب **Import** را بزن
۴. فایل `backend/schema.sql` را انتخاب و **Go** بزن
۵. باید ۶ جدول ساخته شود (users, products, orders, reviews, tickets, articles)

## مرحله ۲ — آپلود فایل‌ها
- کل پوشه پروژه را در مسیری خارج از `public_html` آپلود کن
- پوشه `node_modules` را آپلود نکن (خود سرور می‌سازد)

## مرحله ۳ — فایل .env
۱. فایل `backend/.env.example` را به نام `.env` کپی کن
۲. مقادیر را پر کن:
   - `DB_NAME` = deeppeed_garmabandi
   - `DB_USER` = deeppeed_garmin
   - `DB_PASS` = رمز دیتابیس که خودت ساختی
   - `DB_HOST` = localhost
   - `JWT_SECRET` = یک رشته تصادفی طولانی
   - `ADMIN_SECRET` = یک رمز جدید

## مرحله ۴ — Setup Node.js App
- Application root: مسیر پوشه backend
- Startup file: server.js
- Node version: 20 یا 22
- بعد: دکمه **Run NPM Install** را بزن

## مرحله ۵ — اجرا
دکمه **Start/Restart** را بزن. در logs باید ببینی:
`✅ اتصال به دیتابیس MySQL برقرار شد`

## نکات
- دیتابیس دیگر فایل db.json نیست — همه‌چیز در MySQL است
- فایل‌های آپلودی در پوشه backend/uploads ذخیره می‌شوند
- درگاه پرداخت هنوز شبیه‌سازی است — منتظر مرچنت‌کد زرین‌پال
