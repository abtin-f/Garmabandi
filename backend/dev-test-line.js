/* تست ارسال از خط اختصاصی — یک پیامک واقعی می‌فرستد.
   اجرا:  node dev-test-line.js 09137642853            */
require('dotenv').config();
const KEY  = (process.env.SMS_API_KEY || '').trim();
const LINE = (process.env.SMS_LINE_NUMBER || '').trim();
const to   = process.argv[2];
if (!to) { console.error('شماره را بده: node dev-test-line.js 09xxxxxxxxx'); process.exit(1); }

const code = String(Math.floor(10000 + Math.random() * 90000));
const text = `کد تایید شما: ${code}\nگرمابندی\ngarmabandi.ir`;

(async () => {
  const r = await fetch('https://api.sms.ir/v1/send/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ lineNumber: Number(LINE), messageText: text, mobiles: [to] }),
  });
  const d = await r.json().catch(() => ({}));
  console.log('HTTP', r.status, JSON.stringify(d));
  console.log('code:', code, '| line:', LINE, '| at:', new Date().toLocaleTimeString('fa-IR'));
})();
