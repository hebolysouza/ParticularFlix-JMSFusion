// Fork ParticularFlix: reduz camadas compostas permanentes do slider.
// Medido no navegador (Home): ~258 elementos com will-change, ~160 com filter e ~117 com
// backdrop-filter, quase todos repetidos nos 15 slides, inclusive nos que nao aparecem.
// Cada um vira uma camada que o compositor atualiza a cada commit (tarefas de 130 a 400 ms).
// Aqui so os slides inativos e o menu escondido perdem esses efeitos; o slide ativo fica igual.
// will-change e apenas dica (o navegador cria a camada na hora de animar); o drop-shadow dos
// textos e o desfoque do painel de audio so aparecem no slide ativo.
// Desligar: localStorage.setItem('jmsLayerTrim', 'off') e recarregar.
(function injectLayerTrim() {
  try {
    if (typeof document === "undefined") return;
    if (localStorage.getItem("jmsLayerTrim") === "off") return;
    if (document.getElementById("jms-layer-trim-style")) return;
    const st = document.createElement("style");
    st.id = "jms-layer-trim-style";
    st.textContent = [
      ".monwui-slide:not(.active) :is(.monwui-status-container,.monwui-logo-container,.monwui-plot-container,.monwui-provider-container,.monwui-info-container,.monwui-director-container,.monwui-no-logo-container,.monwui-title-container,.monwui-main-btn){will-change:auto}",
      ".monwui-slide:not(.active) :is(.monwui-title-container,.monwui-plot-container,.monwui-provider-container){filter:none}",
      ".monwui-slide:not(.active) .jms-audio-preview-overlay__panel{backdrop-filter:none;-webkit-backdrop-filter:none}",
      ".monwui-device-selector-top-dropdown.hide{backdrop-filter:none;-webkit-backdrop-filter:none}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  } catch {}
})();
