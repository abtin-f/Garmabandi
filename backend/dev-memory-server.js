/* ═══════════════════════════════════════════════════════════
   dev-memory-server.js — اجرای سرور با دیتابیس در حافظه
   ───────────────────────────────────────────────────────────
   فقط برای تست روی سیستم خودت وقتی MySQL محلی نداری.
   همان server.js را اجرا می‌کند ولی db-mysql را با یک نسخه‌ی
   ساده‌ی در حافظه جایگزین می‌کند. روی هاست استفاده نکن.

   اجرا:  node dev-memory-server.js
   ═══════════════════════════════════════════════════════════ */
const TABLES = ['users', 'products', 'orders', 'reviews', 'tickets', 'articles'];
const cache = {};
TABLES.forEach(t => cache[t] = []);

const matches = (row, q) => typeof q === 'function' ? q(row)
  : Object.keys(q).every(k => row[k] === q[k]);

function chain(table, items, single) {
  return {
    value: () => single ? (items[0] || null) : items,
    find(q) { const f = items.find(r => matches(r, q)); return chain(table, f ? [f] : [], true); },
    filter(q) { return chain(table, items.filter(r => matches(r, q)), false); },
    push(o) { cache[table].push(o); return { write: async () => o }; },
    assign(p) { return { write: async () => { items.forEach(r => Object.assign(r, p)); return items; } }; },
    remove(q) {
      const rm = items.filter(r => matches(r, q)), ids = rm.map(r => r.id);
      return { write: async () => { cache[table] = cache[table].filter(r => !ids.includes(r.id)); return rm; } };
    },
    size() { return { value: () => items.length }; },
  };
}
const db = { get: t => chain(t, cache[t] || [], false) };

/* جایگزینی ماژول db-mysql پیش از بارگذاری server.js */
const p = require.resolve('./db-mysql');
require.cache[p] = { id: p, filename: p, loaded: true, exports: { db, init: async () => true, TABLES } };

/* این سرور فقط برای تست است، پس کد تایید همیشه در پاسخ API برمی‌گردد.
   به‌طور پیش‌فرض پیامک واقعی فرستاده نمی‌شود؛ برای ارسال واقعی:
     node dev-memory-server.js --real-sms                        */
process.env.OTP_DEV_MODE = 'true';
if (!process.argv.includes('--real-sms')) process.env.SMS_API_KEY = '';

/* ─── داده‌ی نمونه برای تست پنل ادمین ───
   ورود ادمین:  09120000000 / admin123                          */
const bcrypt = require('bcryptjs');
const TYPES = ['book', 'chapter', 'image', 'article'];
cache.users.push({
  id: 'u-admin', phone: '09120000000', password: bcrypt.hashSync('admin123', 10),
  firstName: 'مدیر', lastName: 'سایت', isAdmin: true, phoneVerified: true,
  banned: false, termsAccepted: true, purchases: ['p1', 'p2'],
  createdAt: new Date(2026, 0, 1).toISOString(),
});
for (let i = 1; i <= 13; i++) {
  cache.users.push({
    id: 'u' + i, phone: '0912000' + String(1000 + i), password: 'x',
    firstName: 'کاربر', lastName: 'شماره ' + i, isAdmin: false,
    phoneVerified: i % 3 !== 0, banned: i === 5, termsAccepted: i % 2 === 0,
    purchases: i % 4 === 0 ? ['p1'] : [],
    createdAt: new Date(2026, 4, i).toISOString(),
  });
}
for (let i = 1; i <= 11; i++) {
  cache.products.push({
    id: 'p' + i, type: TYPES[i % 4], featured: i % 5 === 0,
    title: 'محصول نمونه شماره ' + i + ' با یک عنوان نسبتاً بلند',
    description: 'توضیح کوتاه محصول نمونه', price: 45000 + i * 1000,
    discount: i % 3 === 0 ? 20 : 0, rating: 4 + (i % 10) / 10, reviewCount: i,
    tags: [], chapters: [], bundleItems: [], image: '',
    createdAt: new Date(2026, 3, i).toISOString(),
  });
}

/* ─── سفارش‌های نسخه‌ی قبل ───
   دقیقاً همان چیزی که روی سایت زنده دیده شد: چهار سفارشِ باز برای یک
   محصول با وضعیت قدیمی 'pending'. مهاجرت باید آن‌ها را به
   awaiting_payment ببرد و فقط یکی را باز نگه دارد. */
for (let i = 0; i < 4; i++) {
  cache.orders.push({
    id: 'legacy-' + i, userId: 'u-admin', productId: 'p9',
    productTitle: 'سفارش قدیمی تکراری', amount: 18000,
    status: 'pending', createdAt: new Date(Date.now() - i * 60_000).toISOString(),
  });
}

console.log('⚠  حالت تست — دیتابیس در حافظه (با ری‌استارت پاک می‌شود)');
console.log('   ورود ادمین:  09120000000 / admin123');
require('./server.js');
