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
        "html.pf-modern-active .skinHeader{visibility:hidden !important;opacity:0 !important;pointer-events:none !important;transition:none !important;}",
        ROOT + " .MuiToolbar-root{position:relative;}",
        "html.pf-modern-on:not(.pf-nav-flow) " + HDR + "{position:absolute !important;left:50%;top:50%;transform:translate(-50%,-50%);width:max-content;display:flex !important;align-items:center;gap:8px;}",
        "html.pf-modern-on.pf-nav-flow " + HDR + "{position:static !important;transform:none;margin-left:12px;display:flex !important;align-items:center;gap:6px;}",
        STACK + " a:not(.pf-logo-modern){display:inline-flex !important;align-items:center;gap:6px;border-radius:999px !important;padding:6px 16px !important;min-width:0;background:rgba(255,255,255,0.06);color:#F2F2F2 !important;text-transform:none !important;text-decoration:none;font-size:14px;line-height:1.2;transition:background-color 200ms ease,box-shadow 200ms ease,color 200ms ease;}",
        "html.pf-modern-on.pf-nav-flow " + HDR + " a:not(.pf-logo-modern){padding:6px 12px !important;font-size:13px;}",
        // Modo compacto: sem icones nas pilulas e sem quebra de linha, para o perfil/icones da direita nao cairem para a linha de baixo.
        "html.pf-modern-on.pf-nav-flow " + HDR + " a:not(.pf-logo-modern) svg{display:none !important;}",
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
    var HOME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';

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
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    function onLogoClick(ev) {
        var cur = (window.location.hash || "#/").replace(/^#/, "").split("?")[0];
        if (cur === "/home" || cur === "/home.html" || cur === "/" || cur === "") {
            ev.preventDefault();
            try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
        }
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
            var hid = hide.indexOf(norm(a.textContent)) >= 0;
            if (hid !== a.classList.contains("pf-nav-hidden")) a.classList.toggle("pf-nav-hidden", hid);
            var active = false;
            if (a.classList.contains("pf-nav-home")) {
                active = (curPath === "/home" || curPath === "/home.html" || curPath === "/" || curPath === "") && (curTab === null || curTab === "0");
            } else {
                var href = (a.getAttribute("href") || "").replace(/^#/, "");
                if (href === "/" || href === "") continue;
                var hp = href.split("?");
                if (hp[0] === "/home") {
                    var want = new URLSearchParams(hp[1] || "").get("tab");
                    active = curPath === "/home" && want !== null && want === curTab;
                } else {
                    active = curPath === hp[0];
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

    function place() {
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

        var home = stack.querySelector("a.pf-nav-home");
        if (!home) {
            home = document.createElement("a");
            home.className = "pf-nav-home";
            home.href = "#/home";
            home.innerHTML = HOME_ICON + "<span>" + homeLabel() + "</span>";
        }
        if (stack.firstElementChild !== home) stack.insertBefore(home, stack.firstElementChild);

        syncLinks(stack);
        fitNav(toolbar, stack, logo);
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

    function start() {
        safePlace();
        window.addEventListener("hashchange", schedule);
        window.addEventListener("resize", schedule);
        // Sincrono (antes da pintura): se o React recriar o cabecalho, a nossa marca volta no mesmo quadro, sem piscar.
        new MutationObserver(safePlace).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
