# ParticularFlix - tema NetFin e fontes servidos pelo proprio Jellyfin (JMSFusion 4.0.0.7 ou mais novo).
#
# O CSS do branding importava o NetFin do jsDelivr e as fontes do Google. Sem internet o Jellyfin abria com o tema
# padrao, e cada abertura esperava esses downloads antes de aplicar qualquer estilo do branding.
# Este script baixa o NetFin e as fontes uma vez, troca os enderecos externos por arquivos locais e grava tudo na
# pasta "custom" do JMSFusion com nomes que comecam com "_" (servidos em /JMSFusion/custom/, nunca injetados).
#
# Uso:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\jms-netfin-local12.ps1" -Ambiente Teste -Modo Simular
#   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\jms-netfin-local12.ps1" -Ambiente Teste -Modo Aplicar
# Simular baixa e monta os arquivos numa pasta de trabalho; Aplicar tambem copia para a pasta custom e confere o
# que o servidor serve. O CSS do branding (Painel > Geral > CSS personalizado) e alterado a mao depois.
param(
    [ValidateSet("Teste", "Producao")] [string]$Ambiente = "Teste",
    [ValidateSet("Simular", "Aplicar")] [string]$Modo = "Simular",
    [string]$NetfinUrl = "https://cdn.jsdelivr.net/gh/ya0903/NetFin@main/netfin.css",
    [string]$BebasUrl = "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap"
)

$ErrorActionPreference = "Stop"
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
$base = "D:\JellyfinDownloads"
if ($Ambiente -eq "Teste") {
    $custom = "$base\jms-fork\teste-12\config\data\plugins\configurations\JMSFusion\custom"
    $server = "http://127.0.0.1:8197"
}
if ($Ambiente -eq "Producao") {
    $custom = "$base\appdata\jellyfin\data\plugins\configurations\JMSFusion\custom"
    $server = "http://127.0.0.1:8096"
}
$work = "$base\jms-fork\netfin-local-" + (Get-Date -Format "yyyyMMdd-HHmmss")

function Ok($m) { Write-Host "[OK]    $m" -ForegroundColor Green }
function Aviso($m) { Write-Host "[AVISO] $m" -ForegroundColor Yellow }
function Parar($m) { Write-Host "[PARADO] $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path -LiteralPath $custom)) { Parar "pasta custom nao encontrada: $custom" }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$fontCount = 0

# Baixa um arquivo de fonte e devolve o nome local (_nf-<hash>.<ext>), sempre o mesmo para a mesma URL.
function Get-LocalFont([string]$url) {
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($url)) | Select-Object -First 6 | ForEach-Object { $_.ToString("x2") })
    $ext = [IO.Path]::GetExtension(([Uri]$url).AbsolutePath).ToLowerInvariant()
    if ($ext -notin ".woff2", ".woff", ".ttf", ".otf") { Parar "fonte com extensao inesperada: $url" }
    $name = "_nf-$hash$ext"
    $dest = Join-Path $work $name
    if (-not (Test-Path -LiteralPath $dest)) {
        Invoke-WebRequest -Uri $url -UserAgent $UA -OutFile $dest
        $script:fontCount++
    }
    return $name
}

# Troca url(https://fonts.gstatic.com/...) pelos arquivos locais.
function Convert-FontUrls([string]$css) {
    return [regex]::Replace($css, 'url\(\s*["'']?(https://fonts\.gstatic\.com/[^"'')\s]+)["'']?\s*\)', {
        param($m)
        'url("' + (Get-LocalFont $m.Groups[1].Value) + '")'
    })
}

# Troca cada @import do Google Fonts pelo @font-face local correspondente.
function Convert-Css([string]$css) {
    $css = [regex]::Replace($css, '@import\s+url\(\s*["'']?(https://fonts\.googleapis\.com/[^"'')]+)["'']?\s*\)\s*;', {
        param($m)
        $fontCss = (Invoke-WebRequest -Uri $m.Groups[1].Value -UserAgent $UA).Content
        "/* local: " + $m.Groups[1].Value + " */`n" + (Convert-FontUrls $fontCss)
    })
    return Convert-FontUrls $css
}

Write-Host "`n=== 1/3 Baixando e convertendo ($Ambiente, $Modo)"
$netfin = (Invoke-WebRequest -Uri $NetfinUrl -UserAgent $UA).Content
if ($netfin.Length -lt 20000) { Parar "netfin.css veio pequeno demais ($($netfin.Length) caracteres)" }
Set-Content -LiteralPath "$work\netfin-original.css" -Value $netfin -Encoding utf8NoBOM -NoNewline
$netfinLocal = "/* ParticularFlix: copia local de $NetfinUrl em " + (Get-Date -Format "yyyy-MM-dd HH:mm") + " */`n" + (Convert-Css $netfin)
Set-Content -LiteralPath "$work\_netfin.css" -Value $netfinLocal -Encoding utf8NoBOM -NoNewline
$bebas = "/* ParticularFlix: copia local de $BebasUrl */`n" + (Convert-FontUrls ((Invoke-WebRequest -Uri $BebasUrl -UserAgent $UA).Content))
Set-Content -LiteralPath "$work\_pf-fonts.css" -Value $bebas -Encoding utf8NoBOM -NoNewline
Ok "_netfin.css: $($netfinLocal.Length) caracteres; _pf-fonts.css: $($bebas.Length) caracteres; $fontCount fonte(s) baixada(s)"

$restantes = @()
foreach ($f in "_netfin.css", "_pf-fonts.css") {
    $t = Get-Content -LiteralPath "$work\$f" -Raw
    $restantes += [regex]::Matches($t, '(@import[^;]*https?://[^;]*;|url\(\s*["'']?https?://[^)]*\))') | ForEach-Object { "$f -> " + $_.Value }
}
if ($restantes.Count -gt 0) { $restantes | ForEach-Object { Aviso "ainda externo: $_" } }
if ($restantes.Count -eq 0) { Ok "nenhum endereco externo restante" }

Write-Host "`n=== 2/3 Arquivos montados em $work"
Get-ChildItem -LiteralPath $work -File | Where-Object { $_.Name -like "_*" } | ForEach-Object { "        " + $_.Name + " (" + $_.Length + " bytes)" }

if ($Modo -eq "Simular") {
    Write-Host "`nSimulacao concluida. Nada foi copiado para a pasta custom."
    exit 0
}

Write-Host "`n=== 3/3 Copiando para a pasta custom e conferindo o que o servidor serve"
$bk = "$base\jms-fork\backups-teste12\custom-$($Ambiente.ToLower())-antes-netfin-local-" + (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $bk | Out-Null
Get-ChildItem -LiteralPath $custom -File | Copy-Item -Destination $bk
Ok "backup da pasta custom em $bk"
Get-ChildItem -LiteralPath $custom -File | Where-Object { $_.Name -like "_nf-*" -or $_.Name -in "_netfin.css", "_pf-fonts.css" } | Remove-Item
Get-ChildItem -LiteralPath $work -File | Where-Object { $_.Name -like "_*" } | Copy-Item -Destination $custom
$falhas = 0
foreach ($f in Get-ChildItem -LiteralPath $custom -File | Where-Object { $_.Name -like "_*" }) {
    $tmp = Join-Path $work ("served-" + $f.Name)
    $code = curl.exe -s -H "Accept-Encoding: identity" -o $tmp -w "%{http_code}" "$server/JMSFusion/custom/$($f.Name)"
    $igual = ($code -eq "200") -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $f.FullName).Hash)
    if (-not $igual) { $falhas++; Aviso "$($f.Name): HTTP $code, conteudo igual: $igual" }
}
if ($falhas -gt 0) { Parar "$falhas arquivo(s) nao servidos corretamente (o JMSFusion precisa ser 4.0.0.7 ou mais novo)" }
Ok "todos os arquivos _ servidos pelo servidor com o mesmo conteudo"
Write-Host "`nPronto. Agora troque no CSS personalizado as duas linhas @import pelas locais (veja a mensagem do Claude)."
