# ═══════════════════════════════════════════════════════════
#  make-release.ps1 — ساخت فایل zip برای آپلود روی هاست
#  اجرا:  powershell -ExecutionPolicy Bypass -File make-release.ps1
#  خروجی: garmabandi-v<version>.zip کنار پوشه‌ی پروژه
#  آنچه داخل zip نمی‌رود: node_modules، .git، .env، uploads، لاگ‌ها
#
#  ⚠ مسیرها با «/» نوشته می‌شوند نه «\» — Compress-Archive در
#  ویندوز از بک‌اسلش استفاده می‌کند و بعضی اکسترکت‌کننده‌های لینوکسی
#  (از جمله File Manager بعضی نسخه‌های cPanel) به‌جای ساخت پوشه،
#  فایلی به اسم «backend\server.js» می‌سازند. برای همین zip را
#  دستی با System.IO.Compression می‌سازیم.
# ═══════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg  = Get-Content -Raw "$root\backend\package.json" | ConvertFrom-Json
$ver  = $pkg.version
$out  = Join-Path (Split-Path -Parent $root) "garmabandi-v$ver.zip"
if (Test-Path $out) { Remove-Item $out -Force }

# ─── فهرست فایل‌هایی که باید داخل zip بروند ───
$items = @()   # هر آیتم: @{ Src = مسیر واقعی; Dst = مسیر داخل zip }

# فرانت‌اند: کل پوشه
Get-ChildItem "$root\frontend" -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring("$root\".Length).Replace('\','/')
  $items += @{ Src = $_.FullName; Dst = $rel }
}
# بک‌اند: فقط فایل‌های لازم (بدون node_modules، .env، uploads، لاگ)
foreach ($f in @('server.js','db-mysql.js','package.json','package-lock.json','schema.sql','.env.example')) {
  if (Test-Path "$root\backend\$f") { $items += @{ Src = "$root\backend\$f"; Dst = "backend/$f" } }
}
# مستندات — فقط اسم‌های انگلیسی.
# نام فارسی داخل zip روی سرور لینوکسی به‌هم‌ریخته می‌شود و
# راهنماها در مخزن گیت موجودند، پس داخل بسته لازم نیستند.
Get-ChildItem $root -File -Filter *.md |
  Where-Object { $_.Name -match '^[\x20-\x7E]+$' } |
  ForEach-Object { $items += @{ Src = $_.FullName; Dst = $_.Name } }

$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($i in $items) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $i.Src, $i.Dst, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Output "version: $ver"
Write-Output "files:   $($items.Count)"
Write-Output "output:  $out  ($size MB)"
