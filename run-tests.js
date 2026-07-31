/* سرور تستی را تازه بالا می‌آورد و هر دو مجموعه تست را پشت سر هم اجرا
   می‌کند. خروجی UTF-8 در test-report.txt نوشته می‌شود — کنسول PowerShell
   فارسی را خراب نشان می‌دهد.
   اجرا:  node run-tests.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const BE = path.join(__dirname, 'backend');
const OUT = path.join(__dirname, 'test-report.txt');

let log = '';
const add = s => { log += s; process.stdout.write(s); };

function run(file) {
  return new Promise(res => {
    const p = spawn(process.execPath, [file], { cwd: BE });
    p.stdout.on('data', d => add(d.toString()));
    p.stderr.on('data', d => add(d.toString()));
    p.on('close', code => res(code));
  });
}

(async () => {
  const srv = spawn(process.execPath, ['dev-memory-server.js'], { cwd: BE });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', d => add('[srv] ' + d.toString()));
  await new Promise(r => setTimeout(r, 2500));

  add('\n\n########## OTP ##########\n');
  const a = await run('dev-test-otp.js');
  add('\n\n########## CARD-TO-CARD ##########\n');
  const b = await run('dev-test-c2c.js');

  srv.kill();
  add(`\n\nEXIT  otp=${a}  c2c=${b}\n`);
  fs.writeFileSync(OUT, log, 'utf8');
  process.exit(a || b ? 1 : 0);
})();
