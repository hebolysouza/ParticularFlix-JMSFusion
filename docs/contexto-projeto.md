# ParticularFlix: contexto do projeto (fork JMSFusion, producao, teste e VM)

Estado em 08/11/2026, no fim do ciclo da versao 4.0.0.11. Leitura obrigatoria para qualquer sessao nova (Claude Code no
PC ou na nuvem) antes de mexer no fork. Atualize este arquivo no fim de cada ciclo (versao, hashes, backups, pendencias).

NAO contem senhas, chaves de API, tokens, IP da VM nem dados de acesso SSH. Ele diz ONDE cada coisa fica.

---

## 0. Como comecar na conta nova (PRIMEIRO, antes de tudo)

### 0.1 O que so o Heboly faz (uma vez, antes de o Claude rodar)

O login nao pode ser feito pelo Claude: e o que liga o Claude ao PC. Sao 4 passos.

1. **Conta**: em https://claude.ai, criar a conta com o e-mail PESSOAL e assinar o Pro.
2. **Login no Claude Code (CLI ja instalado no PC, versao 2.1.319, ja no PATH)**. Num PowerShell novo:
   ```powershell
   Set-Location "D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion"
   claude
   ```
   Dentro do Claude Code, digitar `/logout` (sai da cobranca por API da conta antiga), depois `/login`, escolher
   **Claude account with subscription** (Pro/Max, NAO a opcao de API/Console) e entrar no navegador com a conta pessoal.
   O cabecalho deve mostrar o plano (e nao "API Usage Billing"). Se perguntar se confia na pasta, responder sim.
3. **GitHub**: o git do PC ja esta logado como `hebolysouza` (Git Credential Manager; os `git fetch`/`checkout` funcionam).
   Nada a fazer para o Claude Code no PC. So para usar o Claude Code na NUVEM (claude.ai/code), conectar o GitHub em
   claude.ai, Settings, Connectors (ou na primeira sessao do claude.ai/code) e dar acesso ao repositorio
   `hebolysouza/ParticularFlix-JMSFusion`.
4. **Primeira mensagem para o Claude**: anexar este arquivo (ou dizer "leia docs/contexto-projeto.md") e escrever:
   > Leia este arquivo inteiro e execute a secao 0.2 (preparacao). Depois me diga o estado atual e as pendencias.

### 0.2 Roteiro de preparacao para o Claude (executar sozinho ao receber este arquivo)

Claude: rode estes passos no PC do Heboly (PowerShell, a partir de `D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion`),
um por vez, mostrando o resultado. Sao leituras, exceto onde diz "pedir SIM". Nao altere producao, teste nem VM.

1. Ferramentas (leitura):
   ```powershell
   & {
     foreach ($t in @("git", "pwsh", "docker", "ssh", "scp", "gh", "claude")) {
       $c = Get-Command $t -ErrorAction SilentlyContinue
       if ($c) { "{0}: {1}" -f $t, $c.Source } else { "{0}: NAO encontrado" -f $t }
     }
     git --version ; claude --version
   }
   ```
2. Repositorio (leitura; o clone deve estar limpo no `main`, igual ao GitHub):
   ```powershell
   & {
     Set-Location "D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion"
     git remote -v
     git fetch origin
     git status -sb
     git log --oneline -3 origin/main
     if (-not (Test-Path ".claude\skills\particularflix-fork-release\SKILL.md")) { "AVISO: skill particularflix-fork-release ausente (rode git checkout -B main origin/main)" }
     if (-not (Test-Path ".claude\skills\jms-ciclo-release\SKILL.md")) { "AVISO: skill jms-ciclo-release ausente" }
     if (-not (Test-Path "docs\contexto-projeto.md")) { "AVISO: docs\contexto-projeto.md ausente" }
   }
   ```
   Se o clone estiver limpo mas atras do `main`: `git checkout -B main origin/main` (pedir SIM antes se houver
   alteracoes locais; nunca descartar alteracoes do Heboly).
3. Carregar as skills de projeto `particularflix-fork-release` e `jms-ciclo-release` e ler `CLAUDE.md`.
4. Estado dos servidores (leitura):
   ```powershell
   & {
     docker ps -a --filter "name=jellyfin" --format "{{.Names}}: {{.Status}} ({{.Image}})"
     try { $i = Invoke-RestMethod "http://127.0.0.1:8096/System/Info/Public" -TimeoutSec 10 ; "Producao: Jellyfin " + $i.Version } catch { "Producao: sem resposta em 8096" }
     docker run --rm --entrypoint sh -v jms-prod-plugin-40000:/p lscr.io/linuxserver/jellyfin:12.3.0-validado -c 'sha256sum /p/Jellyfin.Plugin.JMSFusion.dll; grep version /p/meta.json'
     Get-ChildItem "D:\JellyfinDownloads\jms-fork\backups-teste12" -Directory | Select-Object -ExpandProperty Name
   }
   ```
   Esperado em 08/11/2026: `jellyfin` Up (imagem `12.3.0-validado`), `jellyfin-jms-teste-12` Exited (0), producao 12.3.0,
   DLL `9c92e558...8138e813`, versao 4.0.0.11.
5. VM (leitura, so se o Heboly quiser conferir agora): `pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\JellyfinDownloads\jms-fork\jms-vm12.ps1" -SoValidar -Versao 4.0.0.11`
   (esperado: "VALIDADO: JMSFusion 4.0.0.11 ativo e header servido igual ao da tag").
6. GitHub CLI (opcional, para criar releases sem navegador). Se o passo 1 mostrar `gh: NAO encontrado`, pedir SIM e rodar:
   ```powershell
   winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
   ```
   (em 08/11/2026 o download deu 504 tres vezes; se falhar, seguir sem `gh`: o release e feito pelo navegador, secao 7).
   Depois de instalado, o HEBOLY roda num terminal novo `gh auth login` (GitHub.com, HTTPS, login pelo navegador) e
   `gh auth status`; o Claude nao faz esse login.
7. Responder ao Heboly, em portugues e sem travessoes: o que conferiu, o que esta diferente do esperado, e as pendencias
   da secao 10. Nao iniciar nenhum ciclo sem pedido.

### 0.3 Onde esta o resto

- Skills de projeto: `.claude/skills/particularflix-fork-release/SKILL.md` (mapa do ambiente, regras, Jackett) e
  `.claude/skills/jms-ciclo-release/SKILL.md` (ciclo de release).
- O documento de contexto geral da VM do Heboly (sem dados de acesso) NAO esta no repositorio (e publico): fica com o
  Heboly, anexado ao projeto do claude.ai.

---

## 1. Quem, o que e como trabalhamos

- Dono: Heboly. Respostas SEMPRE em portugues, sem travessoes. Textos publicos (CHANGELOG, README, notas de release,
  manifest) em ingles.
- ParticularFlix: servidor Jellyfin domestico do Heboly (producao no PC dele), com um fork do plugin JMSFusion
  (projeto original JMS / MonWUI de G-grbz, arquivado em 19/08/2026, licenca GPL-3.0) e uma pilha de *arr, Seerr,
  Jackett etc. Ha tambem uma VM Linux de um amigo (Victor) para poucos testadores.
- Forma de trabalho:
  - A sessao do Claude (nuvem) so ve o repositorio. Tudo no PC ou na VM e feito pelo Heboly colando blocos PowerShell
    que o Claude entrega, ou por uma sessao do Claude Code rodando no PC.
  - Blocos PowerShell: cada um dentro de `& { ... }`, travas de linha unica `if (...) { "PARADO: ..." ; return }`, nunca
    `else`/`elseif` em linha propria, caminhos reais (sem placeholders), sem acentos em comandos. Dizer sempre o que e
    esperado na saida. Entregar TODOS os blocos da etapa de uma vez, em ordem.
  - Depois de cada commit: blocos do proximo passo, e a lista exata do que conferir no teste (cada correcao, mais
    regressoes rapidas: botoes do slider, troca automatica, fileiras da home, player, cabecalho, perfis).
  - Validacao visual e sempre do Heboly. Nunca dizer que algo funciona sem teste; dizer o que foi testado e como.
  - Release: so depois de validado em producao. O Heboly quer ACUMULAR mudancas numa versao e publicar menos vezes.
  - Nao reduzir a quantidade de cards do slider (~70) nem desligar funcoes para ganhar desempenho: medir.

---

## 2. Repositorio do fork

- GitHub: `https://github.com/hebolysouza/ParticularFlix-JMSFusion` (publico).
- Catalogo do Jellyfin: `https://raw.githubusercontent.com/hebolysouza/ParticularFlix-JMSFusion/main/manifest.json`
- Clone no PC: `D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion` (hoje no `main`, commit `5748f00`).
- Plugin: C#, net10.0, Jellyfin 12.x, `targetAbi 12.0.0.0`, assembly `Jellyfin.Plugin.JMSFusion.dll`,
  GUID `c0b4a5e0-2f6a-4e70-9c5f-1e7c2d0b7f12`. JS e CSS em `Resources/slider` sao EMBUTIDOS na DLL: qualquer mudanca
  de JS precisa de rebuild.
- Versao de um build fica em 4 lugares: `JMSFusion.csproj` `<Version>`, `Resources/slider/modules/config.js`
  (`version: "vX"`), `meta.json` (versao e caminhos do icone), secao nova no topo do `CHANGELOG.md`. O `manifest.json`
  so muda no release, depois que o zip existe.
- Scripts de marca (cabecalho moderno etc.): fonte em `extras/`; no Jellyfin 12 rodam pela pasta `custom` do JMS
  (nao pela DLL). Hoje no repo: `extras/particularflix-modern-header.js`, `extras/jms-netfin-local12.ps1`,
  `extras/jms-vm12.ps1`.
- Comentarios do fork comecam com `Fork ParticularFlix` e explicam o porque, na lingua do arquivo.
- Sessao na nuvem nao tem SDK .NET: revisar C# com cuidado; `node --check` em todo JS alterado antes do commit. O
  primeiro build real e o `jms-teste12.ps1` no PC.

### Estado do repositorio em 08/11/2026

- `main` = `5748f00` (igual ao branch `claude/mobile-layout-audit-bjbjad`, que pode ser descartado ou reaproveitado).
- Tag e release publicado: `v4.0.0.11` no commit `bfd8f8a` (Latest).
- Releases publicados: 4.0.0.11, 4.0.0.9, 4.0.0.7, 4.0.0.6, 4.0.0.2 (4.0.0.8 e 4.0.0.10 nunca foram publicados
  sozinhos; entraram nos seguintes).
- Notas do release 4.0.0.11: `docs/releases/v4.0.0.11.md`.
- Branch antigo `hebolysouza/upbeat-mayer-h1e804`: onde a 4.0.0.10 foi feita (ja incorporado).

### Versao 4.0.0.11 (publicada)

| Item | Valor |
|---|---|
| DLL SHA256 | `9c92e55864266942517532d22268ce7b95cabbe27ccdd7b4f5413be58138e813` (64116224 bytes) |
| Zip | `JMSFusion-4.0.0.11-server.zip`, 57867189 bytes, MD5 `1d805ac74281e9605a0724dedf33c986` |
| timestamp (manifest) | `2026-11-08T10:22:47.0000000Z` |
| Cabecalho (custom) | `particularflix-modern-header.js`, SHA256 `FB0536...7A48D8` (LF) = `141EAC...DA0937` (CRLF, como esta na producao) |
| Producao | trocada em 08/11 07:29 |
| VM | trocada em 08/11 ~10:56 |

---

## 3. Ambiente no PC (Windows, Docker Desktop/WSL2)

- Compose principal: `D:\JellyfinDownloads\docker\docker-compose.yml` (projeto `docker`).
- Appdata do Jellyfin de producao: `D:\JellyfinDownloads\appdata\jellyfin` (= `/config`).
- PRODUCAO: container `jellyfin`, imagem LOCAL `lscr.io/linuxserver/jellyfin:12.3.0-validado` (nunca `latest`; e imagem
  local, `docker compose pull` nao atualiza), porta 8096, acesso externo pelo Tailscale
  (`particularflix.taile54a18.ts.net`). Usuario admin da producao: `heboly`.
  - Plugin no volume nomeado `jms-prod-plugin-40000`, montado em `/config/data/plugins/JMSFusion_4.0.0.0` (o nome da
    pasta fica 4.0.0.0; o Jellyfin le a versao do `meta.json`).
  - Pasta `custom` da producao: `D:\JellyfinDownloads\appdata\jellyfin\data\plugins\configurations\JMSFusion\custom`.
- TESTE (staging): container `jellyfin-jms-teste-12` (imagem `lscr.io/linuxserver/jellyfin:latest`), `http://127.0.0.1:8197`
  (so local). Config em `D:\JellyfinDownloads\jms-fork\teste-12\config` (clonada da producao: usuarios da producao,
  admin `heboly`; criado tambem o usuario comum `user` para testes). Plugin no volume `jms-teste-plugin-39000`, montado em
  `/config/data/plugins/JMSFusion_3.9.0.0`. Pasta `custom` do teste:
  `D:\JellyfinDownloads\jms-fork\teste-12\config\data\plugins\configurations\JMSFusion\custom`.
  O teste NAO tem Home Screen Sections ativo de forma igual a producao: o que depende do HSS se confirma na producao.
  O teste so fica ligado enquanto se testa; no fim de cada ciclo: `jms-teste12.ps1 -Parar`.
- Volumes que FICAM: `jms-prod-plugin-40000` (em uso), `jms-prod-plugin-38245` (rollback 10.11 + 3.8.2.45),
  `jms-teste-plugin-39000` (teste 12).
- Pasta `custom` do JMS: o JMS injeta na pagina todo `.js` e `.css` dessa pasta (ordem alfabetica, `?v=<data de
  modificacao>`), servidos em `/JMSFusion/custom/<nome>`. Arquivos que comecam com `_` e fontes sao servidos sem
  injetar (NetFin local desde a 4.0.0.7: `_netfin.css`, `_pf-fonts.css`, `_nf-*.woff2`). Arquivos de marca la:
  `particularflix-logo.js`, `particularflix-logo-align.css`, `particularflix-modern-header.js`,
  `particularflix-pip-fix.js`, `particularflix-row-arrows.js`, `particularflix-slider-arrows.js`.
  NUNCA deixar backup `.js`/`.css` nessa pasta (seria injetado).
- Backups: `D:\JellyfinDownloads\jms-fork\backups-teste12`. Estado em 08/11 (so o util):
  - `volume-prod-20261108-070806`: volume da producao com a 4.0.0.10 (rollback um passo atras).
  - `custom-prod-antes-4.0.0.11-20261108-070749`: cabecalho da producao antes da 4.0.0.11.
  - `customtabs-20261027-105414`: XML do Custom Tabs (desativado nos dois servidores desde 27/10).
  - `brand-`, `configurations-`, `hss-` (2), `pph-20261025-*`: registro da migracao para o 12.
  - Backup da migracao 10.11 -> 12: `D:\JellyfinDownloads\ServerBackups\deploy-jms-fork-20261025-120951-4.0.0.0`.
- Zip publicado guardado em `D:\JellyfinDownloads\jms-fork\release-4.0.0.11\`.
- Ferramentas no PC: git (`C:\Program Files\Git`), ssh/scp do Windows, PowerShell 7 (`pwsh`), Claude Code.
  GitHub CLI (`gh`) NAO instalado: o winget falhou 3 vezes com 504 do GitHub em 08/11. Sem `gh`, o release e criado
  pelo navegador (funciona bem; ver secao 7).
- Plugins da producao (08/11): Chapter Segments Provider 5.0.0.0, Custom Tabs 0.3.2.0 (Disabled, intencional), Fanart
  15.0.0.0, File Transformation 3.0.3.0, Home Screen Sections 3.0.4.0, InPlayerEpisodePreview 2.5.0.3, Intro Skipper
  12.0.6.0, JavaScript Injector 4.1.0.0, Jellyfin Enhanced 12.15.0.0, Jellyfin Oscars 1.0.6.0, JMSFusion 4.0.0.11,
  MDBList Ratings 1.0.1.0, ParticularFlix Backdrop Order 1.0.0.0, Playback Reporting 19.0.0.0, Plugin Pages 3.0.3.0,
  SeerrFin 1.9.2.2, Telegram Notifier 12.3.0.0. Atualizacao automatica de plugins deve ficar DESLIGADA na producao.
- Layout do Jellyfin 12 usado: "Modern" (experimental layout). O JMS usa slider Peak (`cssVariant=peakslider`).

---

## 4. Scripts do fluxo 12 (em `D:\JellyfinDownloads\jms-fork`)

Rodar sempre com `pwsh -NoProfile -ExecutionPolicy Bypass -File ".\<script>" ...`.

- `jms-teste12.ps1 -Branch <branch> -Versao <ver>`: exige clone limpo, faz `checkout -B <branch> origin/<branch>`,
  confere a versao do csproj, compila (SDK .NET 10, saida em `jms-fork\build-12`), para so o teste, copia DLL + meta.json +
  icon.png para o volume do teste, confere hash, religa (ate 8 min) e valida 6 arquivos servidos. `-SoValidar` (leitura),
  `-Parar`. NAO leva a pasta `custom` (script de marca vai a mao, com backup fora da pasta, e confere o hash servido em
  `http://127.0.0.1:8197/JMSFusion/custom/<nome>` com `Accept-Encoding: identity`).
- `jms-janela12.ps1 -Modo TrocarDll -VersaoPlugin <ver>`: producao. Compara volumes, pede SIM (ninguem assistindo),
  backup do volume em `backups-teste12\volume-prod-<data>`, copia o volume do teste para `jms-prod-plugin-40000`, confere
  hash por arquivo, religa e roda o Validar. NAO leva a `custom`. Rollback: copiar o backup de volta e religar.
  `-Modo Validar`: so leitura. (Ele mostra "JMSFusion 4.0.0.0 ?" porque le o nome da pasta: normal. Custom Tabs Disabled
  aparece como [AVISO]: normal.)
- `jms-release12.ps1 -Modo Zip -Versao <ver> -DllEsperada <SHA256>`: monta o zip a partir do volume da producao e imprime
  ARQUIVO, TAMANHO, MD5, TIMESTAMP. `-Modo Verificar -Versao <ver>`: baixa o zip publicado e confere com o manifest do
  `main` (so passa DEPOIS do push do manifest no `main`).
- `jms-limpeza12.ps1 -Modo Simular|Limpar`: as listas estao fixas para o ciclo 4.0.0.0; atualizar antes de usar (no
  ciclo 4.0.0.11 a limpeza foi feita com blocos avulsos).
- `jms-comparar12.ps1`: so leitura, compara producao x teste (relatorio em `D:\Downloads`).
- `jms-vm12.ps1`: deploy na VM (fonte `extras/jms-vm12.ps1`, ver secao 6). Instalado em `jms-fork` em 08/11.
- `jms-netfin-local12.ps1 -Ambiente Teste|Producao -Modo Simular|Aplicar`: baixa o tema NetFin e fontes para a `custom`.
- Da migracao (ler antes de usar): `jms-prod12.ps1`, `jms-plugins12.ps1`, `jms-clonar-configs12.ps1`, `jms-hss12.ps1`,
  `jms-pph12.ps1`, `jms-tarefa-trailers.ps1`. `jms-deploy.ps1` e do fluxo 10.11: nunca usar `-Modo Teste/Preparar/Janela`.

---

## 5. Regras de ouro (valem para tudo)

1. Ordem: codigo -> build -> teste (8197) -> producao em janela curta -> release no GitHub -> VM. Nunca publicar o que
   nao foi validado em producao. Pular o teste so por decisao do Heboly.
2. Backup antes (conferido por hash ou contagem), simular antes, rollback pronto. Mover em vez de apagar.
3. Um passo por vez com saida esperada; parar e perguntar se algo nao bater com o mapa.
4. Docker: nunca `docker run <imagem> <comando>` em mount de producao sem `--entrypoint` (usar
   `docker run --rm --entrypoint sh -v ... -c "..."`); nunca `docker compose up -d` sem nome de servico (risco de ligar o
   Maintainerr); nunca atualizar pelo botao do Arcane.
5. Nao tocar em arquivos pessoais de `D:\Downloads` nem no mount `K:/XXX` (outro projeto). Apagar so o que o projeto criou.
6. `.ps1` novo: `Unblock-File` depois de conferir o hash.
7. Teste parado no fim de cada ciclo (ultimo passo, conferindo `docker ps -a --filter "name=jellyfin"`).
8. Na VM: nao alterar a VM, a producao nem os scripts `pf-vm-*` sem o Heboly pedir. A operacao da VM e do Heboly.
9. Acoes publicas (push no `main`, release) e reinicio de producao/VM: sempre com SIM explicito do Heboly.

---

## 6. VM (testadores de fora)

- VM Ubuntu do Victor (ele tem root), 2 CPU, ~3,8 GB RAM, 100 GB de disco (~60 GB para midia), sem GPU.
- Endereco publico: `https://particularflix.duckdns.org` (DuckDNS + Nginx Proxy Manager, TLS por DNS-01). So 443 e SSH
  abertos. Paineis de admin so por tunel SSH (`pf-vm-tunel.ps1`): Jellyfin da VM no tunel = `http://127.0.0.1:18096`
  (mesmo servidor do endereco publico).
- Acesso: SSH com chave `%USERPROFILE%\.ssh\id_ed25519_particularflix`; IP, porta e usuario ficam nos parametros padrao
  dos scripts `pf-vm-*` (por exemplo `pf-vm-manutencao.ps1`). O usuario SSH tem `sudo -n`.
  Padrao dos scripts: o PC grava um helper (.py/.sh) em `/tmp` da VM por `scp`, roda por `ssh` com `sudo -n` e apaga.
- Pastas na VM: projeto `~/particularflix` (docker compose), dados `/opt/particularflix/appdata`, backups `~/backups`.
- Jellyfin da VM: container `jellyfin`, `/config` = `/opt/particularflix/appdata/jellyfin`.
  O plugin JMSFusion fica DENTRO do appdata: `/opt/particularflix/appdata/jellyfin/data/plugins/JMSFusion_4.0.0.0`
  (nao ha volume proprio do plugin, diferente da producao). XML do JMS:
  `/opt/particularflix/appdata/jellyfin/data/plugins/configurations/Jellyfin.Plugin.JMSFusion.xml`.
  Pasta custom: `/opt/particularflix/appdata/jellyfin/data/plugins/configurations/JMSFusion/custom`.
  A chave de API do Jellyfin da VM fica no XML do JMS (`JFApiKey`), usada pelos scripts sem imprimir.
- Usuarios da VM: `admin` (administrador), `teste` (somente leitura, modelo), `victor` (copia da politica do `teste`).
  Todos ocultos nas telas de login. Opcao `profileChooserHideUsersFromRegularUsers` LIGADA nos snapshots globais desktop
  e mobile da VM (usuario comum ve so o proprio card e o "Voltar ao administrador").
- Scripts da VM do Heboly em `D:\JellyfinDownloads\vm-teste` (46 `pf-vm-*.ps1`, todos com SIMULACAO por padrao,
  `-Aplicar`, `-Reverter`). Os relevantes para o fork:
  - `pf-vm-manutencao.ps1`: reinicia o Jellyfin da VM AVISANDO quem assiste (mensagem nativa e aviso do Enhanced),
    espera ficar saudavel e confere que os plugins voltaram. Modos: simulacao, `-TestarAviso`, `-Aplicar -Minutos N`,
    `-Forcar`.
  - `pf-vm-layout.ps1` (leva o snapshot de layout do `heboly` da producao para o `admin` e para o global desktop da VM),
    `pf-vm-jms-perfis.ps1` (liga a opcao de esconder usuarios), `pf-vm-jms-diff.ps1`, `pf-vm-jms-inventario.ps1`.
  - Regra para reaplicar layout do JMS na VM: fechar todas as abas da VM, aplicar, abrir em anonima, limpar dados do site.
  - Plugins do Jellyfin gravam a configuracao ao DESLIGAR: XML so se edita com o Jellyfin parado.
- `jms-vm12.ps1` (do fork, em `extras/` e instalado em `jms-fork`): leva uma versao JA PUBLICADA para a VM.
  A VM baixa o zip do release (MD5 conferido com o `manifest.json` do `main`) e o cabecalho da tag; backup em
  `~/backups/jms-plugin-<data>`; troca atomica de DLL/meta.json/icon.png e do cabecalho (dono preservado); reinicio pelo
  `pf-vm-manutencao.ps1`; validacao: JMSFusion Active na versao nova e cabecalho servido igual ao da tag.
  Modos: simulacao (`-Versao X`), `-Aplicar -Minutos N`, `-Reverter -Minutos N`, `-SoValidar`.
  Ele acha a pasta do plugin num mount proprio OU dentro do `/config`; com mais de uma pasta JMSFusion, recusa e lista.
- Estado da VM em 08/11: JMSFusion 4.0.0.11 Active; rollback em `~/backups/jms-plugin-20261108-105044` (4.0.0.10).
- Pendencias da VM (do documento de contexto do Heboly, operacao dele): retorno do Victor; usuario da mae do Heboly
  (`pf-vm-usuario.ps1 -Usuario <nome> -Aplicar` e `pf-vm-senha-auto.ps1 -Usuario <nome> -Aplicar`); esconder as abas
  Solicitacoes e Catalogo do SeerrFin para nao admins; staging na VM; monitorar disco; notificacao de conteudo novo;
  Bazarr com chave da VM; IP fixo/DuckDNS; backup do NPM; rotacionar a chave do Gemini (producao).

---

## 7. Ciclo de release (como foi feito na 4.0.0.11, e como repetir)

Roteiro completo na skill de projeto `.claude/skills/jms-ciclo-release/SKILL.md`. Resumo com o que aprendemos:

1. Pre-checagem: versao nos 4 lugares, `node --check` nos JS alterados, clone limpo.
2. Teste: `jms-teste12.ps1 -Branch <b> -Versao <v>` (primeiro build real do C#), cabecalho na custom do teste se mudou,
   conferencia visual pelo Heboly (desktop e celular no modo dispositivo do Edge: F12, Ctrl+Shift+M, escolher aparelho,
   Ctrl+F5; usar aparelhos da lista, nao o modo Responsivo, para o toque contar).
3. Producao (SIM): cabecalho novo na custom da producao ANTES (backup fora da pasta), depois
   `jms-janela12.ps1 -Modo TrocarDll` (reinicia uma vez so), Validar, hash servido do cabecalho, SHA256 da DLL de
   producao x teste. Conferencia visual pelo Tailscale.
4. Zip: `jms-release12.ps1 -Modo Zip -Versao <v> -DllEsperada <SHA256 da producao>`.
5. Manifest: entrada nova no TOPO de `versions` (edicao minima), `checksum` = MD5 minusculo, `timestamp` = o TIMESTAMP do
   script em UTC ISO (ex.: `2026-11-08T10:22:47.0000000Z`), `sourceUrl`
   `.../releases/download/v<v>/JMSFusion-<v>-server.zip`, `targetAbi 12.0.0.0`. Commit no branch. Notas em
   `docs/releases/v<v>.md`.
6. Publicar SEM janela de 404: (a) Heboly cria o release no navegador com a tag `v<v>` apontando para o TOPO do branch
   (Target = o branch, nao o `main`), titulo `JMSFusion <v> (ParticularFlix fork)`, notas coladas, zip anexado, Latest;
   (b) depois o `main` avanca por fast-forward para o mesmo commit; (c) `jms-release12.ps1 -Modo Verificar`.
   (Rodar o Verificar antes do passo b falha com "download difere": e esperado.) O raw do GitHub pode cachear uns minutos.
7. VM (SIM): `jms-vm12.ps1 -Versao <v>` (simula e confere o download), depois `-Aplicar -Minutos 5`.
8. Fechamento: limpeza do que o ciclo criou (zips obsoletos, backups superados), teste parado, registro (versao, commits,
   hashes, backups).
- Se uma correcao entrar depois do zip (aconteceu na 4.0.0.11): mesma versao se ainda nao publicada; refazer teste,
  producao, zip e atualizar MD5/timestamp no manifest.

---

## 8. O que foi feito no ciclo 4.0.0.10 + 4.0.0.11 (detalhado)

### 4.0.0.10 (feito em outra sessao, publicado junto com a 4.0.0.11)
- Trailers trocados nunca abaixo de 720p; downloads pausam com pouco espaco no disco da biblioteca.
- Trailers de titulos novos em segundos (vigia das pastas da biblioteca, checagem a cada 10 s, ItemAdded como reserva).
- Rotulos em portugues corrigidos ("56 min restantes" etc.).

### 4.0.0.11: layout mobile
Origem: notas do Heboly de 07/11 ("redesenho do layout mobile"). Medicoes no modo dispositivo a 360x800, 440x956,
924x412/956x440 e 960x1440 (tablet). Decisoes do Heboly: tudo no layout Modern do 12; trocar de perfil visivel; logo so
o icone animado (estilo Netflix); barra de progresso fina; sem trailer no celular (em pe e deitado).

- Criterio unico de "mobile": `getDeviceProfileAuto()` (toque, ou ate 900 px com navegador de celular). Classes no
  `<html>` (main.js, `earlyCssBoot`): `jms-mobile`; `jms-phone` + `jms-phone-portrait` (ate 720 px de largura) ou
  `jms-phone-landscape` (ate 500 px de altura). Funcao `getMobilePhoneSliderMode()` em config.js.
- Cabecalho mobile (extras/particularflix-modern-header.js, classe `pf-mob`): hamburguer, icone do logo, Busca, sino,
  avatar do seletor de perfis (sem nome) e botao "Mais" (⋮). SyncPlay, Transmitir, "Mais do Jellyfin Enhanced", abas do
  Enhanced e outros botoes extras vao para o menu do Mais: os originais NAO saem do DOM (ficam invisiveis, "estacionados"
  em position:fixed no canto superior direito, classe `pf-mob-park`) e o item do menu repassa o clique (assim os menus
  deles abrem ancorados ali). Pilulas de navegacao so na gaveta. Engrenagem do slider (configuracoes do JMS) foi para o Mais.
- Slider no celular (main.js, CSS critico): os blocos do slide viram uma coluna flex (selos de tipo/qualidade; status,
  notas e audio; no pe: logo, frase, sinopse com barra de progresso, diretor/roteiro, botoes, generos/ano/pais). Card quase
  da largura da tela (`--slide-w: calc(100vw - 32px)`). Botoes de 44 px. Cards vizinhos so com imagem e logo. Barra fina
  vermelha de posicao (`.jms-mob-pos`, atualizada em `sliderState.setCurrentIndex`). Deitado: coluna a esquerda, compacta.
  Sem trailer em nenhum modo de celular (`slideCreator.js`: `slide.__initTrailer`, criado so fora do celular; ao virar
  tablet/desktop, o main.js cria os trailers que faltaram).
- Fileiras da Home (nativas e HSS) no celular: ~2,2 cards horizontais e ~3,3 posteres por tela em pe, ~4,3/6,5 deitado;
  setas `.pf-row-arrow` ocultas no toque; titulos menores.

### 4.0.0.11: seguranca (achado durante o trabalho)
- 11 controladores (Arr, Serr, StudioHubs, Trailers, Cast, GmmpSync, ParentalPin, CinemaPreRoll, Lyrics, Comments,
  Watchlist) pegavam a identidade do cabecalho `X-Emby-UserId` (e alguns de `?userId=`), forjavel, e as rotas nao exigem
  login: com o ID do admin, qualquer um agia como admin (ler chaves Radarr/Sonarr, pedir filmes, mudar perfis de acesso,
  ler lista de outro usuario). Correcao: identidade so pela claim `Jellyfin-UserId` do token validado
  (`Controllers/RequestAuth.cs`, ja usado pelo UserSettingsController desde a 4.0.0.7). Comments/Watchlist mantem o
  formato "N" do ID (registros antigos continuam batendo).
- `GET /Users`: no Jellyfin 12 devolve TODOS os usuarios a qualquer logado. `Hosting/UsersListGuard.cs` (middleware no
  `JMSStartupFilter`) corta a resposta para so a propria conta de quem nao e admin (admin, chave de API e anonimo
  intocados; falha = resposta original).
- Teste de seguranca (rodar no Console logado como usuario comum, com o ID do admin):
  ```js
  (async () => {
    const ADMIN = "COLE_O_ID_DO_ADMIN";
    const ac = window.ApiClient, tk = ac.accessToken(), eu = (await ac.getCurrentUser()).Name;
    const users = await fetch(ac.getUrl("Users"), { headers: { "X-Emby-Token": tk } }).then(r => r.json()).catch(() => null);
    const semLogin = await fetch(ac.getUrl("MonWUI/arr/settings"), { headers: { "X-Emby-UserId": ADMIN } }).then(r => r.status);
    const comumFingindoAdmin = await fetch(ac.getUrl("MonWUI/arr/settings"), { headers: { "X-Emby-UserId": ADMIN, "X-Emby-Token": tk } }).then(r => r.status);
    console.log(JSON.stringify({ eu, users: Array.isArray(users) ? users.map(x => x.Name) : users, semLogin, comumFingindoAdmin }));
  })();
  ```
  Esperado: `users` so com o proprio nome, `semLogin` 401, `comumFingindoAdmin` 403. (ID do admin: `ApiClient.getCurrentUserId()` logado como admin.)
  Validado no teste (usuario `user`) em 08/11.

### 4.0.0.11: configuracoes (F2) para quem nao e admin
- Abas visiveis para usuario comum: principal (idioma, slider on/off, som dos trailers, atalho, idioma das resenhas),
  slider/aparencia, estudios, posicoes, pausa, previas, detalhes, minha lista, notificacoes, avatar, Sobre.
- Ocultas: consulta da API, player de musica, seletor de perfis, pre-roll, download de trailers, banco de dados, backup e
  restauracao, secao de ativacao de modulos da aba principal e campo da chave TMDB. (Seerr/Arr, PIN e Controle de acesso
  ja eram so de admin.)
- IMPORTANTE: os campos ficam OCULTOS, nao removidos, porque o `applySettings.js` le todos os campos do formulario e grava
  "desligado" quando um campo nao existe. Abas ocultas tambem nao abrem por atalho (`data-jms-admin-only`).

### 4.0.0.11: seletor de perfis
- Com o `/Users` cortado, o usuario comum perdeu o card do admin (que era o caminho de volta na producao, onde a opcao de
  esconder usuarios esta DESLIGADA). Agora o card "Voltar ao administrador" aparece nos dois modos sempre que o token do
  admin estiver lembrado naquele navegador.

### Ferramentas novas
- Skill `.claude/skills/jms-ciclo-release/SKILL.md` e script `extras/jms-vm12.ps1` (secoes 6 e 7). `CLAUDE.md` aponta
  para a skill.

---

## 9. Armadilhas tecnicas do codigo (para nao repetir)

- Posicoes manuais do slider (Top/Left/Width... em % de tela de desktop) sao aplicadas como estilo INLINE `!important`
  (`positionUtils.applyContainerStyles`) e vencem qualquer CSS de folha. No celular elas sao puladas
  (`isMobilePhoneSlider()`); o resize as devolve.
- Estrutura do slide (slideCreator.js): filhos = `.monwui-bckdrp-cntnr` (fundo, video local e iframe do YouTube),
  `.monwui-format-container`, `.monwui-meta-container` (status, notas, idiomas), `.monwui-main-content-container`
  (logo, titulo, sinopse, provedores), `.monwui-main-button-container` (com o `.monwui-button-container` DENTRO),
  slider de atores, `.monwui-info-container`, `.monwui-director-container`.
- O trailer do YouTube e um `iframe` solto no `.monwui-bckdrp-cntnr` com estilo inline (70% a direita); o Peak ainda tem
  `.monwui-slide iframe { width: 75% !important }`. O video local fica em `.intro-video-container`.
- O Peak tem `.monwui-button-container { visibility: visible !important }`: esconder o pai nao basta, esconder os filhos.
- `.monwui-logo-container` tem `aspect-ratio: 16/9` no Peak; `.monwui-match-rating` (coracao) tem caixa fixa 24x24.
- `slide.isConnected` e falso na criacao do slide (ele e montado antes de entrar na pagina).
- Auto-trailer so inicia com a pagina em foco (`document.hasFocus()`); com o foco no DevTools ele nao toca.
- Controladores do plugin NAO tem `[Authorize]`; a claim `Jellyfin-UserId` existe mesmo assim quando ha token.
  Nunca confiar em `X-Emby-UserId`.
- `applySettings.js` grava "desligado" para campo ausente: esconder, nunca remover campos do formulario.
- Cabecalho moderno: rotas `#/video` escondem a barra; o observer do script so reage a mudancas do cabecalho/gaveta
  (para nao custar layout); nunca interceptar `history.pushState` (quebrava o Enhanced).
- Medir desempenho no Edge InPrivate, painel Performance (Bottom-Up por URL), carga fria. Padroes ja corrigidos: observer
  por slide, observer que reescreve estilo e dispara outro, leitura de layout em callback de MutationObserver, timer sem
  fim, escrita no DOM sem mudanca, slide inativo sem `display:none`.
- Trailers: a RX 6400 nao decodifica AV1 por hardware; o sync pede H.264 primeiro (desde a 4.0.0.3; AV1 fora do
  seletor desde a 4.0.0.8).
- Contas: o Jellyfin revoga o token anterior quando o mesmo usuario entra de novo no mesmo navegador; o seletor confere o
  token lembrado (`/Users/Me`) antes de trocar. Nunca zerar o token do ApiClient num 401 do plugin.
- Home Screen Sections guarda por usuario a lista de secoes em memoria (1 h); mudanca de permissao precisa limpar
  (`AccessControlCore.InvalidateHomeSectionsCache`). O chunk da home modificado pelo HSS sai com no-store (4.0.0.9).
- DLL de ~64 MB nunca carregada de bind mount do Docker Desktop (le paginas erradas): sempre volume nomeado na producao.
- Medicoes uteis no Console: `performance.getEntriesByType("mark")` com prefixo `jms:`.

### Snippets de medicao usados (Console, so leitura)
- Cabecalho/slider/fileiras: lista controles do cabecalho e do slide ativo com posicao, sobreposicoes, itens fora da tela
  e alvos menores que 40 px, mais cards por fileira (foi o primeiro snippet da auditoria mobile).
- Slide ativo: blocos `[class*="-container"]`, `.monwui-logo`, `.monwui-baslik`, `.monwui-slogan`, `.monwui-plot` com
  posicao relativa ao card e flag de corte.
(Pedir ao Claude para reescreve-los se precisar; a logica esta descrita aqui.)

---

## 10. Pendencias e ideias (fork)

- Nenhuma pendencia aberta da 4.0.0.11.
- Seletor de perfis: o Heboly decidiu NAO fazer "esconder usuarios do admin" nem mudar o padrao da opcao para novas
  instalacoes (cada testador so tem o proprio perfil).
- Log da producao: erros de banco (`GET /Items`, EntityFramework) em 07/11 16:20, 19:15, 19:20 (antes desta versao) e
  `Unable to parse bind override` (configuracao de rede antiga) e 2x 403 em `GET /Users/<id do heboly>/Items` durante a
  troca de perfil heboly <-> user. Investigar se repetirem.
- `jms-limpeza12.ps1`: atualizar as listas para o ciclo atual quando for usar.
- Instalar o `gh` (GitHub CLI) quando o download voltar: `winget install --id GitHub.cli -e` ou o instalador de
  https://cli.github.com, depois `gh auth login`. Permite o release sem navegador.
- VM: esconder as abas Solicitacoes e Catalogo do SeerrFin para nao admins (pode envolver script na custom do JMS).
- Notificacao de conteudo novo (decisao do Heboly entre fileira, sino do JMS, Telegram ou e-mail).

---

## 11. Jackett (outro fork do projeto, nao mexido neste ciclo)

- Imagem local `jackett-fork:v0.24.2830-pf2` (producao). Apache, Rede e HDRTorrent sao indexers nativos em C#.
  `D:\JellyfinDownloads\jackett-fork-rebuild.ps1` (`-Modo Verificar` / `-Modo Construir`), overlay em
  `D:\JellyfinDownloads\jackett-fork\overlay`. `jackett-proxy` em `D:\JellyfinDownloads\docker\jackett-proxy`
  (`jackett_proxy.py`, entregar sempre o arquivo completo). Healthcheck diario
  `D:\JellyfinDownloads\jackett-indexers-healthcheck.ps1` (tarefa agendada 09:20). Detalhes na skill `particularflix-fork-release` (Parte 2).

---

## 12. Conta e acesso

- A conta atual do Claude usa um e-mail de empresa ao qual o Heboly nao tem mais acesso: nao consegue fazer login em
  outros lugares (CLI) nem recuperar. Migrar tudo para a conta pessoal (Pro).
- GitHub do Heboly: `hebolysouza` (o repositorio e dele, nao depende da conta do Claude).
- Na conta nova: conectar o GitHub no claude.ai (Claude Code na nuvem) e/ou usar o CLI no PC com `/login` pessoal.

---

## 13. Documentos do projeto antigo no claude.ai (exportar se possivel)

Ficam no projeto "ParticularFlix Home Server" da conta antiga, pasta `claude/`, e nao estao no repositorio:
- Contexto geral da VM: `contexto-geral-vm` (versao sem dados de acesso enviada em 07/11), `registro-vm-teste-etapas`,
  `registro-vm-etapa1-2a-2c`, `registro-bludv-rede-ua-byparr`, `registro-vm-hss-calendario-layout`, `registro-vm-bazarr`,
  `registro-vm-jackett`, `registro-vm-seerrfin-jfkey`, `registro-vm-victor-enhanced-senha-auto`, `pedidos-e-decisoes-vm`,
  `pendencias-vm-teste`.
- Notas para o fork: `nota-jms-fork-layout-mobile-para-claude-code-07-11-2026` (FEITA na 4.0.0.11),
  `nota-jms-fork-seletor-perfis-para-claude-code-07-11-2026` (decidido: so a verificacao de vazamento, feita; resto nao).
- Fork JMS: `registro-jms-fork-*`, `registro-jms-fork-adendo-21-10-2026` (trace de desempenho mobile),
  `registro-migracao-prod-jellyfin12-jms-4.0.0.0-25-10-2026`, `registro-release-jms-fork-3.8.2.26-22-10-2026`,
  `plano-4.0-jms-fork-22-10-2026`, `registro-release-jms-fork-3.7.1.1-21-10-2026`,
  `registro-deploy-release-jms-fork-21-10-2026`, `runbook-deploy-producao-jms-fork-21-10-2026`,
  `jms-fork-build-e-troca-dll-teste.md`, `incidente-dll-grande-bind-mount-21-10-2026.md`.
- Jackett: `registro-jackett-v423-scripts-20-10-2026.md`, `registro-jackett-proxy-20-10-2026.md`,
  `jackett-fork-rebuild.ps1`, snapshots `jackett-proxy-snapshot-v*.py`.
Se nao der para exportar, este arquivo e o repositorio cobrem o necessario para continuar o fork; os registros da VM
estao resumidos na secao 6.
