/* ParticularFlix - cabecalho do layout Modern do Jellyfin 12.
   Arquivo ADICIONAL: nao altera o particularflix-logo.js (layout Legado).
   Para remover: apague este arquivo da pasta custom.

   O que faz: logo ParticularFlix, botao de menu (hamburguer), navegacao em pilulas
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
    var STYLE_ID = "pf-modern-header-style";

    var CSS = [
        ROOT + " a[href=\"#/\"]:not(.pf-logo-modern){display:none !important;}",
        STACK + " a[href=\"#/\"]:not(.pf-logo-modern):not(.pf-nav-home){display:none !important;}",
        "html.pf-modern-active .skinHeader{visibility:hidden !important;opacity:0 !important;pointer-events:none !important;transition:none !important;}",
        ROOT + " .MuiToolbar-root{position:relative;}",
        "html.pf-modern-on:not(.pf-nav-flow) " + STACK + "{position:absolute !important;left:50%;top:50%;transform:translate(-50%,-50%);display:flex !important;align-items:center;gap:8px;}",
        "html.pf-modern-on.pf-nav-flow " + STACK + "{position:static !important;transform:none;margin-left:12px;display:flex !important;align-items:center;gap:6px;}",
        STACK + " a:not(.pf-logo-modern){display:inline-flex !important;align-items:center;gap:6px;border-radius:999px !important;padding:6px 16px !important;min-width:0;background:rgba(255,255,255,0.06);color:#F2F2F2 !important;text-transform:none !important;text-decoration:none;font-size:14px;line-height:1.2;transition:background-color 200ms ease,box-shadow 200ms ease,color 200ms ease;}",
        "html.pf-nav-flow " + STACK + " a:not(.pf-logo-modern){padding:6px 12px !important;font-size:13px;}",
        STACK + " a:not(.pf-logo-modern) svg{width:18px;height:18px;fill:currentColor;}",
        STACK + " a:not(.pf-logo-modern):hover{background:rgba(229,9,20,0.38);}",
        STACK + " a.pf-nav-active{background:#E50914 !important;color:#FFFFFF !important;box-shadow:0 4px 14px rgba(229,9,20,0.35);}",
        STACK + " a.pf-nav-hidden{display:none !important;}",
        ".pf-logo-modern{display:inline-flex !important;align-items:center;gap:10px;flex:0 0 auto;margin-left:4px;padding:4px 14px 4px 4px;line-height:1;text-decoration:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
        ".pf-logo-modern:hover .pf-badge-wrap{transform:scale(1.08);}",
        ".pf-logo-modern:hover .pf-bar-1{transform:scaleY(1.16);}",
        ".pf-logo-modern:hover .pf-bar-2{transform:scaleY(1.28);transition-delay:55ms;}",
        ".pf-logo-modern:hover .pf-bar-3{transform:scaleY(1.5);transition-delay:110ms;}",
        ".pf-logo-modern:hover .pf-badge-sheen{transform:translateX(130%);transition:transform 620ms ease;}",
        ".pf-logo-modern:hover .pf-wm-f::after,.pf-logo-modern:focus-visible .pf-wm-f::after{transform:scaleX(1);}",
        ".pf-logo-modern:hover .pf-wm-f,.pf-logo-modern:focus-visible .pf-wm-f{color:#FF3B47;text-shadow:0 0 7px rgba(229,9,20,0.6);}",
        ".pf-logo-modern:focus-visible{outline:2px solid #FF3B47;outline-offset:4px;border-radius:4px;}",
        ".pf-menu-modern{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:40px;height:40px;margin-right:2px;padding:0;border:0;border-radius:50%;background:transparent;color:#F2F2F2;cursor:pointer;transition:background-color 200ms ease,transform 200ms ease;}",
        ".pf-menu-modern svg{width:24px;height:24px;fill:currentColor;pointer-events:none;}",
        ".pf-menu-modern:hover{background:rgba(229,9,20,0.25);transform:scale(1.08);}",
        ".pf-menu-modern:active{transform:scale(0.92);}"
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
    var MENU_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>';

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

    function onMenuClick(ev) {
        ev.preventDefault();
        var b = document.querySelector(".skinHeader .mainDrawerButton");
        if (b) b.click();
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
        root.classList.remove("pf-nav-flow");
        var t = toolbar.getBoundingClientRect();
        if (!t.width) return;
        var boxes = toolbar.querySelectorAll(":scope > .MuiBox-root");
        var rightLeft = boxes.length ? boxes[0].getBoundingClientRect().left : t.right;
        var sw = stack.getBoundingClientRect().width;
        var left = t.left + t.width / 2 - sw / 2;
        var right = left + sw;
        var logoRight = logo.getBoundingClientRect().right;
        if (left < logoRight + 12 || right > rightLeft - 12) root.classList.add("pf-nav-flow");
    }

    function syncModernFlag(header) {
        var r = header.getBoundingClientRect();
        var cs = window.getComputedStyle(header);
        var vis = r.width > 0 && r.height > 0 && r.top > -2 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
        var root = document.documentElement;
        if (vis !== root.classList.contains("pf-modern-active")) root.classList.toggle("pf-modern-active", vis);
    }

    function place() {
        var header = document.querySelector("header.MuiAppBar-root");
        if (!header) return;
        var stack = header.querySelector(".MuiToolbar-root > .MuiStack-root");
        if (!stack || !stack.parentElement) return;
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

        var menu = toolbar.querySelector(":scope > .pf-menu-modern");
        if (!menu) {
            menu = document.createElement("button");
            menu.type = "button";
            menu.className = "pf-menu-modern";
            menu.setAttribute("aria-label", "Menu");
            menu.innerHTML = MENU_ICON;
            menu.addEventListener("click", onMenuClick);
        }
        if (menu.nextElementSibling !== logo) toolbar.insertBefore(menu, logo);

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
