/*
 * Perfis de posicao por layout.
 * As posicoes manuais (Top/Left/Width/Height/Display/Flex... de cada bloco) ficam nas chaves de sempre
 * do localStorage. Aqui as chaves do layout ativo sao trocadas quando o layout muda:
 *   classic  = Normal, Peak, Compact (comportamento original, compartilham as mesmas chaves)
 *   cinema   = Cinema (valores sao deslocamentos a partir do padrao do layout)
 *   mosaic   = Mosaico (idem)
 *   coverflow= Coverflow 3D (nasce como copia do classic, ja que usa o motor Peak)
 * Assim o editor de posicoes e o motor de posicao nao precisam saber de perfis.
 */
const PREFIXES = ['slide', 'progressBar', 'progressSeconds', 'logoContainer', 'buttonContainer', 'metaContainer',
  'plotContainer', 'titleContainer', 'directorContainer', 'infoContainer', 'mainContainer', 'sliderContainer',
  'existingDotContainer', 'dotContainer', 'providerContainer', 'providericonsContainer', 'statusContainer', 'ratingContainer'];
const SUFFIXES = ['Top', 'Left', 'Width', 'Height', 'Display', 'FlexDirection', 'JustifyContent', 'AlignItems', 'FlexWrap'];
const KEYS = PREFIXES.flatMap((p) => SUFFIXES.map((s) => p + s));
const ACTIVE_KEY = 'jmsPosProfileActive';
const STORE = 'jmsPosProfile:';

export function profileIdFromVariant(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('coverflow')) return 'coverflow';
  if (v.includes('cinema') || v.includes('trailer')) return 'cinema';
  if (v.includes('mosaic')) return 'mosaic';
  return 'classic';
}

export function getActivePositionProfile() {
  try { return localStorage.getItem(ACTIVE_KEY) || profileIdFromVariant(localStorage.getItem('cssVariant')); } catch { return 'classic'; }
}

function snapshot() {
  const out = {};
  KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) out[k] = v; });
  return out;
}

export function syncPositionProfile() {
  try {
    const target = profileIdFromVariant(localStorage.getItem('cssVariant'));
    // as chaves ja existentes foram ajustadas para os layouts classicos
    const active = localStorage.getItem(ACTIVE_KEY) || 'classic';
    if (active === target) {
      if (localStorage.getItem(ACTIVE_KEY) !== target) localStorage.setItem(ACTIVE_KEY, target);
      return;
    }
    const current = snapshot();
    localStorage.setItem(STORE + active, JSON.stringify(current));
    KEYS.forEach((k) => localStorage.removeItem(k));

    let next = null;
    try { next = JSON.parse(localStorage.getItem(STORE + target) || 'null'); } catch {}
    if (!next && target === 'coverflow') {
      if (active === 'classic') next = current;
      else { try { next = JSON.parse(localStorage.getItem(STORE + 'classic') || 'null'); } catch {} }
    }
    if (next && typeof next === 'object') {
      Object.entries(next).forEach(([k, v]) => { if (KEYS.includes(k)) localStorage.setItem(k, String(v)); });
    }
    localStorage.setItem(ACTIVE_KEY, target);
  } catch {}
}
