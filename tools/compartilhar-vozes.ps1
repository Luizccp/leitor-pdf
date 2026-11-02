# Liga o servidor de vozes (se preciso) e abre um túnel gratuito da Cloudflare.
# No fim mostra o link do app já apontando para o seu servidor e copia para a área de transferência.
$ErrorActionPreference = "Stop"
$pasta = Split-Path -Parent $PSScriptRoot
$app   = "https://leitor-pdf-luizccp.vercel.app"
$cf    = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
if (-not $cf) { Write-Host "cloudflared nao encontrado. Instale com: winget install --id Cloudflare.cloudflared" -ForegroundColor Red; exit 1 }

# 1) servidor de vozes
$ligado = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $ligado) {
  Write-Host "Ligando o servidor de vozes..."
  Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory $pasta -WindowStyle Minimized
  Start-Sleep -Seconds 4
} else { Write-Host "Servidor de vozes ja estava ligado." }

# 2) túnel gratuito (endereço temporário)
$log = Join-Path $env:TEMP "leitor-tunel.log"
if (Test-Path $log) { Remove-Item $log -Force }
Write-Host "Abrindo o tunel..."
$tun = Start-Process -FilePath $cf -ArgumentList @("tunnel","--url","http://127.0.0.1:8000","--no-autoupdate","--logfile",$log) -WindowStyle Minimized -PassThru

$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { Write-Host "Nao consegui obter o endereco do tunel. Veja $log" -ForegroundColor Red; exit 1 }

$link = "$app/?servidor=$url"
Set-Clipboard -Value $link
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host " PRONTO! Mande este link (ja copiado para a area de transferencia):" -ForegroundColor Green
Write-Host ""
Write-Host "   $link" -ForegroundColor Yellow
Write-Host ""
Write-Host " Funciona enquanto o seu PC estiver ligado e esta janela aberta."
Write-Host " Para parar de compartilhar, feche esta janela (ou aperte Enter)."
Write-Host "==============================================================" -ForegroundColor Green
Read-Host "Aperte Enter para PARAR o compartilhamento"
Stop-Process -Id $tun.Id -Force -ErrorAction SilentlyContinue
Write-Host "Compartilhamento encerrado."
