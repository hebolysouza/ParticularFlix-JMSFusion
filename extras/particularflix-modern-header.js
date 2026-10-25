/* ParticularFlix - logo no cabecalho do layout Modern do Jellyfin 12.
   Arquivo ADICIONAL: nao altera o particularflix-logo.js (layout Legado).
   Para remover: apague este arquivo da pasta custom. */
(function () {
    "use strict";
    if (window.__pfModernHeader) return;
    window.__pfModernHeader = true;

    var STYLE_ID = "pf-modern-header-style";
    var CSS = [
        "header.MuiAppBar-root.pf-modern-ready a[href=\"#/\"]:not(.pf-logo-modern){display:none !important;}",
        ".pf-logo-modern{display:inline-flex !important;align-items:center;gap:10px;flex:0 0 auto;margin-left:4px;padding:4px 14px 4px 4px;line-height:1;text-decoration:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
        ".pf-logo-modern:hover .pf-badge-wrap{transform:scale(1.08);}",
        ".pf-logo-modern:hover .pf-bar-1{transform:scaleY(1.16);}",
        ".pf-logo-modern:hover .pf-bar-2{transform:scaleY(1.28);transition-delay:55ms;}",
        ".pf-logo-modern:hover .pf-bar-3{transform:scaleY(1.5);transition-delay:110ms;}",
        ".pf-logo-modern:hover .pf-badge-sheen{transform:translateX(130%);transition:transform 620ms ease;}",
        ".pf-logo-modern:hover .pf-wm-f::after,.pf-logo-modern:focus-visible .pf-wm-f::after{transform:scaleX(1);}",
        ".pf-logo-modern:hover .pf-wm-f,.pf-logo-modern:focus-visible .pf-wm-f{color:#FF3B47;text-shadow:0 0 7px rgba(229,9,20,0.6);}",
        ".pf-logo-modern:focus-visible{outline:2px solid #FF3B47;outline-offset:4px;border-radius:4px;}",
        "@media (min-width:900px){",
        "header.MuiAppBar-root.pf-modern-ready .MuiToolbar-root{position:relative;}",
        "header.MuiAppBar-root.pf-modern-ready .pf-nav-center{position:absolute !important;left:50%;top:50%;transform:translate(-50%,-50%);display:flex !important;align-items:center;gap:8px;}",
        "}",
        "header.MuiAppBar-root .pf-nav-center a:not(.pf-logo-modern){display:inline-flex !important;align-items:center;gap:6px;border-radius:999px !important;padding:6px 16px !important;min-width:0;background:rgba(255,255,255,0.06);color:#F2F2F2 !important;text-transform:none !important;text-decoration:none;font-size:14px;line-height:1.2;transition:background-color 200ms ease,box-shadow 200ms ease,color 200ms ease;}",
        "header.MuiAppBar-root .pf-nav-center a:not(.pf-logo-modern) svg{width:18px;height:18px;fill:currentColor;}",
        "header.MuiAppBar-root .pf-nav-center a:not(.pf-logo-modern):hover{background:rgba(229,9,20,0.38);}",
        "header.MuiAppBar-root .pf-nav-center a.pf-nav-active{background:#E50914 !important;color:#FFFFFF !important;box-shadow:0 4px 14px rgba(229,9,20,0.35);}",
        "header.MuiAppBar-root .pf-nav-center a.pf-nav-home{cursor:pointer;}"
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

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement("style");
        s.id = STYLE_ID;
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    var HOME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';

    function homeLabel() {
        var l = ((document.documentElement.lang || navigator.language || "") + "").toLowerCase();
        if (l.indexOf("pt") === 0) return "In\u00edcio";
        if (l.indexOf("es") === 0) return "Inicio";
        return "Home";
    }

    function syncActive(stack) {
        var cur = (window.location.hash || "#/").replace(/^#/, "");
        var parts = cur.split("?");
        var curPath = parts[0] || "/";
        var curTab = new URLSearchParams(parts[1] || "").get("tab");
        var links = stack.querySelectorAll("a:not(.pf-logo-modern)");
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
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

    function place() {
        var header = document.querySelector("header.MuiAppBar-root");
        if (!header) return;
        var orig = header.querySelector('a[href="#/"]:not(.pf-logo-modern):not(.pf-nav-home)');
        if (!orig || !orig.parentElement) return;
        var stack = orig.parentElement;
        var toolbar = stack.parentElement;
        if (!toolbar) return;

        ensureStyle();

        var logo = header.querySelector(".pf-logo-modern");
        if (!logo) {
            logo = document.createElement("a");
            logo.className = "pf-logo-modern";
            logo.href = "#/";
            logo.setAttribute("aria-label", "ParticularFlix");
            logo.innerHTML = BADGE + WORDMARK;
        }
        if (logo.nextElementSibling !== stack) {
            toolbar.insertBefore(logo, stack);
        }

        if (!stack.classList.contains("pf-nav-center")) stack.classList.add("pf-nav-center");

        var home = stack.querySelector("a.pf-nav-home");
        if (!home) {
            home = document.createElement("a");
            home.className = "pf-nav-home";
            home.href = "#/home";
            home.innerHTML = HOME_ICON + "<span>" + homeLabel() + "</span>";
        }
        if (stack.firstElementChild !== home) {
            stack.insertBefore(home, stack.firstElementChild);
        }

        header.classList.add("pf-modern-ready");
        syncActive(stack);
    }

    var queued = false;
    function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            try { place(); } catch (e) {}
        });
    }

    function start() {
        schedule();
        window.addEventListener("hashchange", schedule);
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
