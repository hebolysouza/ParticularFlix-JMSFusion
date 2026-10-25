/* ParticularFlix - cabecalho do layout Modern do Jellyfin 12.
   Arquivo ADICIONAL: nao altera o particularflix-logo.js (layout Legado).
   Para remover: apague este arquivo da pasta custom.

   O que faz: logo ParticularFlix, navegacao em pilulas
   centralizadas no padrao NetFin (item ativo em vermelho) e lista opcional de itens escondidos. */
(function () {
    "use strict";
    if (window.__pfModernHeader) return;
    window.__pfModernHeader = true;

    // Itens da navegacao que voce quer ESCONDER no layout Modern (pelo nome exibido, sem acento).
    // Exemplo: var HIDE = ["Filmes", "Colecoes"];
    // Tambem vale, sem editar o arquivo: localStorage.setItem("pf:navHide", "Filmes,Colecoes") e recarregar.
    var HIDE = [];

    var ROOT = "html.pf-modern-on header.MuiAppBar-root";
    var STACK = ROOT + " .MuiToolbar-root > .MuiStack-root";
    var HDR = "header.MuiAppBar-root .MuiToolbar-root > .MuiStack-root";
    var STYLE_ID = "pf-modern-header-style";

    var CSS = [
        ROOT + " a[href=\"#/\"]:not(.pf-logo-modern){display:none !important;}",
        STACK + " a[href=\"#/\"]:not(.pf-logo-modern):not(.pf-nav-home){display:none !important;}",
        // O cabecalho do player (.osdHeader) fica de fora: e nele que o JMSFusion poe logo do filme, estrelas e classificacao.
        "html.pf-modern-active .skinHeader:not(.osdHeader){visibility:hidden !important;opacity:0 !important;pointer-events:none !important;transition:none !important;}",
        // No player a barra de paginas nao aparece (igual ao layout Legado): fica so o cabecalho do player.
        "html.pf-route-video header.MuiAppBar-root{display:none !important;}",
        // Cabecalho do player igual ao Legado: voltar, logo ParticularFlix, logo do filme e avaliacoes, alinhados a esquerda.
        ".videoOsd-appBar > .MuiIconButton-root:first-child{order:-2;}",
        // O logo do player e um link para a Inicio, com a mesma animacao do logo da barra (estilos proprios: nao depende do CSS do Legado).
        ".videoOsd-appBar > .pf-logo-osd{order:-1;display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;margin:0 6px 0 2px;padding:4px 6px 4px 2px;line-height:1;user-select:none;text-decoration:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-badge-wrap{position:relative;display:inline-flex;width:26px;height:26px;overflow:hidden;border-radius:6px;transition:transform 220ms ease;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-badge{width:26px;height:26px;display:block;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-bar{transform-box:fill-box;transform-origin:50% 100%;transition:transform 260ms cubic-bezier(.3,1.4,.5,1);}",
        ".videoOsd-appBar > .pf-logo-osd .pf-badge-sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,0.35) 50%,transparent 70%);transform:translateX(-130%);}",
        ".videoOsd-appBar > .pf-logo-osd .pf-wm{display:inline-flex;align-items:baseline;font-size:20px;font-weight:700;letter-spacing:0.02em;white-space:nowrap;line-height:1;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-wm-p{color:#FFFFFF;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-wm-f{position:relative;color:#E50914;transition:color 200ms ease,text-shadow 200ms ease;}",
        ".videoOsd-appBar > .pf-logo-osd .pf-wm-f::after{content:\"\";position:absolute;left:0;right:0;bottom:-3px;height:2px;background:#E50914;transform:scaleX(0);transform-origin:left;transition:transform 260ms ease;}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-badge-wrap{transform:scale(1.08);}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-bar-1{transform:scaleY(1.16);}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-bar-2{transform:scaleY(1.28);transition-delay:55ms;}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-bar-3{transform:scaleY(1.5);transition-delay:110ms;}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-badge-sheen{transform:translateX(130%);transition:transform 620ms ease;}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-wm-f::after,.videoOsd-appBar > .pf-logo-osd:focus-visible .pf-wm-f::after{transform:scaleX(1);}",
        ".videoOsd-appBar > .pf-logo-osd:hover .pf-wm-f,.videoOsd-appBar > .pf-logo-osd:focus-visible .pf-wm-f{color:#FF3B47;text-shadow:0 0 7px rgba(229,9,20,0.6);}",
        ".videoOsd-appBar > .pf-logo-osd:focus-visible{outline:2px solid #FF3B47;outline-offset:4px;border-radius:4px;}",
        "@media (prefers-reduced-motion:reduce){.videoOsd-appBar > .pf-logo-osd *{transition:none !important;}}",
        // Com o logo do filme na tela, o titulo em texto do Jellyfin sai (no Legado so aparece o logo).
        ".videoOsd-appBar:has(#jms-osd-header-ratings-v4 img[src]:not([src=\"\"])) > p.MuiTypography-root{display:none !important;}",
        ROOT + " .MuiToolbar-root{position:relative;}",
        // Logo: PARTICULAR e FLIX na mesma linha de base em todos os estados e layouts (o CSS do Legado sobe o FLIX 0,7px).
        ".pf-logo .pf-wm,.pf-logo-modern .pf-wm,.pf-logo-osd .pf-wm{display:inline-flex !important;align-items:baseline !important;}",
        ".pf-logo .pf-wm-p,.pf-logo .pf-wm-f,.pf-logo-modern .pf-wm-p,.pf-logo-modern .pf-wm-f,.pf-logo-osd .pf-wm-p,.pf-logo-osd .pf-wm-f{top:0 !important;bottom:auto !important;margin-top:0 !important;margin-bottom:0 !important;vertical-align:baseline !important;line-height:1 !important;}",
        // Selo do Jellyfin Oscars nos detalhes: so o trofeu e o texto, sem contorno nem fundo.
        ".jellyfinOscarsDetailBadge,.jellyfinOscarsDetailBadge.mediaInfoText,.oscarsBadge.mediaInfoText{border:0 !important;outline:0 !important;box-shadow:none !important;background:transparent !important;background-image:none !important;padding:0 !important;border-radius:0 !important;}",
        // Os botoes de icone nascem com 52 px e so caem para 48 px quando o resto do CSS entra; isso mudava a
        // altura da barra e o slider (que se posiciona abaixo dela) pulava na primeira carga.
        ROOT + " .MuiToolbar-root .MuiIconButton-root{max-height:48px;box-sizing:border-box;}",
        "html.pf-modern-on:not(.pf-nav-flow) " + HDR + "{position:absolute !important;left:50%;top:50%;transform:translate(-50%,-50%);width:max-content;display:flex !important;align-items:center;gap:8px;}",
        "html.pf-modern-on.pf-nav-flow " + HDR + "{position:static !important;transform:none;margin-left:12px;display:flex !important;align-items:center;gap:6px;}",
        STACK + " a:not(.pf-logo-modern){display:inline-flex !important;align-items:center;gap:6px;border-radius:999px !important;padding:6px 16px !important;min-width:0;background:rgba(255,255,255,0.06);color:#F2F2F2 !important;text-transform:none !important;text-decoration:none;font-size:14px;line-height:1.2;transition:background-color 200ms ease,box-shadow 200ms ease,color 200ms ease;}",
        "html.pf-modern-on.pf-nav-flow " + HDR + " a:not(.pf-logo-modern){padding:6px 12px !important;font-size:13px;}",
        // Modo compacto: sem icones nas pilulas e sem quebra de linha, para o perfil/icones da direita nao cairem para a linha de baixo.
        "html.pf-modern-on.pf-nav-flow " + HDR + " a:not(.pf-logo-modern):not(.pf-nav-iconic) svg{display:none !important;}",
        // Modo reduzido (passo 1): pilulas menores, com icone e texto, ainda centralizadas.
        "html.pf-modern-on.pf-nav-compact " + HDR + "{gap:4px;}",
        "html.pf-modern-on.pf-nav-compact " + HDR + " a:not(.pf-logo-modern){padding:6px 10px !important;font-size:13px;gap:5px;}",
        "html.pf-modern-on.pf-nav-compact " + HDR + " a:not(.pf-logo-modern) svg{width:16px;height:16px;}",
        // Modo so icones (ultimo recurso): o texto some e fica como dica ao passar o mouse.
        "html.pf-modern-on.pf-nav-icons " + HDR + " a:not(.pf-logo-modern){font-size:0 !important;gap:0 !important;padding:8px 10px !important;}",
        "html.pf-modern-on.pf-nav-icons " + HDR + " a:not(.pf-logo-modern) svg{display:inline-block !important;width:20px;height:20px;}",
        "html.pf-modern-on.pf-nav-flow header.MuiAppBar-root .MuiToolbar-root{flex-wrap:nowrap !important;}",
        "html.pf-modern-on.pf-nav-flow header.MuiAppBar-root .MuiToolbar-root > :not(.MuiStack-root):not(.pf-logo-modern){flex-shrink:0;}",
        STACK + " a:not(.pf-logo-modern) svg{width:18px;height:18px;fill:currentColor;}",
        STACK + " a:not(.pf-logo-modern):hover{background:rgba(229,9,20,0.38);}",
        STACK + " a.pf-nav-active{background:#E50914 !important;color:#FFFFFF !important;box-shadow:0 4px 14px rgba(229,9,20,0.35);}",
        STACK + " a.pf-nav-hidden{display:none !important;}",
        // Abas nativas (com icone): so o icone, redondo, com o nome na dica. As abas personalizadas continuam com texto.
        STACK + " a.pf-nav-iconic{font-size:0 !important;gap:0 !important;padding:8px !important;min-width:36px;justify-content:center;}",
        STACK + " a.pf-nav-iconic .MuiButton-startIcon{margin:0 !important;}",
        STACK + " a.pf-nav-iconic svg,"+ STACK + " a.pf-nav-iconic img{display:inline-block !important;width:20px;height:20px;}",
        // Seta do chip do usuario: no layout Legado ela sobe 2px de proposito; no Modern fica centralizada com o nome.
        "html.pf-modern-on header.MuiAppBar-root .jf-profile-header-caret{top:0 !important;display:inline-flex;align-items:center;align-self:center;line-height:1;transform:translateY(1px);}",
        ".pf-logo-modern{display:inline-flex !important;align-items:center;gap:10px;flex:0 0 auto;margin-left:4px;padding:4px 14px 4px 4px;line-height:1;text-decoration:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
        ".pf-logo-modern:hover .pf-badge-wrap{transform:scale(1.08);}",
        ".pf-logo-modern:hover .pf-bar-1{transform:scaleY(1.16);}",
        ".pf-logo-modern:hover .pf-bar-2{transform:scaleY(1.28);transition-delay:55ms;}",
        ".pf-logo-modern:hover .pf-bar-3{transform:scaleY(1.5);transition-delay:110ms;}",
        ".pf-logo-modern:hover .pf-badge-sheen{transform:translateX(130%);transition:transform 620ms ease;}",
        ".pf-logo-modern:hover .pf-wm-f::after,.pf-logo-modern:focus-visible .pf-wm-f::after{transform:scaleX(1);}",
        ".pf-logo-modern:hover .pf-wm-f,.pf-logo-modern:focus-visible .pf-wm-f{color:#FF3B47;text-shadow:0 0 7px rgba(229,9,20,0.6);}",
        ".pf-logo-modern:focus-visible{outline:2px solid #FF3B47;outline-offset:4px;border-radius:4px;}",
        // Ordem na barra: hamburguer, botao voltar e logo (so troca a ordem visual; o React continua dono dos botoes).
        "html.pf-modern-on header.MuiAppBar-root .MuiToolbar-root{display:flex;}",
        "html.pf-modern-on header.MuiAppBar-root .MuiToolbar-root > .MuiIconButton-root:has(> svg[data-testid=\"MenuIcon\"]){order:-3;}",
        "html.pf-modern-on header.MuiAppBar-root .MuiToolbar-root > .MuiIconButton-root:has(> svg[data-testid=\"ArrowBackIcon\"]){order:-2;}",
        "html.pf-modern-on header.MuiAppBar-root .MuiToolbar-root > .pf-logo-modern{order:-1;}",
        // Sino de notificacoes do JMSFusion: mesmo tamanho e alinhamento dos outros icones da barra, hover vermelho.
        "html.pf-modern-on header.MuiAppBar-root #jfNotifBtn{display:inline-flex !important;align-items:center;justify-content:center;align-self:center;position:relative;box-sizing:border-box;width:40px;height:40px;min-width:40px;margin:0 !important;padding:0 !important;top:0 !important;vertical-align:middle;border:0;border-radius:50% !important;background:transparent;color:inherit;line-height:1;cursor:pointer;transition:background-color 200ms ease,color 200ms ease,box-shadow 200ms ease;}",
        "html.pf-modern-on header.MuiAppBar-root #jfNotifBtn .jf-notif-icon,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn svg,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn i{display:block;margin:0 !important;font-size:20px;width:auto;height:auto;line-height:1;}",
        "html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:focus,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:focus-visible,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:active{background:transparent !important;box-shadow:none !important;outline:none;color:#FFFFFF;}",
        "@keyframes pfBellRing{0%{transform:rotate(0)}15%{transform:rotate(16deg)}30%{transform:rotate(-14deg)}45%{transform:rotate(10deg)}60%{transform:rotate(-8deg)}75%{transform:rotate(4deg)}100%{transform:rotate(0)}}",
        "html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover .jf-notif-icon,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover svg,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover i,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:focus-visible .jf-notif-icon,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:focus-visible svg,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:focus-visible i{transform-origin:50% 12%;animation:pfBellRing 650ms ease-in-out 1;}",
        "@media (prefers-reduced-motion:reduce){html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover svg,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover i,html.pf-modern-on header.MuiAppBar-root #jfNotifBtn:hover .jf-notif-icon{animation:none;}}",
        // Layout Legado: o mesmo sino do Modern (hover sem fundo e balanco ao passar o mouse).
        "html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:focus,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:focus-visible,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:active{background:transparent !important;box-shadow:none !important;outline:none;color:#FFFFFF;}",
        "html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover .jf-notif-icon,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover svg,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover i,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:focus-visible .jf-notif-icon,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:focus-visible svg,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:focus-visible i{transform-origin:50% 12%;animation:pfBellRing 650ms ease-in-out 1;}",
        "@media (prefers-reduced-motion:reduce){html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover svg,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover i,html:not(.pf-modern-on) .skinHeader #jfNotifBtn:hover .jf-notif-icon{animation:none;}}",
        "html.pf-modern-on header.MuiAppBar-root #jfNotifBtn .jf-notif-badge{top:3px !important;right:2px !important;}",
        // Secao Administracao na gaveta do hamburguer (o Jellyfin 12 so tem o Painel no menu do avatar).
        ".pf-admin-sec{border-top:1px solid rgba(255,255,255,0.12);margin-top:8px;padding-top:8px;}",
        ".pf-admin-sec .pf-admin-title{padding:8px 16px;font-size:14px;line-height:1.4;color:rgba(255,255,255,0.7);}",
        ".pf-admin-sec a.pf-admin-link{display:flex;align-items:center;gap:0;padding:8px 16px;color:inherit;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
        ".pf-admin-sec a.pf-admin-link:hover{background:rgba(255,255,255,0.08);}",
        ".pf-admin-sec a.pf-admin-link svg{width:24px;height:24px;fill:currentColor;flex:0 0 auto;margin-right:32px;}",
        ".pf-admin-sec a.pf-admin-link span{font-size:16px;line-height:1.5;}",
    ].join("\n");

    var BADGE =
        '<span class="pf-badge-wrap">' +
        '<svg class="pf-badge" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="#0B0B0B" stroke="#E50914" stroke-width="3"/>' +
        '<rect class="pf-bar pf-bar-1" x="17" y="17" width="8" height="30" rx="2" fill="#E50914"/>' +
        '<rect class="pf-bar pf-bar-2" x="28" y="21" width="8" height="22" rx="2" fill="#FF3B47"/>' +
        '<rect class="pf-bar pf-bar-3" x="39" y="26" width="8" height="12" rx="2" fill="#9E0812"/>' +
        '</svg><span class="pf-badge-sheen" aria-hidden="true"></span></span>';
    var WORDMARK =
        '<span class="pf-wm"><span class="pf-wm-p">PARTICULAR</span><span class="pf-wm-f">FLIX</span></span>';
    var HOME_ICON = '<svg class="pf-home-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';

    function norm(t) {
        return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    }

    function hideList() {
        var l = HIDE.slice();
        try {
            var v = window.localStorage.getItem("pf:navHide");
            if (v) l = l.concat(v.split(","));
        } catch (e) {}
        return l.map(norm).filter(Boolean);
    }

    function homeLabel() {
        var l = ((document.documentElement.lang || navigator.language || "") + "").toLowerCase();
        if (l.indexOf("pt") === 0) return "Início";
        if (l.indexOf("es") === 0) return "Inicio";
        return "Home";
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement("style");
        s.id = STYLE_ID;
        s.textContent = CSS + DR_CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    // Na Inicio do Jellyfin 12 o endereco #/home sem ?tab= NAO troca a aba sozinho (so a primeira vez).
    // Por isso, depois de navegar para a Inicio, pedimos ao proprio seletor de abas do Jellyfin a aba 0.
    function selecionarAbaInicio() {
        var raw = (window.location.hash || "#/").replace(/^#/, "").split("?");
        var cur = raw[0];
        if (!(cur === "/home" || cur === "/home.html" || cur === "/" || cur === "")) return;
        var qs0 = new URLSearchParams(raw[1] || "");
        var tab = qs0.get("tab");
        if ((tab !== null && tab !== "0") || qs0.get("seerrfinTab")) return;
        var tabs = document.querySelector('.headerTabs [is="emby-tabs"]') || document.querySelector('[is="emby-tabs"]') || document.querySelector(".headerTabs .emby-tabs");
        if (!tabs) return;
        try {
            var atual = typeof tabs.selectedIndex === "function" ? tabs.selectedIndex() : null;
            if (atual === 0) return;
            if (typeof tabs.selectedIndex === "function") { tabs.selectedIndex(0); return; }
            var b = tabs.querySelector('.emby-tab-button[data-index="0"]');
            if (b) b.click();
        } catch (e) {}
    }

    function agendarAbaInicio() {
        [0, 120, 350, 800].forEach(function (ms) { setTimeout(selecionarAbaInicio, ms); });
    }

    function onHomePillClick() {
        agendarAbaInicio();
    }

    function onLogoClick(ev) {
        var raw = (window.location.hash || "#/").replace(/^#/, "").split("?");
        var cur = raw[0];
        var qs1 = new URLSearchParams(raw[1] || "");
        var tab = qs1.get("tab");
        var naPrimeiraAba = (tab === null || tab === "0") && !qs1.get("seerrfinTab");
        var tabs = document.querySelector('.headerTabs [is="emby-tabs"]') || document.querySelector('[is="emby-tabs"]');
        var abaAtual = null;
        try { if (tabs && typeof tabs.selectedIndex === "function") abaAtual = tabs.selectedIndex(); } catch (e) {}
        var naInicio = (cur === "/home" || cur === "/home.html" || cur === "/" || cur === "");
        // Ja esta na Inicio (primeira aba): so sobe a pagina.
        if (naInicio && naPrimeiraAba && (abaAtual === null || abaAtual === 0)) {
            ev.preventDefault();
            try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
            return;
        }
        ev.preventDefault();
        if (naInicio) {
            // Mesma rota (outra aba): so o seletor de abas resolve.
            if (!naPrimeiraAba) { try { window.location.hash = "#/home"; } catch (e) {} }
            agendarAbaInicio();
            return;
        }
        var home = document.querySelector("a.pf-nav-home");
        if (home) home.click(); else window.location.hash = "#/home";
        agendarAbaInicio();
    }

    var homeEl = null;

    // Alguns plugins criam as suas abas (Catalogo, Solicitacoes, Calendario...) copiando a primeira pilula da barra.
    // Se a copia vier da nossa pilula Inicio, ela herda o icone, o texto "Inicio" e a classe que a deixa vermelha.
    // Aqui a copia volta a ser uma aba comum: sai a nossa marca, o nosso icone e o nosso texto (se ainda for "Inicio").
    function limparCloneHome(a) {
        a.classList.remove("pf-nav-home", "pf-nav-active");
        a.removeAttribute("data-pf-home");
        var ico = a.querySelectorAll(".pf-home-ico");
        for (var i = 0; i < ico.length; i++) ico[i].remove();
        var lbl = a.querySelectorAll(".pf-home-lbl");
        for (var j = 0; j < lbl.length; j++) {
            if (norm(lbl[j].textContent) === norm(homeLabel()) && norm(a.textContent) !== norm(homeLabel())) lbl[j].remove();
            else lbl[j].classList.remove("pf-home-lbl");
        }
        if (a.getAttribute("title") && norm(a.getAttribute("title")) === norm(homeLabel()) && norm(a.textContent) !== norm(homeLabel())) a.removeAttribute("title");
    }

    // Aba nativa do Jellyfin (Favoritos, Filmes, Series, Colecoes...) ou de plugin que traz icone proprio:
    // tem o icone inicial do botao MUI. As abas das paginas personalizadas chegam so com texto.
    function temIcone(a) {
        var ic = a.querySelector(".MuiButton-startIcon");
        return !!(ic && ic.querySelector("svg,img,i,.material-icons,[class*=\"fa-\"]"));
    }

    function syncLinks(stack) {
        var cur = (window.location.hash || "#/").replace(/^#/, "");
        var parts = cur.split("?");
        var curPath = parts[0] || "/";
        var curTab = new URLSearchParams(parts[1] || "").get("tab");
        var hide = hideList();
        var links = stack.querySelectorAll("a:not(.pf-logo-modern)");
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            if (a !== homeEl && (a.classList.contains("pf-nav-home") || a.hasAttribute("data-pf-home"))) limparCloneHome(a);
            var iconic = a !== homeEl && temIcone(a);
            if (iconic !== a.classList.contains("pf-nav-iconic")) a.classList.toggle("pf-nav-iconic", iconic);
            if (iconic && !a.getAttribute("aria-label")) {
                var nmI = (a.getAttribute("title") || a.textContent || "").trim();
                if (nmI) a.setAttribute("aria-label", nmI);
            }
            var hid = hide.indexOf(norm(a.textContent)) >= 0;
            if (hid !== a.classList.contains("pf-nav-hidden")) a.classList.toggle("pf-nav-hidden", hid);
            var active = false;
            if (a.classList.contains("pf-nav-home")) {
                active = (curPath === "/home" || curPath === "/home.html" || curPath === "/" || curPath === "") && (curTab === null || curTab === "0") && !new URLSearchParams(parts[1] || "").get("seerrfinTab");
            } else {
                var href = (a.getAttribute("href") || "").replace(/^#/, "");
                if (href === "/" || href === "") continue;
                var hp = href.split("?");
                if (hp[0] === "/home") {
                    var wantH = new URLSearchParams(hp[1] || "");
                    var haveH = new URLSearchParams(parts[1] || "");
                    active = curPath === "/home" && Array.from(wantH.keys()).length > 0;
                    if (active) wantH.forEach(function (v, k) { if (haveH.get(k) !== v) active = false; });
                } else {
                    active = curPath === hp[0];
                    // Paginas de plugin usam o mesmo caminho (ex.: /configurationpage?name=X): so e ativa se os parametros do link tambem batem.
                    if (active && hp[1]) {
                        var want2 = new URLSearchParams(hp[1]);
                        var have2 = new URLSearchParams(parts[1] || "");
                        want2.forEach(function (v, k) { if (have2.get(k) !== v) active = false; });
                    }
                }
            }
            if (active !== a.classList.contains("pf-nav-active")) a.classList.toggle("pf-nav-active", active);
        }
    }

    function fitNav(toolbar, stack, logo) {
        var root = document.documentElement;
        var CLS = ["pf-nav-compact", "pf-nav-flow", "pf-nav-icons"];
        CLS.forEach(function (c) { root.classList.remove(c); });
        var t = toolbar.getBoundingClientRect();
        if (!t.width) return;
        var center = t.left + t.width / 2;
        // Dica (tooltip) com o nome de cada pilula, usada quando so os icones cabem.
        var links = stack.querySelectorAll("a:not(.pf-logo-modern)");
        for (var q = 0; q < links.length; q++) {
            if (!links[q].getAttribute("title")) {
                var nm = (links[q].textContent || "").trim();
                if (nm) links[q].setAttribute("title", nm);
            }
        }
        // Borda esquerda do primeiro controle real que fica na METADE DIREITA da barra (ignora espacadores e itens ocultos).
        var rightLeft = t.right;
        var kids = toolbar.children;
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k === stack || k === logo) continue;
            var items = k.matches("button,a") ? [k] : k.querySelectorAll("button,a");
            for (var j = 0; j < items.length; j++) {
                var r = items[j].getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.left > center && r.left < rightLeft) rightLeft = r.left;
            }
        }
        var logoRight = logo.getBoundingClientRect().right;
        function sobrepoe() {
            var sr = stack.getBoundingClientRect();
            if (!sr.width) return false;
            return sr.left < logoRight + 12 || sr.right > rightLeft - 12;
        }
        // Escada: normal centralizado, depois pilulas menores, depois logo apos o logo, por fim so icones.
        var passos = [[], ["pf-nav-compact"], ["pf-nav-compact", "pf-nav-flow"], ["pf-nav-compact", "pf-nav-flow", "pf-nav-icons"]];
        var usado = 0;
        for (var n = 0; n < passos.length; n++) {
            CLS.forEach(function (c) { root.classList.remove(c); });
            passos[n].forEach(function (c) { root.classList.add(c); });
            usado = n;
            if (!sobrepoe()) break;
        }
        var sr2 = stack.getBoundingClientRect();
        var bell = document.getElementById("jfNotifBtn");
        var br = bell ? bell.getBoundingClientRect() : null;
        var rr = null;
        var btns = toolbar.querySelectorAll(".MuiIconButton-root");
        for (var z = 0; z < btns.length; z++) { if (btns[z] !== bell && btns[z].getBoundingClientRect().width) { rr = btns[z].getBoundingClientRect(); break; } }
        window.__pfBellDebug = br ? { bell: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)], vizinho: rr ? [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] : null } : null;
        window.__pfNavDebug = { toolbarW: Math.round(t.width), center: Math.round(center), stackW: Math.round(sr2.width), left: Math.round(sr2.left), right: Math.round(sr2.right), logoRight: Math.round(logoRight), rightLeft: Math.round(rightLeft), passo: usado, classes: passos[usado].join(" ") };
    }

    function syncModernFlag(header) {
        var r = header.getBoundingClientRect();
        var cs = window.getComputedStyle(header);
        var vis = r.width > 0 && r.height > 0 && r.top > -2 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
        var root = document.documentElement;
        if (vis !== root.classList.contains("pf-modern-active")) root.classList.toggle("pf-modern-active", vis);
    }

    function placeLogoOnly(header) {
        // Modo gaveta (janela estreita): o Jellyfin nao desenha as pilulas, so o hamburguer. O logo entra na barra
        // e a ordem visual (hamburguer, logo) vem do CSS.
        var toolbar = header.querySelector(".MuiToolbar-root");
        if (!toolbar) return;
        ensureStyle();
        var root = document.documentElement;
        if (!root.classList.contains("pf-modern-on")) root.classList.add("pf-modern-on");
        var logo = toolbar.querySelector(":scope > .pf-logo-modern");
        if (!logo) {
            logo = document.createElement("a");
            logo.className = "pf-logo-modern";
            logo.href = "#/home";
            logo.setAttribute("aria-label", "ParticularFlix");
            logo.innerHTML = BADGE + WORDMARK;
            logo.addEventListener("click", onLogoClick);
            toolbar.insertBefore(logo, toolbar.firstChild);
        }
        drRemove();
        syncModernFlag(header);
    }

    var ADMIN_TXT = {
        pt: { sec: "Administração", dash: "Painel", meta: "Metadados" },
        es: { sec: "Administración", dash: "Panel de control", meta: "Metadatos" },
        en: { sec: "Administration", dash: "Dashboard", meta: "Metadata" }
    };
    var ICON_DASH = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>';
    var ICON_META = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    var adminState = null; // null = ainda nao sei, true/false = resposta do servidor
    var adminAsked = false;

    function askAdmin() {
        if (adminAsked) return;
        adminAsked = true;
        try {
            var api = window.ApiClient;
            if (!api || typeof api.getCurrentUser !== "function") { adminAsked = false; return; }
            api.getCurrentUser().then(function (u) {
                adminState = !!(u && u.Policy && u.Policy.IsAdministrator);
                safePlace();
            }, function () { adminAsked = false; });
        } catch (e) { adminAsked = false; }
    }

    function ensureAdminLinks() {
        var home = document.querySelector('.MuiDrawer-paper a[href="#/home"]');
        if (!home) return;
        var list = home.closest(".MuiList-root");
        var holder = list && list.parentElement;
        if (!holder) return;
        var existing = holder.querySelector(":scope > .pf-admin-sec");
        if (adminState === null) { askAdmin(); return; }
        if (!adminState) { if (existing) existing.remove(); return; }
        if (existing) return;
        var lang = ((document.documentElement.lang || navigator.language || "") + "").toLowerCase().slice(0, 2);
        var t = ADMIN_TXT[lang] || ADMIN_TXT.en;
        var sec = document.createElement("div");
        sec.className = "pf-admin-sec";
        sec.innerHTML =
            '<div class="pf-admin-title">' + t.sec + '</div>' +
            '<a class="pf-admin-link" href="#/dashboard">' + ICON_DASH + '<span>' + t.dash + '</span></a>' +
            '<a class="pf-admin-link" href="#/metadata">' + ICON_META + '<span>' + t.meta + '</span></a>';
        holder.appendChild(sec);
    }


    // ------------------------------------------------------------------------------------------------
    // Hamburguer + menu lateral na janela LARGA (o Jellyfin 12 so desenha a gaveta em janela estreita).
    // O menu usa a classe "mainDrawer-scrollContainer" e a secao "libraryMenuOptions" do menu antigo: e onde o
    // Jellyfin Enhanced procura para colocar sozinho Enhanced Panel, Bookmarks e Conteudo oculto.
    // Em janela estreita o Jellyfin ja tem a gaveta nativa: nesse caso o nosso botao e o nosso menu somem.
    // ------------------------------------------------------------------------------------------------
    var DR_TXT = {
        pt: { menu: "Menu", home: "Início", fav: "Favoritos", media: "Mídia", adm: "Administração", dash: "Painel", meta: "Gerenciador de Metadados", usr: "Usuário", cfg: "Configurações", out: "Sair", close: "Fechar" },
        es: { menu: "Menú", home: "Inicio", fav: "Favoritos", media: "Medios", adm: "Administración", dash: "Panel de control", meta: "Gestor de metadatos", usr: "Usuario", cfg: "Configuración", out: "Cerrar sesión", close: "Cerrar" },
        en: { menu: "Menu", home: "Home", fav: "Favorites", media: "Media", adm: "Administration", dash: "Dashboard", meta: "Metadata Manager", usr: "User", cfg: "Settings", out: "Sign out", close: "Close" }
    };
    var DR_CSS = [
        ".pf-dr-btn{order:-3;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;margin:0 2px 0 6px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;flex:0 0 auto;transition:background-color 160ms ease;}",
        ".pf-dr-btn svg{width:24px;height:24px;fill:currentColor;display:block;}",
        ".pf-dr-btn:hover,.pf-dr-btn:focus-visible{background:rgba(255,255,255,0.12);outline:none;}",
        ".pf-dr{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1400;visibility:hidden;pointer-events:none;transition:visibility 0s linear 260ms;}",
        ".pf-dr.pf-dr-open{visibility:visible;pointer-events:auto;transition-delay:0s;}",
        ".pf-dr-back{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);opacity:0;transition:opacity 240ms ease;}",
        ".pf-dr-open .pf-dr-back{opacity:1;}",
        ".pf-dr-panel{position:absolute;top:0;left:0;bottom:0;width:min(320px,86vw);display:flex;flex-direction:column;background:linear-gradient(180deg,#15151b 0%,#0a0a0e 100%);border-right:1px solid rgba(255,255,255,0.08);box-shadow:8px 0 32px rgba(0,0,0,0.6);color:#fff;transform:translateX(-104%);transition:transform 250ms cubic-bezier(.2,.8,.2,1);}",
        ".pf-dr-open .pf-dr-panel{transform:none;}",
        ".pf-dr-head{display:flex;align-items:center;justify-content:space-between;padding:12px 10px 10px 14px;border-bottom:1px solid rgba(229,9,20,0.45);flex:0 0 auto;}",
        ".pf-dr-brand{display:inline-flex;align-items:center;gap:10px;line-height:1;}",
        ".pf-dr-close{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;}",
        ".pf-dr-close:hover,.pf-dr-close:focus-visible{background:rgba(255,255,255,0.12);outline:none;}",
        ".pf-dr-close svg{width:22px;height:22px;fill:currentColor;}",
        ".pf-dr-scroll{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:8px 8px 28px;position:relative;}",
        ".pf-dr .sidebarHeader,.pf-dr .pf-dr-title{display:block;margin:18px 12px 6px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.55);}",
        ".pf-dr .jellyfinEnhancedSection,.pf-dr .libraryMenuOptions,.pf-dr .pf-dr-sec{display:block;}",
        ".pf-dr a.navMenuOption{display:flex;align-items:center;gap:14px;padding:10px 14px;margin:2px 0;border-radius:10px;color:#fff;text-decoration:none;font-size:15px;line-height:1.2;cursor:pointer;transition:background-color 140ms ease;}",
        ".pf-dr a.navMenuOption:hover,.pf-dr a.navMenuOption:focus-visible{background:rgba(229,9,20,0.28);outline:none;}",
        ".pf-dr a.navMenuOption.pf-dr-active{background:#E50914;box-shadow:0 4px 14px rgba(229,9,20,0.35);}",
        ".pf-dr .navMenuOptionIcon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:24px;height:24px;font-size:22px;color:inherit;}",
        ".pf-dr .navMenuOptionText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".pf-dr .pluginMenuOptions{display:block;margin:0;padding:0;}",
        ".pf-dr .pluginMenuOptions a,.pf-dr .pluginMenuOptions .emby-button{display:flex !important;align-items:center;justify-content:flex-start !important;gap:14px;width:auto;box-sizing:border-box;padding:10px 14px !important;margin:2px 0 !important;border-radius:10px;color:#fff;text-align:left;text-transform:none;font-size:15px;line-height:1.2;text-decoration:none;}",
        ".pf-dr .pluginMenuOptions a:hover,.pf-dr .pluginMenuOptions a:focus-visible{background:rgba(229,9,20,0.28);outline:none;}",
        ".pf-dr .pluginMenuOptions .navMenuOptionIcon,.pf-dr .pluginMenuOptions .material-icons{display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;margin:0 !important;font-size:22px;}",
        ".pf-dr .pluginMenuOptions .navMenuOptionText{flex:1 1 auto;margin:0 !important;text-align:left;}",
        "html.pf-modern-on .mainAnimatedPage[id^=\"je-\"]:not(.hide),html.pf-modern-on #je-recommendations-category-page:not(.hide){position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;height:auto !important;opacity:1 !important;overflow-y:auto !important;z-index:1095 !important;isolation:isolate !important;background:#0a0a0e !important;contain:none !important;padding-top:70px !important;}",
        "@media (prefers-reduced-motion:reduce){.pf-dr-panel,.pf-dr-back{transition:none;}}"
    ].join("\n");

    var drEl = null;

    function drT() {
        var l = ((document.documentElement.lang || navigator.language || "") + "").toLowerCase().slice(0, 2);
        return DR_TXT[l] || DR_TXT.en;
    }

    function drLink(href, icon, label, cls) {
        var a = document.createElement("a");
        a.className = "navMenuOption lnkMediaFolder pf-dr-link" + (cls ? " " + cls : "");
        a.href = href;
        var i = document.createElement("span");
        i.className = "material-icons navMenuOptionIcon";
        i.setAttribute("aria-hidden", "true");
        i.textContent = icon;
        var t = document.createElement("span");
        t.className = "navMenuOptionText";
        t.textContent = label;
        a.appendChild(i);
        a.appendChild(t);
        return a;
    }

    function drSection(cls, title) {
        var d = document.createElement("div");
        d.className = cls;
        if (title) {
            var h = document.createElement("h3");
            h.className = "sidebarHeader";
            h.textContent = title;
            d.appendChild(h);
        }
        return d;
    }

    // (Re)monta so as partes que NAO sao do Enhanced: principal, midia, administracao e usuario.
    function drFill() {
        if (!drEl) return;
        var T = drT();
        var scroll = drEl.querySelector(".pf-dr-scroll");

        var main = scroll.querySelector(".pf-dr-main");
        if (!main) {
            main = drSection("pf-dr-sec pf-dr-main");
            main.appendChild(drLink("#/home", "home", T.home, "pf-dr-home"));
            main.appendChild(drLink("#/home?tab=1", "favorite", T.fav));
            scroll.insertBefore(main, scroll.firstChild);
        }

        var media = scroll.querySelector(".libraryMenuOptions");
        if (!media) {
            media = drSection("libraryMenuOptions pf-dr-sec", T.media);
            scroll.appendChild(media);
        }
        [].forEach.call(media.querySelectorAll("a.pf-dr-lib"), function (x) { x.remove(); });
        var stack = document.querySelector("header.MuiAppBar-root .MuiToolbar-root > .MuiStack-root");
        var re = /^#\/(tv|movies|boxsets|music|livetv|books|homevideos|musicvideos|playlists|list)(\?|$)/;
        var seen = {};
        if (stack) {
            [].forEach.call(stack.querySelectorAll("a:not(.pf-logo-modern)"), function (a) {
                var h = a.getAttribute("href") || "";
                if (!re.test(h) && h.indexOf("topParentId=") < 0) return;
                var name = ((a.getAttribute("title") || a.textContent) + "").trim();
                if (!name || seen[h]) return;
                seen[h] = 1;
                var icon = /^#\/tv/.test(h) ? "tv" : /^#\/movies/.test(h) ? "movie" : /^#\/boxsets/.test(h) ? "collections_bookmark" : /^#\/music/.test(h) ? "library_music" : /^#\/livetv/.test(h) ? "live_tv" : "folder";
                media.appendChild(drLink(h, icon, name, "pf-dr-lib"));
            });
        }

        var adm = scroll.querySelector(".pf-dr-admin");
        if (adminState === null) askAdmin();
        if (adminState && !adm) {
            adm = drSection("pf-dr-sec pf-dr-admin", T.adm);
            adm.appendChild(drLink("#/dashboard", "dashboard", T.dash));
            adm.appendChild(drLink("#/metadata", "edit", T.meta));
            var usrRef = scroll.querySelector(".pf-dr-user");
            if (usrRef) scroll.insertBefore(adm, usrRef); else scroll.appendChild(adm);
        } else if (!adminState && adm) { adm.remove(); }

        // Secao Usuario: criada UMA vez e com a classe "userMenuOptions", que o plugin Plugin Pages procura para
        // colocar "Modular Home" logo depois de Configuracoes. Nao recriar, senao o item dele some.
        var usr = scroll.querySelector(".pf-dr-user");
        if (!usr) {
            usr = drSection("pf-dr-sec pf-dr-user userMenuOptions", T.usr);
            usr.appendChild(drLink("#/mypreferencesmenu", "settings", T.cfg));
            var out = drLink("#", "exit_to_app", T.out, "pf-dr-out");
            out.addEventListener("click", function (ev) {
                ev.preventDefault();
                try { if (window.Dashboard && typeof window.Dashboard.logout === "function") { window.Dashboard.logout(); return; } } catch (e) {}
                try { window.ApiClient.logout().then(function () { window.location.hash = "#/login"; }); } catch (e2) {}
            });
            usr.appendChild(out);
            scroll.appendChild(usr);
        }
        drSync();
    }

    function drSync() {
        if (!drEl) return;
        var cur = (window.location.hash || "#/").replace(/^#/, "");
        var cp = cur.split("?");
        var have = new URLSearchParams(cp[1] || "");
        [].forEach.call(drEl.querySelectorAll("a.navMenuOption"), function (a) {
            var h = (a.getAttribute("href") || "").replace(/^#/, "");
            var on = false;
            if (h && h !== "/" && h !== "") {
                var hp = h.split("?");
                if (a.classList.contains("pf-dr-home")) {
                    var tb = have.get("tab");
                    on = (cp[0] === "/home" || cp[0] === "/home.html") && (tb === null || tb === "0") && !have.get("seerrfinTab");
                } else if (hp[0] === cp[0]) {
                    on = true;
                    new URLSearchParams(hp[1] || "").forEach(function (v, k) { if (have.get(k) !== v) on = false; });
                }
            }
            if (on !== a.classList.contains("pf-dr-active")) a.classList.toggle("pf-dr-active", on);
        });
    }

    function drOpen() {
        if (!drEl) return;
        drFill();
        drEl.classList.add("pf-dr-open");
        drEl.setAttribute("aria-hidden", "false");
        var b = document.querySelector(".pf-dr-btn");
        if (b) b.setAttribute("aria-expanded", "true");
        var first = drEl.querySelector("a.navMenuOption");
        if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
    }

    function drClose() {
        if (!drEl) return;
        drEl.classList.remove("pf-dr-open");
        try { if (drEl.contains(document.activeElement)) document.activeElement.blur(); } catch (e) {}
        drEl.setAttribute("aria-hidden", "true");
        var b = document.querySelector(".pf-dr-btn");
        if (b) b.setAttribute("aria-expanded", "false");
    }

    function drWanted() {
        try {
            if (!window.ApiClient || typeof window.ApiClient.getCurrentUserId !== "function" || !window.ApiClient.getCurrentUserId()) return false;
        } catch (e) { return false; }
        if (document.body.classList.contains("dashboardDocument")) return false;
        var nat = document.querySelectorAll(".MuiDrawer-paper");
        for (var i = 0; i < nat.length; i++) { if (!nat[i].closest("#pf-dr")) return false; }
        return true;
    }

    function drRemove() {
        var b = document.querySelector(".pf-dr-btn");
        if (b) b.remove();
        if (drEl) { drEl.remove(); drEl = null; }
    }

    function drEnsure(toolbar) {
        var T = drT();
        var b = toolbar.querySelector(":scope > .pf-dr-btn");
        if (!b) {
            b = document.createElement("button");
            b.type = "button";
            b.className = "pf-dr-btn";
            b.setAttribute("aria-label", T.menu);
            b.setAttribute("aria-haspopup", "dialog");
            b.setAttribute("aria-expanded", "false");
            b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>';
            b.addEventListener("click", function () { if (drEl && drEl.classList.contains("pf-dr-open")) drClose(); else drOpen(); });
        }
        if (toolbar.firstChild !== b) toolbar.insertBefore(b, toolbar.firstChild);

        if (!drEl || !drEl.isConnected) {
            drEl = document.createElement("div");
            drEl.id = "pf-dr";
            drEl.className = "pf-dr";
            drEl.setAttribute("aria-hidden", "true");
            drEl.innerHTML =
                '<div class="pf-dr-back"></div>' +
                '<aside class="pf-dr-panel MuiDrawer-paper" role="dialog" aria-label="' + T.menu + '">' +
                '<div class="pf-dr-head"><div class="pf-dr-brand">' + BADGE + WORDMARK + '</div>' +
                '<button type="button" class="pf-dr-close" aria-label="' + T.close + '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div>' +
                '<div class="mainDrawer-scrollContainer pf-dr-scroll" role="presentation"></div></aside>';
            document.body.appendChild(drEl);
            drEl.querySelector(".pf-dr-back").addEventListener("click", drClose);
            drEl.querySelector(".pf-dr-close").addEventListener("click", drClose);
            drEl.addEventListener("click", function (ev) {
                var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
                if (a && drEl.contains(a)) setTimeout(drClose, 0);
            });
            drFill();
        }
    }

    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && drEl && drEl.classList.contains("pf-dr-open")) drClose(); });
    function drOnHash() { drClose(); drSync(); }
    window.addEventListener("hashchange", drOnHash);

    function isVideoRoute() {
        var p = (window.location.hash || "").replace(/^#/, "").split("?")[0];
        return p === "/video" || p === "/video.html";
    }

    // Player: marca a rota no <html> e coloca o logo ParticularFlix logo depois do botao voltar do cabecalho do player.
    function syncVideo() {
        var root = document.documentElement;
        var vid = isVideoRoute();
        if (vid !== root.classList.contains("pf-route-video")) root.classList.toggle("pf-route-video", vid);
        if (!vid) return;
        ensureStyle();
        var bar = document.querySelector(".videoOsd-appBar");
        if (!bar || bar.querySelector(":scope > .pf-logo-osd")) return;
        var back = bar.querySelector(":scope > .MuiIconButton-root");
        var logo = document.createElement("a");
        logo.className = "pf-logo-osd";
        logo.href = "#/home";
        logo.setAttribute("aria-label", "ParticularFlix");
        logo.innerHTML = BADGE + WORDMARK;
        // Sai do player e vai para a Inicio (o Jellyfin encerra a reproducao ao trocar de pagina).
        logo.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            window.location.hash = "#/home";
            agendarAbaInicio();
        });
        if (back && back.parentNode === bar) back.insertAdjacentElement("afterend", logo); else bar.insertBefore(logo, bar.firstChild);
    }

    var lastFitSig = "";
    function place() {
        syncVideo();
        var header = document.querySelector("header.MuiAppBar-root");
        if (!header) return;
        ensureAdminLinks();
        var stack = header.querySelector(".MuiToolbar-root > .MuiStack-root");
        if (!stack || !stack.parentElement) { placeLogoOnly(header); return; }
        var toolbar = stack.parentElement;

        ensureStyle();
        var root = document.documentElement;
        if (!root.classList.contains("pf-modern-on")) root.classList.add("pf-modern-on");

        var logo = toolbar.querySelector(":scope > .pf-logo-modern");
        if (!logo) {
            logo = document.createElement("a");
            logo.className = "pf-logo-modern";
            logo.href = "#/home";
            logo.setAttribute("aria-label", "ParticularFlix");
            logo.innerHTML = BADGE + WORDMARK;
            logo.addEventListener("click", onLogoClick);
        }
        if (logo.nextElementSibling !== stack) toolbar.insertBefore(logo, stack);

        // A nossa pilula e sempre o mesmo elemento: se o React recriar a barra, ela so volta para o lugar.
        var home = homeEl;
        if (!home) {
            home = document.createElement("a");
            home.className = "pf-nav-home";
            home.href = "#/home";
            home.addEventListener("click", onHomePillClick);
            home.setAttribute("data-pf-home", "1");
            home.innerHTML = HOME_ICON + '<span class="pf-home-lbl">' + homeLabel() + "</span>";
            homeEl = home;
        }
        if (stack.firstElementChild !== home) stack.insertBefore(home, stack.firstElementChild);

        syncLinks(stack);
        if (drWanted()) drEnsure(toolbar); else drRemove();
        drSync();
        var sig = toolbar.clientWidth + "|" + window.innerWidth + "|" + stack.children.length + "|" + stack.textContent.length + "|" + (document.getElementById("jfNotifBtn") ? 1 : 0) + "|" + toolbar.children.length;
        if (sig !== lastFitSig) { lastFitSig = sig; fitNav(toolbar, stack, logo); }
        syncModernFlag(header);
    }

    function safePlace() {
        try { place(); } catch (e) {}
    }

    var queued = false;
    function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            safePlace();
        });
    }

    var pfObs = null;
    var pfPoll = null;

    // So reage a mudancas no cabecalho ou no corpo da pagina (nao no conteudo das telas), para nao interferir nas paginas dos plugins.
    function relevante(muts) {
        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            var t = m.target;
            // Mudancas diretas no body (popover, modal, dica de qualquer plugin) so contam se trouxerem o cabecalho
            // ou a gaveta (checado abaixo). Antes qualquer uma rodava place(), que mede a barra e forcava o
            // layout da pagina inteira (~175 ms na Inicio cheia, a cada popover aberto).
            if (t.nodeType === 1 && t !== document.body && (t.id === "root" || t.classList.contains("skinHeader") || (t.closest && t.closest("header.MuiAppBar-root")))) return true;
            var nodes = [];
            for (var a = 0; a < m.addedNodes.length; a++) nodes.push(m.addedNodes[a]);
            for (var r = 0; r < m.removedNodes.length; r++) nodes.push(m.removedNodes[r]);
            for (var n = 0; n < nodes.length; n++) {
                var x = nodes[n];
                if (x.nodeType !== 1) continue;
                if (x.matches && (x.matches("header,.MuiAppBar-root,.MuiToolbar-root,.MuiDrawer-root,.MuiDrawer-paper") || x.querySelector("header.MuiAppBar-root,.MuiDrawer-paper"))) return true;
            }
        }
        return false;
    }

    function pfStop() {
        try { if (pfObs) pfObs.disconnect(); } catch (e) {}
        pfObs = null;
        if (pfPoll) clearInterval(pfPoll);
        pfPoll = null;
        window.removeEventListener("hashchange", schedule);
        window.removeEventListener("popstate", schedule);
        window.removeEventListener("resize", schedule);
        return "cabecalho ParticularFlix pausado (recarregue a pagina para voltar)";
    }
    window.__pfStop = pfStop;

    function start() {
        // O CSS entra tambem no Legado (sino); as regras do Modern dependem da classe pf-modern-on.
        try { ensureStyle(); } catch (e) {}
        safePlace();
        window.addEventListener("hashchange", schedule);
        window.addEventListener("popstate", schedule);
        window.addEventListener("resize", schedule);
        // Nao interceptamos history.pushState: isso quebrava navegacoes do Enhanced (Catalogo: Em alta, Filmes populares...).
        try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { lastFitSig = ""; schedule(); }); } catch (e) {}
        var lastUrl = location.href;
        pfPoll = setInterval(function () {
            if (location.href !== lastUrl) { lastUrl = location.href; schedule(); }
            if (isVideoRoute()) { try { syncVideo(); } catch (e) {} }
            // So no Modern: no Legado as paginas do Enhanced ficam onde o Jellyfin as coloca.
            if (document.documentElement.classList.contains("pf-modern-on")) try {
                var pgs = document.querySelectorAll('.mainAnimatedPage[id^="je-"]:not(.hide), #je-recommendations-category-page:not(.hide)');
                for (var i = 0; i < pgs.length; i++) { if (pgs[i].parentNode !== document.body) document.body.appendChild(pgs[i]); }
            } catch (e) {}
        }, 250);
        // Sincrono (antes da pintura): se o React recriar o cabecalho, a nossa marca volta no mesmo quadro, sem piscar.
        pfObs = new MutationObserver(function (muts) { if (relevante(muts)) safePlace(); });
        pfObs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
