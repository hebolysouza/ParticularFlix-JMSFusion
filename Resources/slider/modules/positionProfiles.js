/*
 * Posicoes manuais por layout.
 * As chaves de posicao de sempre (Top/Left/Width/Height/Display/Flex... de cada bloco) pertencem ao
 * grupo classico (Normal, Peak, Compact) e NUNCA sao alteradas por aqui.
 * Cinema, Mosaico e Coverflow 3D guardam apenas o que voce ajustar neles, em chaves proprias
 * "jmsPos:<layout>:<chave>", e o getConfig() sobrepoe esses valores quando o layout esta ativo:
 *   cinema / mosaic : comecam vazios (posicao padrao do layout); Top/Left funcionam como deslocamento
 *   coverflow       : comeca igual ao classico (motor Peak) e so diverge no que for ajustado
 */
const PREFIXES = ['slide', 'progressBar', 'progressSeconds', 'logoContainer', 'buttonContainer', 'metaContainer',
  'plotContainer', 'titleContainer', 'directorContainer', 'infoContainer', 'mainContainer', 'sliderContainer',
  'existingDotContainer', 'dotContainer', 'providerContainer', 'providericonsContainer', 'statusContainer', 'ratingContainer'];
const SUFFIXES = ['Top', 'Left', 'Width', 'Height', 'Display', 'FlexDirection', 'JustifyContent', 'AlignItems', 'FlexWrap'];
export const POSITION_KEYS = PREFIXES.flatMap((p) => SUFFIXES.map((s) => p + s));
const KEYSET = new Set(POSITION_KEYS);
const NS = 'jmsPos:';

export function profileIdFromVariant(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('coverflow')) return 'coverflow';
  if (v.includes('cinema') || v.includes('trailer')) return 'cinema';
  if (v.includes('mosaic')) return 'mosaic';
  return 'classic';
}

export function getActivePositionProfile() {
  try { return profileIdFromVariant(localStorage.getItem('cssVariant')); } catch { return 'classic'; }
}

function isNumericKey(k) { return /(Top|Left|Width|Height)$/.test(k); }

function setManaged(key, value) {
  try { window.__JMS_MANAGED_STORAGE__?.registerKeys?.([key]); } catch {}
  localStorage.setItem(key, value);
}

/* Sobrepoe no objeto de configuracao os valores do layout ativo. */
export function applyPositionOverlay(cfg) {
  try {
    const id = getActivePositionProfile();
    if (id === 'classic') return cfg;
    for (const k of POSITION_KEYS) {
      const raw = localStorage.getItem(`${NS}${id}:${k}`);
      if (raw !== null) cfg[k] = isNumericKey(k) ? (parseInt(raw, 10) || 0) : raw;
      else if (id !== 'coverflow') cfg[k] = isNumericKey(k) ? 0 : '';
    }
  } catch {}
  return cfg;
}

/* Salva os valores do formulario de posicoes no layout ativo (nao toca nas chaves classicas). */
export function savePositionOverrides(values) {
  try {
    const id = getActivePositionProfile();
    if (id === 'classic') return false;
    for (const [k, v] of Object.entries(values || {})) {
      if (!KEYSET.has(k)) continue;
      const empty = v === '' || v === null || v === undefined || (typeof v === 'number' && (!Number.isFinite(v) || v === 0));
      const key = `${NS}${id}:${k}`;
      if (empty) {
        // no coverflow um valor vazio precisa valer como vazio (senao voltaria ao valor do classico)
        if (id === 'coverflow' && localStorage.getItem(key) !== null) setManaged(key, '');
        else if (id !== 'coverflow') localStorage.removeItem(key);
      } else {
        setManaged(key, String(v));
      }
    }
    return true;
  } catch { return false; }
}

export function isPositionKey(k) { return KEYSET.has(k); }

/*
 * Migracao das builds 3.8.2.31/32, que trocavam as chaves classicas de lugar:
 * devolve as posicoes classicas e move as do layout para as chaves proprias.
 */
export function migratePositionProfiles() {
  try {
    const active = localStorage.getItem('jmsPosProfileActive');
    const stored = {};
    const storedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jmsPosProfile:')) storedKeys.push(k);
    }
    if (active === null && !storedKeys.length) return;

    const parse = (raw) => { try { const o = JSON.parse(raw || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; } };
    storedKeys.forEach((k) => { stored[k.slice('jmsPosProfile:'.length)] = parse(localStorage.getItem(k)); });

    if (active && active !== 'classic') {
      const live = {};
      POSITION_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) live[k] = v; });
      Object.entries(live).forEach(([k, v]) => setManaged(`${NS}${active}:${k}`, v));
      POSITION_KEYS.forEach((k) => localStorage.removeItem(k));
      if (stored.classic) Object.entries(stored.classic).forEach(([k, v]) => { if (KEYSET.has(k)) setManaged(k, String(v)); });
    }
    Object.entries(stored).forEach(([id, data]) => {
      if (id === 'classic' || id === active || !data) return;
      Object.entries(data).forEach(([k, v]) => { if (KEYSET.has(k)) setManaged(`${NS}${id}:${k}`, String(v)); });
    });
    storedKeys.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem('jmsPosProfileActive');
  } catch {}
}
