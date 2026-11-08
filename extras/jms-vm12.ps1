<#
  jms-vm12.ps1  (ParticularFlix)  v1.0   JMSFusion publicado -> Jellyfin da VM

  Leva para a VM uma versao do JMSFusion JA PUBLICADA no GitHub (release v<versao>), junto com o header
  moderno da pasta custom (extras/particularflix-modern-header.js da mesma tag). Quem baixa e a propria VM,
  direto do GitHub; o PC so confere. O zip e conferido pelo MD5 do manifest.json publicado (main).
  A producao NAO e tocada. Os scripts pf-vm-* NAO sao alterados; o reinicio usa o pf-vm-manutencao.ps1
  (avisa quem esta assistindo, reinicia, espera ficar saudavel, confere os plugins).

  Modos:
    (sem opcao)  SIMULACAO: le a VM (versao atual, hashes), baixa e confere o zip e o header num /tmp da VM
                 e mostra o plano. Nao altera nada.
    -Aplicar     backup em ~/backups/jms-plugin-<data> na VM, troca DLL + meta.json + icon.png no volume do
                 plugin e o header na pasta custom (troca atomica, dono preservado), reinicia pelo
                 pf-vm-manutencao.ps1 (-Minutos N) e valida: plugin Active na versao nova e header servido igual.
    -Reverter    devolve os arquivos do backup mais recente e reinicia pelo pf-vm-manutencao.ps1.
    -SoValidar   so a validacao (versao do plugin ativa e header servido), sem alterar nada.

  Uso (a partir de D:\JellyfinDownloads\jms-fork):
    pwsh -NoProfile -ExecutionPolicy Bypass -File .\jms-vm12.ps1 -Versao 4.0.0.11
    pwsh -NoProfile -ExecutionPolicy Bypass -File .\jms-vm12.ps1 -Versao 4.0.0.11 -Aplicar -Minutos 5
    pwsh -NoProfile -ExecutionPolicy Bypass -File .\jms-vm12.ps1 -Reverter -Minutos 2
#>
#requires -Version 7.0

[CmdletBinding()]
param(
  [string]$Versao = '',
  [switch]$Aplicar,
  [switch]$Reverter,
  [switch]$SoValidar,
  [ValidateRange(0, 60)][int]$Minutos = 5,
  [switch]$Forcar,
  [string]$Repo = 'hebolysouza/ParticularFlix-JMSFusion',
  [string]$PastaVmScripts = 'D:\JellyfinDownloads\vm-teste',
  [string]$VmIp = '',
  [int]$VmSshPorta = 2298,
  [string]$VmUsuario = 'u28_admin2',
  [string]$VmChaveSsh = ''
)

$ErrorActionPreference = 'Stop'
$script:ChaveSsh = ''

$ScriptPy = @'
import hashlib, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, zipfile, glob

CONT = 'jellyfin'
HOME = os.environ['PF_HOME']
BK = HOME + '/backups'
APPD = os.environ.get('PF_APPD', '/opt/particularflix/appdata')
CUSTOM = APPD + '/jellyfin/data/plugins/configurations/JMSFusion/custom'
XMLK = APPD + '/jellyfin/data/plugins/configurations/Jellyfin.Plugin.JMSFusion.xml'
HEADER = 'particularflix-modern-header.js'
FILES = ('Jellyfin.Plugin.JMSFusion.dll', 'meta.json', 'icon.png')

def p(*a):
    print(*a); sys.stdout.flush()

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest().upper()

def plugin_dir():
    # 1) volume ou bind proprio do plugin (como na producao: /config/data/plugins/JMSFusion_4.0.0.0);
    # 2) senao, a pasta do plugin dentro do appdata (/config), que e como a VM foi montada.
    r = run(['docker', 'inspect', CONT])
    if r.returncode != 0: raise SystemExit('ERRO=container_%s_nao_encontrado' % CONT)
    mounts = json.loads(r.stdout.decode('utf-8'))[0].get('Mounts') or []
    alvo = [m for m in mounts if str(m.get('Destination', '')).startswith('/config/data/plugins/JMSFusion')]
    if len(alvo) > 1: raise SystemExit('ERRO=mais_de_1_mount_do_plugin')
    if len(alvo) == 1:
        return alvo[0].get('Source'), alvo[0].get('Destination'), 'mount ' + (alvo[0].get('Name') or '-')
    cfg = [m for m in mounts if m.get('Destination') == '/config']
    if len(cfg) != 1: raise SystemExit('ERRO=mount_do_config_nao_encontrado')
    base = os.path.join(cfg[0].get('Source'), 'data', 'plugins')
    achadas = sorted(d for d in glob.glob(os.path.join(base, 'JMSFusion*')) if os.path.isfile(os.path.join(d, FILES[0])))
    if len(achadas) != 1:
        p('PASTAS_JMSFUSION=%s' % (','.join(os.path.basename(d) for d in achadas) or 'nenhuma'))
        raise SystemExit('ERRO=esperava_1_pasta_JMSFusion_com_a_DLL_em_%s_achei_%d' % (base, len(achadas)))
    d = achadas[0]
    return d, '/config/data/plugins/' + os.path.basename(d), 'pasta no appdata'

def chave_api():
    try: txt = open(XMLK, encoding='utf-8').read()
    except Exception: return None
    import re
    m = re.search(r'<JFApiKey>([^<]+)</JFApiKey>', txt)
    return m.group(1).strip() if m else None

def api(caminho, chave=None, cru=False):
    h = ' -H "Authorization: MediaBrowser Token=\\"$JFK\\""' if chave else ''
    cmd = 'curl -s -m 30 -H "Accept-Encoding: identity" -w "\\n%{http_code}"' + h + ' "http://localhost:8096' + caminho + '"'
    r = run(['docker', 'exec', '-e', 'JFK=' + (chave or ''), CONT, 'sh', '-c', cmd])
    corpo, _, code = r.stdout.rpartition(b'\n')
    try: c = int(code.strip())
    except Exception: c = 0
    return c, (corpo if cru else corpo.decode('utf-8', 'replace'))

def estado_plugin():
    k = chave_api()
    if not k: return 'sem_chave_api', '-'
    c, t = api('/Plugins', k)
    if c != 200: return 'http_%d' % c, '-'
    for x in json.loads(t):
        if x.get('Name') == 'JMSFusion': return str(x.get('Status')), str(x.get('Version'))
    return 'ausente', '-'

def baixar(url, destino):
    req = urllib.request.Request(url, headers={'User-Agent': 'ParticularFlix-jms-vm12'})
    with urllib.request.urlopen(req, timeout=120) as r, open(destino, 'wb') as f:
        shutil.copyfileobj(r, f)

def preparar(tmp, versao, url_zip, md5_esperado, url_header):
    z = os.path.join(tmp, 'plugin.zip')
    baixar(url_zip, z)
    md5 = hashlib.md5(open(z, 'rb').read()).hexdigest().lower()
    p('ZIP_MD5=%s' % md5)
    if md5 != md5_esperado.lower(): raise SystemExit('ERRO=md5_do_zip_diferente_do_manifest')
    with zipfile.ZipFile(z) as zf:
        nomes = zf.namelist()
        faltam = [n for n in FILES if n not in nomes]
        if faltam: raise SystemExit('ERRO=zip_sem_' + ','.join(faltam))
        for n in FILES: zf.extract(n, tmp)
    meta = json.load(open(os.path.join(tmp, 'meta.json'), encoding='utf-8-sig'))
    if str(meta.get('version')) != versao: raise SystemExit('ERRO=meta_json_diz_%s' % meta.get('version'))
    p('NOVO_DLL_SHA=%s' % sha(os.path.join(tmp, FILES[0])))
    hpath = os.path.join(tmp, HEADER)
    baixar(url_header, hpath)
    if os.path.getsize(hpath) < 1000: raise SystemExit('ERRO=header_baixado_muito_pequeno')
    p('NOVO_HEADER_SHA=%s' % sha(hpath))
    return hpath

def resumo():
    src, dst, vol = plugin_dir()
    p('PLUGIN_DIR=%s -> %s (%s)' % (src, dst, vol))
    try: p('VERSAO_NO_VOLUME=%s' % json.load(open(os.path.join(src, 'meta.json'), encoding='utf-8-sig')).get('version'))
    except Exception as e: p('VERSAO_NO_VOLUME=erro_%s' % e)
    dll = os.path.join(src, FILES[0])
    p('DLL_SHA=%s' % (sha(dll) if os.path.exists(dll) else 'ausente'))
    h = os.path.join(CUSTOM, HEADER)
    p('HEADER_SHA=%s' % (sha(h) if os.path.exists(h) else 'ausente'))
    r = run(['docker', 'inspect', '-f', '{{.State.Running}}', CONT])
    p('JELLYFIN_RODANDO=%s' % r.stdout.decode().strip())
    st, ver = estado_plugin()
    p('PLUGIN_STATUS=%s' % st)
    p('PLUGIN_VERSAO_ATIVA=%s' % ver)
    return src

def trocar(origem, destino, dono):
    novo = destino + '.jmsnovo'
    shutil.copyfile(origem, novo)
    if dono: os.chown(novo, dono[0], dono[1])
    os.chmod(novo, 0o644)
    os.replace(novo, destino)

def principal():
    modo = sys.argv[1]
    versao = sys.argv[2] if len(sys.argv) > 2 else ''
    url_zip = sys.argv[3] if len(sys.argv) > 3 else ''
    md5 = sys.argv[4] if len(sys.argv) > 4 else ''
    url_header = sys.argv[5] if len(sys.argv) > 5 else ''
    src = resumo()
    if modo == 'check':
        if url_zip:
            tmp = tempfile.mkdtemp(prefix='jmsvm-')
            try:
                preparar(tmp, versao, url_zip, md5, url_header)
                p('DOWNLOAD_CONFERIDO=ok')
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        return 0
    if modo == 'validate':
        c, corpo = api('/JMSFusion/custom/' + HEADER, cru=True)
        p('HEADER_SERVIDO_HTTP=%d' % c)
        if c == 200: p('HEADER_SERVIDO_SHA=%s' % hashlib.sha256(corpo).hexdigest().upper())
        return 0
    if modo == 'stage':
        if not os.path.isdir(CUSTOM): raise SystemExit('ERRO=pasta_custom_nao_existe')
        tmp = tempfile.mkdtemp(prefix='jmsvm-')
        try:
            hpath = preparar(tmp, versao, url_zip, md5, url_header)
            pasta = '%s/jms-plugin-%s' % (BK, time.strftime('%Y%m%d-%H%M%S'))
            os.makedirs(pasta + '/plugin'); os.makedirs(pasta + '/custom')
            for n in FILES:
                a = os.path.join(src, n)
                if os.path.exists(a):
                    shutil.copy2(a, pasta + '/plugin/' + n)
                    if sha(a) != sha(pasta + '/plugin/' + n): raise SystemExit('ERRO=backup_nao_confere_' + n)
            h = os.path.join(CUSTOM, HEADER)
            if os.path.exists(h): shutil.copy2(h, pasta + '/custom/' + HEADER)
            p('BACKUP=%s' % pasta)
            ref = os.path.join(src, FILES[0])
            st = os.stat(ref) if os.path.exists(ref) else os.stat(src)
            dono = (st.st_uid, st.st_gid)
            for n in FILES: trocar(os.path.join(tmp, n), os.path.join(src, n), dono)
            sth = os.stat(h) if os.path.exists(h) else os.stat(CUSTOM)
            trocar(hpath, h, (sth.st_uid, sth.st_gid))
            for n in FILES:
                if sha(os.path.join(src, n)) != sha(os.path.join(tmp, n)): raise SystemExit('ERRO=copia_nao_confere_' + n)
            p('STAGED=ok')
            p('DLL_SHA_DEPOIS=%s' % sha(os.path.join(src, FILES[0])))
            p('HEADER_SHA_DEPOIS=%s' % sha(h))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return 0
    if modo == 'revert':
        ult = sorted(glob.glob(BK + '/jms-plugin-*'))
        if not ult: raise SystemExit('ERRO=nenhum_backup_jms-plugin')
        pasta = ult[-1]
        ref = os.path.join(src, FILES[0])
        st = os.stat(ref) if os.path.exists(ref) else os.stat(src)
        for n in FILES:
            a = pasta + '/plugin/' + n
            if os.path.exists(a): trocar(a, os.path.join(src, n), (st.st_uid, st.st_gid))
        a = pasta + '/custom/' + HEADER
        if os.path.exists(a):
            h = os.path.join(CUSTOM, HEADER)
            sth = os.stat(h) if os.path.exists(h) else os.stat(CUSTOM)
            trocar(a, h, (sth.st_uid, sth.st_gid))
        p('RESTAURADO=%s' % pasta)
        return 0
    p('modo invalido'); return 2

try:
    sys.exit(principal())
except SystemExit as e:
    if isinstance(e.code, str): p(e.code); sys.exit(5)
    raise
'@

function Write-Titulo([string]$t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }

function Invoke-Ssh([string]$comando) {
  $saida = & ssh -o ServerAliveInterval=30 -p $VmSshPorta -i $script:ChaveSsh "$VmUsuario@$VmIp" $comando 2>&1
  return [pscustomobject]@{ Codigo = $LASTEXITCODE; Saida = @($saida | ForEach-Object { [string]$_ }) }
}

function Invoke-NaVm([string[]]$argumentos) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'jms-vm12.py'
  try {
    [System.IO.File]::WriteAllText($tmp, $ScriptPy.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
    & scp -P $VmSshPorta -i $script:ChaveSsh $tmp "${VmUsuario}@${VmIp}:/tmp/jms-vm12.py" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o script auxiliar para a VM (SCP).' }
  }
  finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  $args2 = ($argumentos | ForEach-Object { "'" + ($_ -replace "'", '') + "'" }) -join ' '
  return (Invoke-Ssh "sudo -n env PF_HOME=`"`$HOME`" python3 /tmp/jms-vm12.py $args2; c=`$?; rm -f /tmp/jms-vm12.py; exit `$c")
}

function Get-Linha([object[]]$saida, [string]$prefixo) {
  $l = @($saida | Where-Object { $_ -like "$prefixo*" } | Select-Object -First 1)
  if ($l.Count -eq 0) { return '' }
  return ([string]$l[0]).Substring($prefixo.Length)
}

function Invoke-Manutencao {
  $m = Join-Path $PastaVmScripts 'pf-vm-manutencao.ps1'
  if (-not (Test-Path -LiteralPath $m)) { throw "Nao achei $m (o reinicio com aviso depende dele)." }
  $argsM = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $m, '-Aplicar', '-Minutos', [string]$Minutos)
  if ($Forcar) { $argsM += '-Forcar' }
  if ($VmIp) { $argsM += @('-VmIp', $VmIp) }
  & pwsh @argsM
  return $LASTEXITCODE
}

try {
  $modo = 'SIMULACAO'
  if ($Aplicar) { $modo = 'APLICAR' }
  if ($Reverter) { $modo = 'REVERTER' }
  if ($SoValidar) { $modo = 'VALIDAR' }
  if ((@($Aplicar, $Reverter, $SoValidar) | Where-Object { $_ }).Count -gt 1) { throw 'Use apenas uma opcao: -Aplicar, -Reverter ou -SoValidar.' }
  Write-Titulo "jms-vm12: modo $modo"

  # IP da VM: o mesmo que os pf-vm-* usam (parametro padrao do pf-vm-manutencao.ps1), sem repetir aqui.
  if (-not $VmIp) {
    $m = Join-Path $PastaVmScripts 'pf-vm-manutencao.ps1'
    if (Test-Path -LiteralPath $m) {
      $linha = Select-String -LiteralPath $m -Pattern "\[string\]\`$VmIp\s*=\s*'([^']+)'" | Select-Object -First 1
      if ($linha) { $VmIp = $linha.Matches[0].Groups[1].Value }
    }
  }
  if (-not $VmIp) { throw 'Nao achei o IP da VM. Passe -VmIp.' }

  $script:ChaveSsh = $VmChaveSsh
  if ([string]::IsNullOrWhiteSpace($script:ChaveSsh)) { $script:ChaveSsh = Join-Path $env:USERPROFILE '.ssh\id_ed25519_particularflix' }
  if (-not (Test-Path -LiteralPath $script:ChaveSsh)) { throw "Nao achei a chave SSH em: $($script:ChaveSsh)" }

  if ($Reverter) {
    Write-Titulo 'Restaurando os arquivos do backup mais recente na VM'
    $r = Invoke-NaVm @('revert')
    $r.Saida | ForEach-Object { Write-Host $_ }
    if ($r.Codigo -ne 0) { throw 'A restauracao falhou. Veja a saida acima.' }
    Write-Titulo "Reiniciando o Jellyfin da VM com aviso ($Minutos min)"
    $c = Invoke-Manutencao
    if ($c -ne 0) { throw "O pf-vm-manutencao.ps1 terminou com codigo $c." }
    Write-Host 'Reversao concluida.' -ForegroundColor Green
    exit 0
  }

  if (-not $Versao) { throw 'Informe -Versao (ex.: -Versao 4.0.0.11).' }
  if ($Versao -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Versao invalida: $Versao" }

  # ---- 1. confere a publicacao no GitHub (manifest do main, release e header da tag) ----
  Write-Titulo "Conferindo a publicacao da $Versao no GitHub"
  $urlManifest = "https://raw.githubusercontent.com/$Repo/main/manifest.json"
  $manifest = (Invoke-WebRequest -Uri $urlManifest -Headers @{ 'Cache-Control' = 'no-cache' }).Content | ConvertFrom-Json
  $entrada = @($manifest)[0].versions | Where-Object { $_.version -eq $Versao } | Select-Object -First 1
  if (-not $entrada) { throw "A $Versao nao esta no manifest.json do main ($urlManifest). Publique o release antes." }
  $urlZip = [string]$entrada.sourceUrl
  $md5 = ([string]$entrada.checksum).ToLower()
  $urlHeader = "https://raw.githubusercontent.com/$Repo/v$Versao/extras/particularflix-modern-header.js"
  Write-Host "Zip     : $urlZip"
  Write-Host "MD5     : $md5 (manifest)"
  Write-Host "Header  : $urlHeader"
  $tmpH = Join-Path ([System.IO.Path]::GetTempPath()) ('jms-header-' + $Versao + '.js')
  Invoke-WebRequest -Uri $urlHeader -OutFile $tmpH -Headers @{ 'Cache-Control' = 'no-cache' } | Out-Null
  $shaHeaderGit = (Get-FileHash -LiteralPath $tmpH -Algorithm SHA256).Hash
  Remove-Item -LiteralPath $tmpH -Force -ErrorAction SilentlyContinue
  Write-Host "SHA256 do header na tag: $shaHeaderGit"

  if ($SoValidar) {
    $c = Invoke-NaVm @('check')
    $c.Saida | ForEach-Object { Write-Host $_ }
    $v = Invoke-NaVm @('validate')
    $v.Saida | ForEach-Object { Write-Host $_ }
    $ok = ((Get-Linha $c.Saida 'PLUGIN_VERSAO_ATIVA=') -eq $Versao) -and ((Get-Linha $c.Saida 'PLUGIN_STATUS=') -eq 'Active') -and ((Get-Linha $v.Saida 'HEADER_SERVIDO_SHA=') -eq $shaHeaderGit)
    if ($ok) { Write-Host "VALIDADO: JMSFusion $Versao ativo e header servido igual ao da tag." -ForegroundColor Green; exit 0 }
    Write-Host 'CONFERIR: versao, status ou header nao bateram (veja acima).' -ForegroundColor Yellow
    exit 1
  }

  # ---- 2. le a VM e confere o download la ----
  Write-Titulo 'Situacao atual na VM (e download conferido num /tmp da VM)'
  $c = Invoke-NaVm @('check', $Versao, $urlZip, $md5, $urlHeader)
  $c.Saida | ForEach-Object { Write-Host $_ }
  if ($c.Codigo -ne 0) { throw 'A leitura ou o download na VM falhou (nada foi alterado).' }
  if ((Get-Linha $c.Saida 'NOVO_HEADER_SHA=') -ne $shaHeaderGit) { throw 'O header que a VM baixou difere do que o PC baixou. Nada foi alterado.' }
  $atual = Get-Linha $c.Saida 'PLUGIN_VERSAO_ATIVA='

  Write-Titulo 'Plano'
  Write-Host "Versao ativa na VM: $atual  ->  nova: $Versao"
  Write-Host '1. backup dos arquivos do plugin e do header em ~/backups/jms-plugin-<data> na VM'
  Write-Host '2. trocar DLL, meta.json e icon.png no volume do plugin e o header na pasta custom (troca atomica)'
  Write-Host "3. reiniciar pelo pf-vm-manutencao.ps1, avisando $Minutos minuto(s) antes"
  Write-Host '4. validar: JMSFusion Active na versao nova e header servido igual ao da tag'

  if (-not $Aplicar) {
    Write-Host ''
    Write-Host 'Simulacao concluida. Nada foi alterado.' -ForegroundColor Green
    Write-Host 'Para aplicar, rode o mesmo comando com -Aplicar (e -Minutos N para o aviso).'
    exit 0
  }

  # ---- 3. aplica ----
  Write-Titulo 'Trocando os arquivos na VM (o Jellyfin continua no ar ate o reinicio)'
  $r = Invoke-NaVm @('stage', $Versao, $urlZip, $md5, $urlHeader)
  $r.Saida | ForEach-Object { Write-Host $_ }
  if ($r.Codigo -ne 0 -or (Get-Linha $r.Saida 'STAGED=') -ne 'ok') { throw 'A troca falhou. Veja a saida acima. Se o backup foi feito, o -Reverter devolve os arquivos.' }

  Write-Titulo "Reiniciando o Jellyfin da VM com aviso ($Minutos min)"
  $cm = Invoke-Manutencao
  if ($cm -ne 0) { Write-Host "AVISO: o pf-vm-manutencao.ps1 terminou com codigo $cm (veja acima)." -ForegroundColor Yellow }

  Write-Titulo 'Validacao'
  Start-Sleep -Seconds 10
  $c2 = Invoke-NaVm @('check')
  $v2 = Invoke-NaVm @('validate')
  $ver2 = Get-Linha $c2.Saida 'PLUGIN_VERSAO_ATIVA='
  $st2 = Get-Linha $c2.Saida 'PLUGIN_STATUS='
  $sh2 = Get-Linha $v2.Saida 'HEADER_SERVIDO_SHA='
  Write-Host ("JMSFusion ativo     : {0} ({1})" -f $ver2, $st2) -ForegroundColor $(if ($ver2 -eq $Versao -and $st2 -eq 'Active') { 'Green' } else { 'Red' })
  Write-Host ("Header servido      : {0}" -f $(if ($sh2 -eq $shaHeaderGit) { 'igual ao da tag' } else { "DIFERENTE ($sh2)" })) -ForegroundColor $(if ($sh2 -eq $shaHeaderGit) { 'Green' } else { 'Red' })
  if ($ver2 -eq $Versao -and $st2 -eq 'Active' -and $sh2 -eq $shaHeaderGit) {
    Write-Host ''
    Write-Host "Pronto: JMSFusion $Versao na VM. Abra https://particularflix.duckdns.org em janela anonima (Ctrl+F5)." -ForegroundColor Green
    exit 0
  }
  Write-Host 'CONFERIR: a versao nova nao ficou ativa ou o header nao bateu. O -Reverter devolve os arquivos anteriores.' -ForegroundColor Yellow
  exit 1
}
catch {
  Write-Host ''
  Write-Host ("ERRO: {0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 1
}
# fim
