---
name: "particularflix-fork-release"
description: "Passo a passo completo para criar, testar, implantar em producao e publicar release dos forks do ParticularFlix (plugin JMSFusion e Jackett/jackett-proxy), com backups, travas e rollback."
---

# Fluxo de fork e release do ParticularFlix (JMSFusion e Jackett)

> Copia no repositorio (08/11/2026) da skill que existia so na conta antiga do claude.ai, atualizada com o estado da versao 4.0.0.11. Os registros `claude/...` citados no fim ficam no projeto do claude.ai (podem nao existir na conta nova); o essencial esta aqui, na skill `jms-ciclo-release` e em `docs/contexto-projeto.md`.

Use esta skill sempre que Heboly quiser mudar, corrigir, atualizar ou publicar algo nos forks do ParticularFlix: o plugin JMSFusion do Jellyfin (repo `hebolysouza/ParticularFlix-JMSFusion`) ou a stack do Jackett (imagem local `jackett-fork`, `jackett-proxy`, healthcheck). Antes de agir, leia esta skill inteira e os docs do projeto citados no fim (paths, hashes e volumes mudam a cada versao) e confira o estado real com comandos de leitura. Nunca presuma.

## Regras de ouro (valem para tudo)

1. Responder sempre em portugues. Sem travessoes. Textos publicos (release, CHANGELOG, manifest, README) em ingles.
2. Ordem inviolavel: codigo, build, homologacao no ambiente de teste, producao em janela curta, so entao release no GitHub. Nunca publicar release de algo que nao foi validado em producao. Pular o teste e decisao exclusiva do Heboly (ele ja dispensou quando a mudanca so e visivel em producao, por exemplo por depender do Home Screen Sections, que o teste nao tem); nunca sugerir pular por conta propria.
3. Minimo impacto: backup de tudo que for mexer ANTES, conferido por hash ou contagem; simular a mudanca (diff do compose, container de teste) antes; sempre ter rollback pronto e testado em teoria; mover (Move-Item) em vez de apagar.
4. Passo a passo, um bloco por vez, esperando a saida do Heboly. Sem sugestoes laterais no meio da execucao. Sempre dizer o que e esperado na saida.
5. PowerShell: blocos autocontidos (definir `$bk`, `$out`, `$repo` etc. no proprio bloco), caminhos reais preenchidos, nunca placeholders, sem acentos nem caracteres especiais em comandos e nomes de arquivo. Evitar `else`/`elseif` em linha nova depois de `}` fora de bloco `if`. Blocos de janela de deploy em partes curtas (um bloco longo com here-string foi cortado no colar e deixou o servidor parado).
6. Todo .ps1 entregue: `Unblock-File -LiteralPath "<caminho>"` depois da conferencia de hash, e execucao com `pwsh -NoProfile -ExecutionPolicy Bypass -File "<script>"` (tambem em tarefas agendadas).
7. Docker: nunca `docker run <imagem> <comando>` em mount de producao sem `--entrypoint` (sobe um segundo servidor). Usar `docker run --rm --entrypoint sh -v ... -c "..."`. Nunca `docker compose up -d` sem nome de servico (risco de ligar o Maintainerr). Atualizar sempre via compose, nunca pelo botao do Arcane. Imagem do Jellyfin da producao fica fixada na tag local `lscr.io/linuxserver/jellyfin:12.3.0-validado` (nunca `latest` na producao: ja quebrou tudo; e imagem local, `docker compose pull` nao a atualiza).
8. Se nao souber como algo funciona, dizer claramente e validar com leitura ou teste antes de repassar.
9. Arquivos pessoais de `D:\Downloads` (inclusive .mp4) e o mount `K:/XXX` (projeto xxxflix) NAO podem ser tocados. Apagar so o que o proprio projeto criou.
10. Diagnosticar por camadas, com dados reais, uma mudanca por vez. Nao propor desligar funcionalidade como solucao.
11. O container de teste (`jellyfin-jms-teste-12`) so fica no ar enquanto se testa. Ao encerrar um ciclo (release, limpeza ou rodada de testes), o ULTIMO passo entregue PARA o teste (`docker stop -t 60 jellyfin-jms-teste-12` ou `.\jms-teste12.ps1 -Parar`, conferindo com `docker ps -a --filter "name=jellyfin"`: `jellyfin` Up e teste Exited (0)). Isso vai SEMPRE junto com a limpeza (secao 1.6b), sem esperar o Heboly lembrar. Parar nao apaga nada; religar com `docker start jellyfin-jms-teste-12` (~2 min).
12. PowerShell entregue em blocos `& { ... }` (o bloco so executa quando chega inteiro, mesmo colado linha a linha), com travas por `if (...) { "PARADO: ..." ; return }` em linha unica. Nunca `elseif`/`else` em linha propria. Cada bloco diz o que e esperado na saida.
13. Entregar TODOS os blocos de uma etapa de uma vez, em ordem, cada um com a propria trava (o Heboly avisa se algo falhar). Nao esperar a saida de um bloco para mandar o seguinte, salvo quando o proximo depende de um dado que so a saida traz.
14. Ao fim de cada commit novo, mandar a lista exata do que verificar no teste: cada ponto corrigido, o comportamento esperado e as regressoes rapidas (botoes do slider, dots, troca automatica, fileiras da home).
15. Nunca supor o ambiente: se algo nao bater com esta skill (container, volume, caminho), pedir uma leitura (`docker ps -a`, `docker inspect ... Mounts`) antes de mandar qualquer comando que altere algo.

## Sessoes no Claude Code (nuvem)

- A sessao do Claude Code roda num container na nuvem: enxerga so o repositorio `hebolysouza/ParticularFlix-JMSFusion`, esta skill e o que o Heboly cola. NAO enxerga o PC, o Docker, nem conversas e registros do projeto no claude.ai. Tudo que depende do ambiente vem desta skill ou de uma leitura pedida ao Heboly.
- Nao ha SDK .NET na sessao (o proxy bloqueia o download): o C# so compila no PC do Heboly. Revisar o C# com cuidado (nullable, nomes, usings) e checar o JS com `node --check` antes do commit.
- Desenvolver no branch indicado pela sessao (`claude/...`), commit com mensagem clara e `git push -u origin <branch>`. Nao abrir PR sem pedido. A versao do build vai no csproj, `Resources/slider/modules/config.js` (`version: "vX"`) e `meta.json`; o CHANGELOG ganha secao nova em ingles. O `manifest.json` so muda depois que o zip existir (1.5).
- Os scripts de marca (header moderno) tem a fonte no repo em `extras/particularflix-modern-header.js`; no Jellyfin 12 eles rodam pela pasta `custom` do JMS (ver mapa).

## Mapa do ambiente (Jellyfin 12, desde 25/10/2026)

- Compose principal: `D:\JellyfinDownloads\docker\docker-compose.yml` (projeto `docker`). Appdata do Jellyfin: `D:\JellyfinDownloads\appdata\jellyfin` (= `/config`).
- Producao: container `jellyfin`, imagem local `lscr.io/linuxserver/jellyfin:12.3.0-validado`, porta 8096 (acesso externo pelo Tailscale). Plugin no volume `jms-prod-plugin-40000`, montado em `/config/data/plugins/JMSFusion_4.0.0.0` (o nome da pasta fica 4.0.0.0 mesmo com DLL 4.0.0.x: o Jellyfin le a versao do `meta.json`).
- Teste: container `jellyfin-jms-teste-12` (imagem `lscr.io/linuxserver/jellyfin:latest`, era 12.3 na migracao), `http://127.0.0.1:8197` (so local). Config em `D:\JellyfinDownloads\jms-fork\teste-12\config`. Plugin no volume `jms-teste-plugin-39000`, montado em `/config/data/plugins/JMSFusion_3.9.0.0` (mesmo caso do nome da pasta). `brand.sh` do teste: `teste-12\config\particularflix-brand.sh`.
- Volumes que FICAM: `jms-prod-plugin-40000` (em uso), `jms-prod-plugin-38245` (rollback 10.11 + 3.8.2.45), `jms-teste-plugin-39000` (teste 12).
- Scripts de marca no 12: o JMS injeta na pagina todo `.js` e `.css` da pasta `<config>\data\plugins\configurations\JMSFusion\custom\` (ordem alfabetica, `?v=<data de modificacao>`), servidos em `/JMSFusion/custom/<nome>`. Producao: `D:\JellyfinDownloads\appdata\jellyfin\data\plugins\configurations\JMSFusion\custom`. Teste: `D:\JellyfinDownloads\jms-fork\teste-12\config\data\plugins\configurations\JMSFusion\custom`. Arquivos la: `particularflix-logo.js`, `particularflix-logo-align.css`, `particularflix-modern-header.js`, `particularflix-pip-fix.js`, `particularflix-row-arrows.js`, `particularflix-slider-arrows.js`. NUNCA deixar backup `.js`/`.css` nessa pasta (seria injetado): backups vao para `jms-fork\backups-teste` ou `backups-teste12`. Os `particularflix-*.js` na raiz do config sao do fluxo antigo (brand.sh).
- Clone do fork: `D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion`. Backups: `D:\JellyfinDownloads\ServerBackups\deploy-jms-fork-<data>-<tag>` (o da migracao: `deploy-jms-fork-20261025-120951-4.0.0.0`, restaura 10.11 + 3.8.2.45), `jms-fork\backups-teste`, `jms-fork\backups-teste12`.
- Plugins de terceiros no 12: Home Screen Sections 3.0.3.0 e Plugin Pages 3.0.2.0 compilados para 12.3 (scripts `jms-hss12.ps1`, `jms-pph12.ps1`), Jellyfin Enhanced (abas nativas de Calendar, Requests e Recommendations na home), Seerr (container `seerr`, 5055). Custom Tabs DESATIVADO em 27/10/2026 nos dois servidores (as tres abas escritas duplicavam as do Enhanced); backup do XML em `jms-fork\backups-teste12\customtabs-20261027-105414`.
- Versao em producao (08/11/2026): JMSFusion 4.0.0.11 (DLL `9c92e558...8138e813`), release `v4.0.0.11` publicado em 08/11/2026. Rollback um passo atras: `backups-teste12\volume-prod-20261108-070806` (4.0.0.10) e `backups-teste12\custom-prod-antes-4.0.0.11-20261108-070749` (cabecalho anterior). O `jms-janela12.ps1 -Modo Validar` trata o Custom Tabs `Disabled` como [AVISO], nao como erro, e mostra "JMSFusion 4.0.0.0 ?" porque le o nome da pasta (normal).
- VM dos testadores (`https://particularflix.duckdns.org`): JMSFusion 4.0.0.11 desde 08/11/2026. Na VM o plugin fica DENTRO do appdata (`/opt/particularflix/appdata/jellyfin/data/plugins/JMSFusion_4.0.0.0`), sem volume proprio. Deploy so de versao publicada, com `jms-vm12.ps1` (fonte `extras/jms-vm12.ps1`, instalado em `jms-fork`), que reinicia pelo `pf-vm-manutencao.ps1` do Heboly; rollback em `~/backups/jms-plugin-<data>` na VM com `-Reverter`. Os scripts `pf-vm-*` (em `D:\JellyfinDownloads\vm-teste`) sao do Heboly: nao alterar sem pedido.
- Ciclo completo passo a passo (teste, producao, zip, manifest, release, VM): skill de projeto `jms-ciclo-release`. Contexto geral do projeto: `docs/contexto-projeto.md`.
- NetFin local desde a 4.0.0.7: a pasta `custom` serve (sem injetar) arquivos que comecam com `_` e fontes. `jms-netfin-local12.ps1 -Ambiente Teste|Producao -Modo Simular|Aplicar` (em `jms-fork`, fonte em `extras/`) baixa o NetFin (jsDelivr @main) e as fontes Google para `_netfin.css`, `_pf-fonts.css` e `_nf-*.woff2`. O CSS do branding importa `/JMSFusion/custom/_netfin.css` e `/JMSFusion/custom/_pf-fonts.css`. Para atualizar o tema: rodar o script de novo (teste antes). Fontes de outros plugins (Enhanced, SeerrFin) seguem vindo do Google.

## Scripts do fluxo 12 (em `D:\JellyfinDownloads\jms-fork`, sempre `pwsh -NoProfile -ExecutionPolicy Bypass -File ".\<script>" ...`)

- `jms-teste12.ps1 -Branch <branch> -Versao <ver>`: tudo em um comando para o TESTE. Exige o clone limpo, faz `checkout -B <branch> origin/<branch>`, confere a versao do csproj (os padroes `feat-12` e `3.9.0.0` estao velhos: SEMPRE passar `-Branch` e `-Versao`), compila no SDK .NET 10 em `jms-fork\build-12` (DLL em `build-12\src\out`), para so o teste, copia DLL + meta.json + icon.png para o volume do teste (acha o volume sozinho e recusa bind mount), confere o hash, religa (ate 8 min) e valida seis arquivos servidos contra o clone. `-SoValidar`: so leitura. `-Parar`: para o teste.
  - NAO leva a pasta `custom`: header ou outro script de marca alterado vai a mao para a pasta `custom` do teste (backup fora dela), seguido de `docker restart -t 60 jellyfin-jms-teste-12` e conferencia do hash servido em `http://127.0.0.1:8197/JMSFusion/custom/<nome>` (com `-H "Accept-Encoding: identity"`).
- `jms-janela12.ps1`:
  - `-Modo TrocarDll -VersaoPlugin <ver>`: PRODUCAO com versao nova ja validada no teste. Compara volume do teste x producao, pede SIM (ninguem assistindo), faz backup do volume da producao em `backups-teste12\volume-prod-<data>`, para, copia o volume do teste inteiro para `jms-prod-plugin-40000`, confere hash por arquivo, religa e roda o Validar. Rollback: copiar de volta o backup indicado na saida para o volume e religar. NAO leva a pasta `custom` (copiar os scripts de marca alterados para a `custom` da producao, com backup fora dela).
  - `-Modo Validar`: so leitura (imagem 12.3, volume, plugins, `settingsPage.js` igual ao teste, `/System/Info/Public`, erros no log).
  - `-Modo Preparar` / `-Modo Janela` / `-Modo Rollback`: foram da migracao 10.11 -> 12 (ja feita). O Rollback restaura o appdata inteiro e volta ao 10.11: so com decisao explicita do Heboly.
- `jms-release12.ps1 -Modo Zip -Versao <ver> -DllEsperada <SHA256 da DLL validada>`: monta o zip a partir do volume da producao (DLL, meta.json, icon.png na raiz), confere e imprime tamanho, MD5 e timestamp para o manifest. Depois de publicar: `-Modo Verificar -Versao <ver>`.
- `jms-limpeza12.ps1 -Modo Simular` e `-Modo Limpar`: limpeza do ciclo e parada do teste. As listas (pastas, volumes, backup da janela) estao fixas para o ciclo 4.0.0.0: atualizar o script para o ciclo atual antes de usar.
- `jms-comparar12.ps1`: so leitura, compara producao x teste 12 (marca, CSS do branding, pasta custom, scripts injetados, XML dos plugins, bibliotecas). Relatorio em `D:\Downloads`.
- Outros da migracao (ler antes de usar): `jms-prod12.ps1`, `jms-plugins12.ps1`, `jms-clonar-configs12.ps1`, `jms-hss12.ps1`, `jms-pph12.ps1`, `jms-tarefa-trailers.ps1`.
- `jms-deploy.ps1` e do fluxo 10.11. Em 27/10 o SDK dele foi trocado para 10.0 (backup `jms-deploy.ps1.bak-sdk9-20261027`), entao `-Modo Compilar` funciona (saida em `build-<ver>\src\bin\Release\net10.0`). NUNCA usar `-Modo Teste/Preparar/Janela` dele: cria container 10.11.11 (`jellyfin-jms-teste`) e mexe no compose do jeito antigo.

## PARTE 1: plugin JMSFusion (fork do JMS) no Jellyfin 12

### 1.1 Codigo
- Branch propria (a sessao do Claude Code define o nome). Versionar CADA build que vai para producao (4.0.0.1, 4.0.0.2...). Pontos da versao: `JMSFusion.csproj` `<Version>`, `Resources/slider/modules/config.js` (`version: "vX"`, ja foi esquecido), `meta.json` (versao e caminhos do icone), CHANGELOG (secao nova no topo, em ingles), `manifest.json` (so no release, `targetAbi` `12.0.0.0`). Conferir `git grep -n "<versao antiga>"`.
- JS e CSS vao embutidos na DLL: qualquer mudanca de JS exige rebuild.

### 1.2 Teste (homologacao)
1. `pwsh -NoProfile -ExecutionPolicy Bypass -File ".\jms-teste12.ps1" -Branch <branch> -Versao <ver>` (esperado: build ok, hash do volume igual ao build, startup, "Todas as checagens passaram").
2. Se mudou script de marca (`extras/...`): copiar para a `custom` do teste com backup fora, `docker restart -t 60 jellyfin-jms-teste-12`, conferir hash servido.
3. Teste visual em `http://127.0.0.1:8197` (Ctrl+F5): painel Sobre com a versao nova e a lista de verificacao do commit.
4. Opcional: `jms-comparar12.ps1` para diferencas producao x teste.

### 1.3 Producao (so depois do teste aprovado)
1. Confirmar no Painel que ninguem esta assistindo.
2. `pwsh -NoProfile -ExecutionPolicy Bypass -File ".\jms-janela12.ps1" -Modo TrocarDll -VersaoPlugin <ver>` (digitar SIM). Esperado: backup do volume, volume da producao identico ao do teste, startup, validacao OK.
3. Scripts de marca alterados: copiar para `D:\JellyfinDownloads\appdata\jellyfin\data\plugins\configurations\JMSFusion\custom` (backup antes, fora da pasta) e conferir o hash servido em `http://127.0.0.1:8096/JMSFusion/custom/<nome>`.
4. Validar no navegador pelo endereco do Tailscale (Ctrl+F5): Sobre, home, slider, player, perfis admin e usuario, e a lista do commit (o que depende de Home Screen Sections, Plugin Pages, Seerr e Enhanced tambem se confirma aqui).

### 1.4 Release no GitHub (so depois de validado em producao)
1. `jms-release12.ps1 -Modo Zip -Versao <ver> -DllEsperada <hash>`: anotar ARQUIVO, TAMANHO, MD5, TIMESTAMP.
2. No repo: entrada nova no topo de `versions` do `manifest.json` (edicao minima, sem reindentar), `sourceUrl` `https://github.com/hebolysouza/ParticularFlix-JMSFusion/releases/download/v<ver>/JMSFusion-<ver>-server.zip`, `checksum` MD5 minusculo, `timestamp` do meta.json, `targetAbi` `12.0.0.0`; commit, push e merge fast-forward para `main`. Entre o push do manifest e o release o catalogo aponta para 404: publicar logo.
3. Notas do release em ingles (Markdown cru, cabecalhos com emoji: Install, Upgrade notes, Fixes/New/Performance, Known limitations), entregues como arquivo `.md`; ultima linha a URL do CHANGELOG em texto puro.
4. `releases/new`: tag `v<ver>` (criada na publicacao), Target `main`, titulo `JMSFusion <ver> (ParticularFlix fork)`, anexar o zip, Latest.
5. `jms-release12.ps1 -Modo Verificar -Versao <ver>`.
6. URL do catalogo: `https://raw.githubusercontent.com/hebolysouza/ParticularFlix-JMSFusion/main/manifest.json`.

### 1.5 Limpeza do ciclo (sempre no fim, junto com parar o teste)
- Atualizar as listas do `jms-limpeza12.ps1` para o ciclo (builds `build-<ver>` antigos, `release-<ver>\stage`, backups de volume superados), rodar `-Modo Simular`, conferir com o Heboly e `-Modo Limpar` (para o teste no fim). Nunca tocar `jms-prod-plugin-40000`, `jms-prod-plugin-38245`, `jms-teste-plugin-39000`, `teste-12`, `teste-3.7.1.0`, o backup da migracao, `D:\Downloads` e `K:/XXX`.
- Ultimo passo: teste parado (`docker ps -a --filter "name=jellyfin"`: `jellyfin` Up, `jellyfin-jms-teste-12` Exited (0)).

### 1.6 Armadilhas conhecidas do JMS
- DLL de ~64 MB NUNCA carregada de bind mount do Docker Desktop (le paginas erradas): sempre volume local nomeado. Copiar arquivos pequenos por bind mount e ok.
- Versao esquecida em `config.js` faz o Sobre mostrar versao antiga e aviso falso de atualizacao.
- Hash servido (`settingsPage.js` e os arquivos alterados) e o teste de corrupcao; usar `Accept-Encoding: identity`.
- `IUserManager` e acessado por reflexao (`UserAccessor`).
- Home Screen Sections guarda por usuario a lista de secoes em memoria (1 h): mudanca de permissao precisa limpar (`AccessControlCore.InvalidateHomeSectionsCache`).
- Medir desempenho com o painel Performance do Chrome (carga fria, mesma navegacao antes e depois); nunca prometer ganho nao medido. Os cartoes do slider (o Heboly usa ~70) nao devem ser reduzidos.
- Desempenho medido no Edge InPrivate (sem extensoes), Performance > Bottom-Up agrupado por URL. Em 4.0.0.6: Home ociosa ~12% da thread, com trailer ~22%; o resto da rolagem e renderizacao do navegador, `splashscreen.js` do Jellyfin Enhanced (~1 s, pode ser desligado no Enhanced) e provavelmente o tema NetFin. Padroes ja corrigidos, nao reintroduzir: observer de body por slide, observer que reescreve style e dispara outro observer, getComputedStyle/getBoundingClientRect em callback de MutationObserver, timer sem fim, escrita no DOM sem mudanca, slide inativo sem `display:none`.
- Trailers: a RX 6400 do servidor/cliente nao decodifica AV1 por hardware; o sync pede H.264 (avc1) primeiro desde a 4.0.0.3.
- Atualizacao automatica de plugins deve ficar DESLIGADA na producao (em 28/10/2026 estava ligada: SeerrFin foi para 1.9.1.0 e o File Transformation 3.0.3.0 tentou instalar sozinho).
- Contas e acesso (4.0.0.7): o Jellyfin revoga o token anterior quando o mesmo usuario entra de novo no mesmo navegador; o seletor de perfis confere o token lembrado (`/Users/Me`) antes de trocar. Nunca zerar o token do ApiClient num 401 do plugin (derrubava a sessao). Cache de listas: os arquivos tem nome de hash (escopo + geracao); a limpeza do controle de acesso so apaga orfaos com mais de 14 dias.
- Medir a home sem Performance: no Console, `performance.getEntriesByType("mark")` com prefixo `jms:` (first-slide-ready, data-done) e `performance.getEntriesByType("resource")`.
- Tema NetFin: e CSS personalizado do Jellyfin (branding), fora do repo; contorno dos cards e linhas do bloco de midia dependem dele.

## PARTE 2: Jackett (fork, jackett-proxy, healthcheck)

Contexto: Apache, Rede e HDRTorrent sao indexers nativos em C# dentro de `Jackett.Common.dll` (nao Cardigann). A imagem do Jackett em producao e LOCAL (`jackett-fork:v<ver>-pf<N>`), logo `docker compose pull jackett` e o botao do Arcane NAO atualizam e nao devem ser usados. As issues do upstream sao #17066 (Apache), #17096 e #17097; o mantenedor fechou duas como duplicadas. Hoje as mudancas do Jackett ficam em snapshots, hashes e registros do projeto; NAO existe release no GitHub para elas. Se Heboly quiser publicar algo (PR ao upstream ou release proprio), confirmar o destino antes.

### 2.1 Atualizar o fork do Jackett (imagem local)

- Script: `D:\JellyfinDownloads\jackett-fork-rebuild.ps1` (copia no projeto: `claude/jackett-fork-rebuild.ps1`). Rodar com `pwsh -NoProfile -ExecutionPolicy Bypass -File ...` (depois de `Unblock-File`).
- `-Modo Verificar` (padrao, somente leitura): versao em uso, ultima release no GitHub e comparacao de `PublicBrazilianIndexerBase.cs` e `HDRTorrent.cs` entre a versao em uso e a nova. Nao precisa atualizar so porque saiu versao nova.
- `-Modo Construir [-Versao x.y.z] [-Forcar]`: baixa a tag, aplica os 3 `.cs` de `D:\JellyfinDownloads\jackett-fork\overlay`, compila no SDK .NET (framework lido do csproj), monta `jackett-fork:v<ver>-pf<N+1>`, sobe `jackett-fork-teste` na porta 9218 com copia da configuracao, testa `matrix` e `vingadores` nos 3 indexers (minimo 5 itens) e remove o teste. Nunca troca a producao sozinho; imprime os comandos.
- Troca em producao: backup do compose (`.bak-prepf<N>`), trocar a linha `image:` do servico `jackett` para a tag nova, `docker compose up -d --no-deps jackett` em `D:\JellyfinDownloads\docker`. Rollback: devolver o compose do backup e repetir o `up`.
- Se editar um `.cs` do overlay, usar `-Versao` com a versao que ja roda para gerar a proxima `pfN`.
- A base fica em `src/Jackett.Common/Indexers/Definitions/Abstract/` nas tags recentes (ja mudou de pasta antes); o script tenta as duas.

### 2.2 Alterar o jackett-proxy (`jackett_proxy.py`)

- Pasta: `D:\JellyfinDownloads\docker\jackett-proxy`. Entregar SEMPRE o arquivo completo pronto para substituir, nunca diff ou trecho (risco de quebrar a indentacao do Python). Arquivo novo baixado em `D:\Downloads`, conferir SHA256.
- Backup antes: `jackett_proxy.py.bak-v<antiga>-<data-hora>` com hash igual ao original.
- Teste sem tocar producao: `docker cp` do arquivo novo e do script de teste para `/tmp` do container `jackett-proxy`; o teste sobe uma segunda copia na porta interna 19118 e compara com o proxy de producao (itens nao relacionados e filmes devem ser IGUAIS). Para mudancas pequenas, testar a copia local com servidor falso.
- Deploy: `Copy-Item -Force` (ou Move-Item se o Heboly pedir mover) e `docker restart jackett-proxy`; conferir no log `jackett-proxy v4.xx (Patched)`. No host, `localhost:9118` NAO e o proxy (e o brtorznab); testar via `docker exec jackett-proxy ...` em `127.0.0.1:9118`. O log imprime a chave do Jackett: nao compartilhar essa saida.
- Validar no Sonarr/Radarr (busca interativa) e o formato de grupo pelo `/api/v3/parse` do Radarr. O guid de cada item recebe sufixo `#src-<indexador>`; o infohash nao muda.
- Rollback: copiar o `.bak-v<antiga>-*` mais recente por cima de `jackett_proxy.py` e `docker restart jackett-proxy`.
- Registrar: snapshot `claude/jackett-proxy-snapshot-v<ver>.py` no projeto, SHA256, o que mudou e por que, e a pasta onde ficaram os backups. Limpar `/tmp` do container (`docker exec jackett-proxy rm /tmp/...`) e mover os arquivos de `D:\Downloads` para `_arquivo-antigo`.

### 2.3 Healthcheck diario

- `D:\JellyfinDownloads\jackett-indexers-healthcheck.ps1` (tarefa agendada `ParticularFlix Jackett Healthcheck`, 09:20, com `conhost.exe --headless` + pwsh estavel). Codigo de saida 0 ok, 1 problema, 2 Docker indisponivel; log em `check-arr-logs`. Depois de qualquer troca de imagem ou de proxy, rodar uma vez e ver 3 indexers OK direto e pelo proxy, com grupo confiavel.

## Fechamento de qualquer mudanca

Conferir o estado final com comandos de leitura (container Up, hash, versao), confirmar com o Heboly que o teste visual/funcional passou, atualizar o registro no projeto, PARAR o container de teste (regra de ouro 11) e dizer em uma frase o que mudou. Sem recap de passos e sem oferecer coisas novas no meio do processo.

## Docs do projeto para consultar antes de agir

`claude/registro-release-jms-fork-3.8.2.26-22-10-2026.md` (release mais recente: deploy, medicoes e limpeza), `claude/plano-4.0-jms-fork-22-10-2026.md`, `claude/registro-release-jms-fork-3.7.1.1-21-10-2026.md` (checklist de release), `claude/registro-deploy-release-jms-fork-21-10-2026.md`, `claude/runbook-deploy-producao-jms-fork-21-10-2026.md`, `claude/jms-fork-build-e-troca-dll-teste.md`, `claude/incidente-dll-grande-bind-mount-21-10-2026.md`, `claude/registro-jackett-v423-scripts-20-10-2026.md`, `claude/registro-jackett-proxy-20-10-2026.md`.

Registros da migracao para o 12 (25/10/2026) e do 4.0.0.x tambem ficam no projeto do claude.ai; a sessao do Claude Code nao os enxerga, por isso o essencial esta nesta skill.
