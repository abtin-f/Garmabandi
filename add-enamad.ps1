# ═══════════════════════════════════════════════════════════
#  add-enamad.ps1 — افزودن نماد اعتماد الکترونیکی به فوتر
#  کد اینماد عیناً همان چیزی است که پنل enamad.ir می‌دهد.
#  اجرای دوباره‌ی این اسکریپت بی‌خطر است (اگر قبلاً اضافه شده رد می‌شود).
# ═══════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$fe   = Join-Path $root 'frontend'

$seal = @"
      <div class="ft-trust">
        <a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=766293&Code=ENXngwuS9BlcrO9POja240UOTkYAuFa5'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=766293&Code=ENXngwuS9BlcrO9POja240UOTkYAuFa5' alt='نماد اعتماد الکترونیکی' style='cursor:pointer' code='ENXngwuS9BlcrO9POja240UOTkYAuFa5'></a>
      </div>
"@

$anchor = '      <div class="ft-bottom">'

Get-ChildItem "$fe\*.html" | ForEach-Object {
  $c = Get-Content -Raw -Encoding UTF8 $_.FullName
  if ($c -notmatch 'ft-bottom')      { return }                       # فوتر ندارد
  if ($c -match 'trustseal\.enamad') { Write-Output ("skip: " + $_.Name); return }
  $new = $c -replace [regex]::Escape($anchor), ($seal + $anchor)
  [IO.File]::WriteAllText($_.FullName, $new, (New-Object Text.UTF8Encoding $false))
  Write-Output ("added: " + $_.Name)
}
