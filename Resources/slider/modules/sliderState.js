import { getConfig } from "./config.js";

let currentIndex = 0;
let autoSlideTimeout = null;
let slideStartTime = 0;
let remainingTime = 0;

export function setCurrentIndex(index) {
  currentIndex = index;
  syncMobilePosition(index);
}

// Fork ParticularFlix 4.0.0.11: no mobile a posicao no slider e uma barra fina no pe do slider (pedido do dono; no
// celular nao ha pontos de navegacao). Roda so quando o slide muda: uma contagem dos slides e, se o valor mudou,
// uma variavel CSS. Sem leitura de layout; o desenho fica no CSS critico do main.js (html.jms-mobile).
function syncMobilePosition(index) {
  try {
    if (!document.documentElement.classList.contains("jms-mobile")) return;
    const sc =
      document.querySelector("#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container") ||
      document.querySelector("#monwui-slides-container");
    if (!sc) return;
    const total = sc.querySelectorAll(".monwui-slide").length;
    if (!total) return;
    let bar = sc.querySelector(":scope > .jms-mob-pos");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "jms-mob-pos";
      bar.setAttribute("aria-hidden", "true");
      sc.appendChild(bar);
    }
    const pos = Math.min(total, Math.max(1, (Number(index) || 0) + 1));
    const value = (pos / total).toFixed(4);
    if (bar.style.getPropertyValue("--jms-pos") !== value) bar.style.setProperty("--jms-pos", value);
  } catch {}
}

export function getCurrentIndex() {
  return currentIndex;
}

export function getSlideDuration() {
  return getConfig().sliderDuration;
}

export function setAutoSlideTimeout(timeout) {
  autoSlideTimeout = timeout;
}

export function getAutoSlideTimeout() {
  return autoSlideTimeout;
}

export function setSlideStartTime(time) {
  slideStartTime = time;
}

export function getSlideStartTime() {
  return slideStartTime;
}

export function setRemainingTime(time) {
  remainingTime = time;
}

export function getRemainingTime() {
  return remainingTime;
}

let sliderMemory = {
  lastIndex: 0,
  remainingTime: 0
};

export const saveSliderState = () => {
  sliderMemory = {
    lastIndex: getCurrentIndex(),
    remainingTime: getRemainingTime()
  };
};

export const restoreSliderState = () => {
  if (sliderMemory) {
    setCurrentIndex(sliderMemory.lastIndex);
    setRemainingTime(sliderMemory.remainingTime);
  }
};
