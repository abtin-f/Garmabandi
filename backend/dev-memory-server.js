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

console.log('⚠  حالت تست — دیتابیس در حافظه (با ری‌استارت پاک می‌شود)');
require('./server.js');
