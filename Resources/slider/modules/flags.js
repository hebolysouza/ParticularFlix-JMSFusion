/* Bandeiras simples (SVG embutido) para o badge de audio. Chave: codigo ISO 639-2/1 do idioma. */
const S = (inner) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'>${inner}</svg>`;
const FLAGS = {
  BR: S("<rect width='24' height='16' fill='#009b3a'/><path d='M12 2.2 21.4 8 12 13.8 2.6 8z' fill='#fedf00'/><circle cx='12' cy='8' r='3.4' fill='#002776'/><path d='M8.9 7.2c2.2-.5 4.6-.2 6.4 1.1' stroke='#fff' stroke-width='.7' fill='none'/>"),
  US: S("<rect width='24' height='16' fill='#fff'/>" + [0,2,4,6,8,10,12].map((i) => `<rect y='${(i * 16 / 13).toFixed(2)}' width='24' height='${(16 / 13).toFixed(2)}' fill='#b22234'/>`).join('') + "<rect width='10.4' height='8.6' fill='#3c3b6e'/><path d='M1.2 1.4h8M1.2 3.2h8M1.2 5h8M1.2 6.8h8' stroke='#fff' stroke-width='.7' stroke-dasharray='.7 1.1'/>"),
  ES: S("<rect width='24' height='16' fill='#c60b1e'/><rect y='4' width='24' height='8' fill='#ffc400'/>"),
  FR: S("<rect width='8' height='16' fill='#0055a4'/><rect x='8' width='8' height='16' fill='#fff'/><rect x='16' width='8' height='16' fill='#ef4135'/>"),
  DE: S("<rect width='24' height='5.4' fill='#000'/><rect y='5.3' width='24' height='5.4' fill='#d00'/><rect y='10.6' width='24' height='5.4' fill='#ffce00'/>"),
  IT: S("<rect width='8' height='16' fill='#009246'/><rect x='8' width='8' height='16' fill='#fff'/><rect x='16' width='8' height='16' fill='#ce2b37'/>"),
  JP: S("<rect width='24' height='16' fill='#fff'/><circle cx='12' cy='8' r='4.6' fill='#bc002d'/>"),
  RU: S("<rect width='24' height='5.4' fill='#fff'/><rect y='5.3' width='24' height='5.4' fill='#0039a6'/><rect y='10.6' width='24' height='5.4' fill='#d52b1e'/>"),
  KR: S("<rect width='24' height='16' fill='#fff'/><path d='M7.4 8a4.6 4.6 0 0 1 9.2 0z' fill='#cd2e3a'/><path d='M7.4 8a4.6 4.6 0 0 0 9.2 0z' fill='#0047a0'/>"),
  CN: S("<rect width='24' height='16' fill='#de2910'/><path d='m5 2 1 3h3.1l-2.5 1.8.9 3L5 8l-2.5 1.8.9-3L1 5h3.1z' fill='#ffde00'/>"),
  PT: S("<rect width='9.6' height='16' fill='#006600'/><rect x='9.6' width='14.4' height='16' fill='#ff0000'/><circle cx='9.6' cy='8' r='3' fill='#ffe000' stroke='#fff' stroke-width='.6'/>")
};
const LANG_TO_FLAG = {
  por: 'BR', pt: 'BR', eng: 'US', en: 'US', spa: 'ES', es: 'ES', fre: 'FR', fra: 'FR', fr: 'FR',
  ger: 'DE', deu: 'DE', de: 'DE', ita: 'IT', it: 'IT', jpn: 'JP', ja: 'JP', rus: 'RU', ru: 'RU',
  kor: 'KR', ko: 'KR', chi: 'CN', zho: 'CN', cmn: 'CN', zh: 'CN'
};
const cache = new Map();

export function flagHtmlFor(langCode) {
  const code = String(langCode || '').trim().toLowerCase();
  const id = LANG_TO_FLAG[code];
  if (!id || !FLAGS[id]) return '';
  if (!cache.has(id)) {
    cache.set(id, `<img class="jms-flag" alt="" draggable="false" src="data:image/svg+xml,${encodeURIComponent(FLAGS[id])}">`);
  }
  return cache.get(id);
}

/* Fork ParticularFlix: bandeiras de PAIS (emoji de indicador regional, ex. 🇺🇸) nao aparecem no Windows,
   que desenha so as letras ("US"). Quando o navegador nao sabe desenhar a bandeira, entra uma fonte pequena
   (Twemoji Country Flags, ~78 KB, MIT/CC-BY 4.0, ver src/fonts) que cobre so esses caracteres
   (unicode-range), usada pela classe jms-flag-emoji. Celulares e macOS continuam com a fonte do sistema. */
const FLAG_FONT_FAMILY = "Twemoji Country Flags";
let flagFontChecked = false;

function emojiRendersInColor(text) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.textBaseline = "top";
    ctx.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
    ctx.scale(0.01, 0.01);
    const paint = (color) => {
      ctx.clearRect(0, 0, 100, 100);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data.join(",");
    };
    const white = paint("#fff");
    const black = paint("#000");
    return white === black && !black.startsWith("0,0,0,");
  } catch {
    return true;
  }
}

export function ensureFlagEmojiFont(fontUrl) {
  if (flagFontChecked) return;
  flagFontChecked = true;
  if (typeof document === "undefined") return;
  if (!emojiRendersInColor("\u{1F60A}") || emojiRendersInColor("\u{1F1E8}\u{1F1ED}")) return;
  const style = document.createElement("style");
  style.id = "jms-flag-emoji-font";
  style.textContent = `@font-face{font-family:"${FLAG_FONT_FAMILY}";unicode-range:U+1F1E6-1F1FF,U+1F3F4,U+E0062-E0063,U+E0065,U+E0067,U+E006C,U+E006E,U+E0073-E0074,U+E0077,U+E007F;src:url("${fontUrl}") format("woff2");font-display:swap}`;
  document.head.appendChild(style);
}

export const FLAG_EMOJI_FONT_STACK = `"${FLAG_FONT_FAMILY}","Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
