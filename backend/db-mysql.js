/* ═══════════════════════════════════════════════════════════
   db-mysql.js — لایه‌ی دیتابیس MySQL
   ───────────────────────────────────────────────────────────
   این ماژول همان رابطِ lowdb را ارائه می‌دهد:
     db.get('table').value()
     db.get('table').find({...}).value()
     db.get('table').filter({...}).value()
     db.get('table').push(obj).write()
     db.get('table').find({...}).assign({...}).write()
     db.get('table').remove({...}).write()
   ولی پشتِ صحنه روی MySQL کار می‌کند.

   نکته: همه‌ی متدها همگام (synchronous به‌نظر) طراحی شده‌اند با
   استفاده از یک کش در حافظه که هنگام بالا آمدن سرور از MySQL پر
   می‌شود و با هر write، هم کش و هم دیتابیس به‌روز می‌شوند.
   این کار باعث می‌شود server.js تقریباً بدون تغییر کار کند.
═══════════════════════════════════════════════════════════ */

const mysql = require('mysql2/promise');

/* ستون‌هایی که در دیتابیس به‌صورت JSON متنی ذخیره می‌شوند */
const JSON_FIELDS = {
  users:    ['purchases'],
  products: ['tags', 'chapters', 'bundleItems'],
  orders:   [],
  reviews:  [],
  tickets:  ['messages'],            /* threaded chat: array of message objects */
  articles: ['tags', 'relatedProducts'],
};
/* ستون‌هایی که اگر در دیتابیس وجود نداشته باشند، خودکار اضافه می‌شوند —
   اجازه می‌دهد آپدیت روی هاست بدون اجرای دستی ALTER انجام شود */
const AUTO_COLUMNS = {
  tickets: [['messages', 'LONGTEXT']],
  users:   [['phoneVerified', 'TINYINT(1) NOT NULL DEFAULT 0']],
};
/* ستون‌های boolean (در MySQL به‌صورت 0/1) */
const BOOL_FIELDS = {
  users:    ['isAdmin', 'termsAccepted', 'banned', 'phoneVerified'],
  products: ['featured'],
};
const TABLES = Object.keys(JSON_FIELDS);

let pool = null;
const cache = {};          /* cache[table] = [ row, row, ... ] */
const schema = {};         /* schema[table] = Set of real column names */

/* ─── خواندن نام ستون‌های واقعی هر جدول ─── */
async function loadSchema(table) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  schema[table] = new Set(cols.map(c => c.COLUMN_NAME));
}

/* ─── تبدیل ردیف خام MySQL به آبجکت جاوااسکریپت ─── */
function decodeRow(table, row) {
  if (!row) return row;
  const o = { ...row };
  for (const f of (JSON_FIELDS[table] || [])) {
    if (o[f] == null || o[f] === '') { o[f] = []; continue; }
    try { o[f] = JSON.parse(o[f]); } catch { o[f] = []; }
  }
  for (const f of (BOOL_FIELDS[table] || [])) {
    o[f] = !!o[f];
  }
  return o;
}
/* ─── تبدیل آبجکت جاوااسکریپت به ردیف قابل‌ذخیره در MySQL ─── */
function encodeRow(table, obj) {
  const o = { ...obj };
  for (const f of (JSON_FIELDS[table] || [])) {
    o[f] = JSON.stringify(o[f] == null ? [] : o[f]);
  }
  for (const f of (BOOL_FIELDS[table] || [])) {
    o[f] = o[f] ? 1 : 0;
  }
  return o;
}

/* ─── اتصال اولیه + بارگذاری کش ─── */
async function init(config) {
  pool = mysql.createPool({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    socketPath: config.socketPath || undefined,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4_unicode_ci',
  });
  /* تست اتصال */
  const conn = await pool.getConnection();
  conn.release();
  /* پر کردن کش از روی دیتابیس + خواندن ساختار ستون‌ها */
  for (const t of TABLES) {
    await loadSchema(t);
    /* مهاجرت خودکار: ستون‌های جدید را در صورت نبود اضافه کن */
    for (const [col, type] of (AUTO_COLUMNS[t] || [])) {
      if (!schema[t].has(col)) {
        try {
          await pool.query(`ALTER TABLE \`${t}\` ADD COLUMN \`${col}\` ${type}`);
          schema[t].add(col);
          console.log(`🛠  ستون '${col}' به جدول '${t}' اضافه شد`);
        } catch (e) { /* اگر ستون از قبل بود یا خطا داد، نادیده بگیر */ }
      }
    }
    const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
    cache[t] = rows.map(r => decodeRow(t, r));
  }
  return true;
}

/* ─── نوشتن یک ردیف (INSERT یا UPDATE) در MySQL ─── */
async function persistRow(table, obj) {
  const enc = encodeRow(table, obj);
  /* فقط ستون‌هایی که واقعاً در جدول وجود دارند نوشته می‌شوند —
     فیلدهای اضافی (مثل qrCode قدیمی) نادیده گرفته می‌شوند */
  const valid = schema[table];
  const cols = Object.keys(enc).filter(c => !valid || valid.has(c));
  if (!cols.length) return;
  const placeholders = cols.map(() => '?').join(',');
  const updates = cols.filter(c => c !== 'id').map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',');
  const sql = `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(',')})
               VALUES (${placeholders})
               ON DUPLICATE KEY UPDATE ${updates}`;
  await pool.query(sql, cols.map(c => enc[c]));
}
async function deleteRows(table, ids) {
  if (!ids.length) return;
  await pool.query(
    `DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

/* ─── بررسی تطابق یک ردیف با شرط ─── */
function matches(row, query) {
  if (typeof query === 'function') return query(row);
  return Object.keys(query).every(k => row[k] === query[k]);
}

/* ─── زنجیره‌ی کوئری (همان رابط lowdb) ─── */
function chain(table, items, opts = {}) {
  return {
    /* خروجی نهایی */
    value() {
      return opts.single ? (items[0] || null) : items;
    },
    /* فیلتر */
    find(query) {
      const found = items.find(r => matches(r, query));
      return chain(table, found ? [found] : [], { single: true });
    },
    filter(query) {
      return chain(table, items.filter(r => matches(r, query)), {});
    },
    /* افزودن ردیف جدید */
    push(obj) {
      cache[table].push(obj);
      return {
        write: async () => { await persistRow(table, obj); return obj; },
      };
    },
    /* به‌روزرسانی ردیف(های) انتخاب‌شده */
    assign(patch) {
      const targets = items;
      return {
        write: async () => {
          for (const row of targets) {
            Object.assign(row, patch);
            await persistRow(table, row);
          }
          return targets;
        },
      };
    },
    /* حذف ردیف(ها) */
    remove(query) {
      const toRemove = items.filter(r => matches(r, query));
      const ids = toRemove.map(r => r.id);
      return {
        write: async () => {
          cache[table] = cache[table].filter(r => !ids.includes(r.id));
          await deleteRows(table, ids);
          return toRemove;
        },
      };
    },
    /* شمارش (برای سازگاری) */
    size() { return chainScalar(items.length); },
  };
}
function chainScalar(v) { return { value: () => v }; }

/* ─── آبجکت db که server.js از آن استفاده می‌کند ─── */
const db = {
  get(table) {
    if (!TABLES.includes(table))
      throw new Error('جدول ناشناخته: ' + table);
    return chain(table, cache[table] || [], {});
  },
};

module.exports = { db, init, TABLES };
