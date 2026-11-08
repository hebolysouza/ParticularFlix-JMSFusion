---
name: jms-ciclo-release
description: Ciclo completo de uma versao do fork JMSFusion (ParticularFlix) executado por uma sessao do Claude Code rodando NO PC do Heboly (CLI no Windows) - teste na 8197, producao, zip, manifest, release no GitHub e deploy na VM - com backups, travas e confirmacoes. Use quando o Heboly pedir para "fechar a versao", "subir release", "promover para producao/VM" ou rodar o ciclo inteiro.
---

# Ciclo de release do JMSFusion (sessao local no PC)

Esta skill e para uma sessao do Claude Code rodando no PC do Heboly (Windows, `D:\JellyfinDownloads\...`).
Uma sessao na nuvem NAO alcanca o PC, o Docker nem a VM: nela, so prepare o codigo e entregue os blocos.

Responda ao Heboly em portugues, sem travessoes. Textos publicos (CHANGELOG, notas do release, manifest) em ingles.
Se existir a skill `particularflix-fork-release`, ela tem o mapa completo do ambiente; esta skill e o roteiro executavel.

## Regras que valem em todo o ciclo

1. Ordem fixa: codigo -> teste (8197) -> producao -> release no GitHub -> VM. Nunca publicar o que nao foi validado em producao.
2. Tres paradas obrigatorias, cada uma com um "SIM" explicito do Heboly antes de seguir:
   - antes da janela de producao (ninguem assistindo);
   - antes de publicar (push no `main` e criacao do release, que sao publicos);
   - antes do deploy na VM (o Jellyfin da VM reinicia; o script avisa quem esta assistindo).
   Fora dessas paradas, siga sozinho e relate o resultado de cada passo.
3. Validacao visual e do Heboly (voce nao ve o navegador). Antes de seguir de uma etapa para outra, mande a lista exata
   do que conferir e espere o "ok".
4. Sempre simular antes (`-Modo Simular`, modo sem `-Aplicar`), backup antes, conferir por hash depois.
5. Nunca: `docker compose up -d` sem nome de servico; `docker run <imagem> <comando>` em mount de producao sem
   `--entrypoint`; apagar arquivos pessoais de `D:\Downloads` ou o mount `K:/XXX`; deixar backup `.js`/`.css` dentro de
   uma pasta `custom` (seria injetado); alterar scripts `pf-vm-*` (a operacao da VM e do Heboly).
6. Scripts PowerShell: `pwsh -NoProfile -ExecutionPolicy Bypass -File "<script>" ...`, a partir da pasta indicada.
   `.ps1` novo baixado ou copiado: `Unblock-File -LiteralPath "<caminho>"` antes de rodar.
7. Se algo nao bater com este roteiro (container, volume, caminho, saida inesperada): PARE, mostre a saida e pergunte.

## Mapa rapido

| Item | Valor |
|---|---|
| Clone do fork | `D:\JellyfinDownloads\jms-fork\ParticularFlix-JMSFusion` |
| Scripts do fluxo 12 | `D:\JellyfinDownloads\jms-fork` (`jms-teste12.ps1`, `jms-janela12.ps1`, `jms-release12.ps1`, `jms-limpeza12.ps1`, `jms-comparar12.ps1`) |
| Teste | container `jellyfin-jms-teste-12`, `http://127.0.0.1:8197`, usuario admin `heboly` |
| Custom do teste | `D:\JellyfinDownloads\jms-fork\teste-12\config\data\plugins\configurations\JMSFusion\custom` |
| Producao | container `jellyfin`, `http://127.0.0.1:8096`, volume `jms-prod-plugin-40000` |
| Custom da producao | `D:\JellyfinDownloads\appdata\jellyfin\data\plugins\configurations\JMSFusion\custom` |
| Backups | `D:\JellyfinDownloads\jms-fork\backups-teste12` |
| Scripts da VM (do Heboly) | `D:\JellyfinDownloads\vm-teste` (`pf-vm-manutencao.ps1` reinicia com aviso) |
| Deploy na VM | `extras/jms-vm12.ps1` do repo, copiado para `D:\JellyfinDownloads\jms-fork` |
| VM publica | `https://particularflix.duckdns.org` |
| Catalogo | `https://raw.githubusercontent.com/hebolysouza/ParticularFlix-JMSFusion/main/manifest.json` |

## Etapa 0: pre-checagem (sem alterar nada)

1. `git -C <clone> status --short` vazio; anote o branch de trabalho (o Heboly diz qual; se nao disser, pergunte).
2. Versao `<ver>` igual nos 3 pontos: `JMSFusion.csproj` `<Version>`, `Resources/slider/modules/config.js` (`version: "v<ver>"`),
   `meta.json` (`version` e caminhos do icone). CHANGELOG com secao `## <ver>` no topo. `git grep -n "<versao anterior>"` so
   pode achar comentarios e o CHANGELOG.
3. `node --check` em cada `.js` alterado no ciclo (`git diff --name-only origin/main...HEAD -- '*.js'`).
4. Liste para o Heboly o que entra na versao (do CHANGELOG) e se ha mudanca em `extras/` (vai para as pastas `custom`).

## Etapa 1: teste na 8197

1. `pwsh -NoProfile -ExecutionPolicy Bypass -File ".\jms-teste12.ps1" -Branch "<branch>" -Versao "<ver>"` em `D:\JellyfinDownloads\jms-fork`.
   Esperado: build ok, hash do volume igual ao do build, "Todas as checagens passaram". Falha de build: mostre o erro do
   compilador e corrija o codigo antes de seguir.
2. Se `extras/particularflix-modern-header.js` (ou outro script de marca) mudou: backup do arquivo atual da custom do teste
   para `backups-teste12\custom-teste-antes-<ver>-<data>` (fora da custom, hash conferido), copie o do clone,
   `docker restart -t 60 jellyfin-jms-teste-12`, espere `/System/Info/Public` responder e compare o SHA256 servido em
   `http://127.0.0.1:8197/JMSFusion/custom/<nome>` (com `Accept-Encoding: identity`) com o do arquivo.
3. Mande ao Heboly a lista do que conferir (cada item do CHANGELOG, mais regressoes rapidas: botoes do slider, troca
   automatica, fileiras da Home, player, cabecalho, perfis admin e comum, celular em modo dispositivo) e espere o "ok".

## Etapa 2: producao (PARADA 1)

1. Peca o SIM: "ninguem assistindo na producao?".
2. `pwsh ... ".\jms-janela12.ps1" -Modo TrocarDll -VersaoPlugin "<ver>"` (o script pede SIM; ele faz backup do volume em
   `backups-teste12\volume-prod-<data>`, copia o volume do teste, confere hash, religa e valida). Anote a pasta do backup
   (rollback: copiar de volta para o volume e religar).
3. Script de marca alterado: mesmo procedimento da etapa 1.2, na custom da producao (backup em
   `backups-teste12\custom-prod-antes-<ver>-<data>`), sem reiniciar se o Heboly preferir (a custom e lida a cada carga), e
   hash servido em `http://127.0.0.1:8096/JMSFusion/custom/<nome>`.
4. `pwsh ... ".\jms-janela12.ps1" -Modo Validar`.
5. Heboly valida pelo Tailscale (Ctrl+F5) com a mesma lista da etapa 1. Espere o "ok".

## Etapa 3: zip, manifest e release (PARADA 2)

1. SHA256 da DLL validada (volume da producao), sem subir um segundo servidor:
   `docker run --rm --entrypoint sh -v jms-prod-plugin-40000:/p lscr.io/linuxserver/jellyfin:12.3.0-validado -c "sha256sum /p/Jellyfin.Plugin.JMSFusion.dll"`.
2. `pwsh ... ".\jms-release12.ps1" -Modo Zip -Versao "<ver>" -DllEsperada "<SHA256>"`. Anote ARQUIVO, TAMANHO, MD5 e TIMESTAMP.
3. No clone, branch de trabalho: entrada nova no TOPO de `versions` do `manifest.json` (edicao minima, sem reindentar o
   resto), no mesmo formato das anteriores: `version`, `changelog` (resumo em ingles), `targetAbi` `12.0.0.0`,
   `sourceUrl` `https://github.com/hebolysouza/ParticularFlix-JMSFusion/releases/download/v<ver>/JMSFusion-<ver>-server.zip`,
   `checksum` (MD5 minusculo), `timestamp` (do meta.json/saida do script). Valide o JSON (`python -m json.tool` ou
   `ConvertFrom-Json`). Commit `manifest: add <ver> (...)`.
4. Notas do release em ingles num `.md` (Markdown cru): cabecalhos com emoji (Install, Upgrade notes, Fixes/New/Security/
   Performance, Known limitations); ultima linha a URL do CHANGELOG em texto puro. Mostre ao Heboly.
5. Peca o SIM para publicar. Entao:
   - `git push origin <branch>`; `git checkout main && git pull --ff-only origin main && git merge --ff-only <branch> && git push origin main`
     (se o fast-forward falhar, PARE e pergunte);
   - com `gh` instalado e logado (`gh auth status`):
     `gh release create v<ver> "<ARQUIVO do zip>" --repo hebolysouza/ParticularFlix-JMSFusion --target main --title "JMSFusion <ver> (ParticularFlix fork)" --notes-file "<notas.md>" --latest`;
   - sem `gh`: entregue ao Heboly o passo a passo de `https://github.com/hebolysouza/ParticularFlix-JMSFusion/releases/new`
     (tag `v<ver>` criada na publicacao, Target `main`, titulo acima, anexar o zip, Latest) e espere ele confirmar.
   Entre o push do manifest e o release o catalogo aponta para 404: publique em seguida.
6. `pwsh ... ".\jms-release12.ps1" -Modo Verificar -Versao "<ver>"`.

## Etapa 4: VM (PARADA 3)

1. Copie `extras/jms-vm12.ps1` do clone para `D:\JellyfinDownloads\jms-fork\jms-vm12.ps1` e rode `Unblock-File`.
2. Simulacao: `pwsh ... ".\jms-vm12.ps1" -Versao "<ver>"`. Esperado: versao atual da VM, `DOWNLOAD_CONFERIDO=ok` (a VM
   baixou o zip do release e o header da tag, MD5 igual ao do manifest) e o plano.
3. Peca o SIM (diga quantos minutos de aviso; padrao 5). Entao `-Aplicar -Minutos <N>`. O script faz backup em
   `~/backups/jms-plugin-<data>` na VM, troca DLL/meta.json/icon.png e o header, reinicia pelo `pf-vm-manutencao.ps1`
   (avisa quem assiste) e valida: JMSFusion `Active` na versao nova e header servido igual ao da tag.
   Rollback: `-Reverter -Minutos <N>`.
4. Se a versao mudou chaves de layout/configuracao do JMS, avise o Heboly: reaplicar os snapshots globais da VM e
   decisao dele, com os scripts `pf-vm-*` (regra do layout: fechar abas, aplicar, abrir em anonima, limpar dados do site).
5. Heboly valida em `https://particularflix.duckdns.org` (anonima, Ctrl+F5).

## Etapa 5: fechamento

1. Atualize as listas do `jms-limpeza12.ps1` para o ciclo, rode `-Modo Simular`, mostre ao Heboly, e com o "ok" `-Modo Limpar`.
2. Ultimo passo SEMPRE: teste parado (`pwsh ... ".\jms-teste12.ps1" -Parar`), conferindo
   `docker ps -a --filter "name=jellyfin"`: `jellyfin` Up, `jellyfin-jms-teste-12` Exited (0).
3. Registro para o Heboly (para o projeto no claude.ai): versao, commit, SHA256 da DLL, MD5 e tamanho do zip, URL do
   release, pastas de backup (producao e VM) e o que muda em configuracao/snapshots. Uma frase final com o que mudou.
