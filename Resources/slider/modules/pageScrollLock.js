// Fork ParticularFlix: elemento certo para travar a rolagem da pagina com overflow:hidden.
// No Jellyfin 12 html e body tem 100% de altura, o html fica com overflow visivel e o overflow do body e
// repassado para a janela. Travar o html quebra esse repasse: o body vira uma caixa da altura da tela e a
// rolagem da pagina vai para o topo enquanto o modal esta aberto. Trava-se entao o elemento cujo overflow
// controla a janela: o body quando o html esta "visible", senao o proprio html.
export function getPageOverflowElement() {
  const html = document.documentElement;
  const body = document.body;
  if (!body) return html;
  try {
    const cs = getComputedStyle(html);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") return body;
  } catch {}
  return html;
}
