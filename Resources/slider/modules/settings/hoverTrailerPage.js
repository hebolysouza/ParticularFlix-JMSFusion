import { getConfig } from "../config.js";
import { createCheckbox, createSection, bindCheckboxKontrol, createSelect } from "./shared.js";
import { applySettings } from "./applySettings.js";

const cfg = getConfig();

export function createHoverTrailerPanel(config, labels) {
  const panel = document.createElement('div');
  panel.id = 'hover-panel';
  panel.className = 'settings-panel';

  const section = createSection(labels.hoverTrailer || 'HoverTrailer Ayarları');
  const allPreviewModalCheckbox = createCheckbox(
    'allPreviewModal',
    labels.allPreviewModal || 'Modalı Jellyfin geneline uygula',
    config.allPreviewModal
  );
  section.appendChild(allPreviewModalCheckbox);

  // Fork ParticularFlix: modo de abertura, atraso e botao de detalhes no cartao.
  section.appendChild(createSelect(
    'hoverOpenMode',
    labels.hoverOpenMode || 'Abertura do trailer ao passar o mouse',
    [
      { value: 'hover', text: labels.hoverOpenModeHover || 'Ao passar o mouse (com atraso)' },
      { value: 'click', text: labels.hoverOpenModeClick || 'Somente ao clicar no botao do cartao' },
      { value: 'off',   text: labels.hoverOpenModeOff   || 'Desligado' }
    ],
    config.hoverOpenMode || 'hover'
  ));

  const delayWrap = document.createElement('div');
  delayWrap.className = 'input-container';
  const delayLabel = document.createElement('label');
  delayLabel.htmlFor = 'hoverOpenDelayMs';
  delayLabel.textContent = labels.hoverOpenDelay || 'Atraso para abrir o trailer (ms)';
  const delayInput = document.createElement('input');
  delayInput.type = 'range';
  delayInput.id = 'hoverOpenDelayMs';
  delayInput.name = 'hoverOpenDelayMs';
  delayInput.min = '200';
  delayInput.max = '3000';
  delayInput.step = '100';
  const startDelay = Number(config.hoverOpenDelayMs);
  delayInput.value = String(Number.isFinite(startDelay) && startDelay > 0 ? Math.min(3000, Math.max(200, startDelay)) : 500);
  const delayValue = document.createElement('span');
  delayValue.style.marginLeft = '10px';
  delayValue.textContent = delayInput.value + ' ms';
  delayInput.addEventListener('input', () => { delayValue.textContent = delayInput.value + ' ms'; });
  delayInput.addEventListener('change', () => {
    try { localStorage.setItem('hoverOpenDelayMs', delayInput.value); } catch {}
  });
  delayWrap.append(delayLabel, delayInput, delayValue);
  section.appendChild(delayWrap);

  section.appendChild(createCheckbox(
    'showCardInfoButton',
    labels.showCardInfoButton || 'Mostrar botao de detalhes (i) nos cartoes',
    config.showCardInfoButton === true
  ));

  section.appendChild(createSelect(
    'cardActionsPosition',
    labels.cardActionsPosition || 'Posicao dos botoes no cartao',
    [
      { value: 'top-left',      text: labels.cardPosTopLeft      || 'Superior esquerdo' },
      { value: 'top-center',    text: labels.cardPosTopCenter    || 'Superior centro' },
      { value: 'top-right',     text: labels.cardPosTopRight     || 'Superior direito' },
      { value: 'middle-left',   text: labels.cardPosMiddleLeft   || 'Meio, lado esquerdo' },
      { value: 'middle-right',  text: labels.cardPosMiddleRight  || 'Meio, lado direito' },
      { value: 'bottom-left',   text: labels.cardPosBottomLeft   || 'Inferior esquerdo' },
      { value: 'bottom-center', text: labels.cardPosBottomCenter || 'Inferior centro' },
      { value: 'bottom-right',  text: labels.cardPosBottomRight  || 'Inferior direito' }
    ],
    config.cardActionsPosition || 'middle-right'
  ));

  const modeWrap = document.createElement('div');
  modeWrap.className = 'field-group';
  modeWrap.style.margin = '8px 0 4px';

  const title = document.createElement('div');
  title.className = 'field-label';
  title.textContent = (labels.globalPreviewMode || 'Global hover tipi');
  modeWrap.appendChild(title);

  const modes = [
    { val: 'modal',      text: (labels.globalPreviewModeModal || 'HoverTrailer')},
    { val: 'studioMini', text: (labels.globalPreviewModeStudio || 'StudioHubs Mini') }
  ];
  const current = config.globalPreviewMode || 'modal';

  modes.forEach(m => {
    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.marginRight = '16px';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'globalPreviewMode';
    input.value = m.val;
    input.checked = (current === m.val);

    label.appendChild(input);
    label.appendChild(document.createTextNode(m.text));
    modeWrap.appendChild(label);
  });

  section.appendChild(modeWrap);

  const studioMiniTrailerPopover = createCheckbox(
    'studioMiniTrailerPopover',
    (labels.studioMiniTrailerPopover || 'Fragman popover etkin'),
    !!config.studioMiniTrailerPopover
  );
  studioMiniTrailerPopover.style.margin = '8px 0';
  section.appendChild(studioMiniTrailerPopover);

  const preferTrailerCheckbox = createCheckbox(
    'preferTrailersInPreviewModal',
    labels.preferTrailersInPreviewModal || 'Modalda Fragman > Video',
    config.preferTrailersInPreviewModal
  );
  section.appendChild(preferTrailerCheckbox);

  const onlyTrailerCheckbox = createCheckbox(
    'onlyTrailerInPreviewModal',
    labels.onlyTrailerInPreviewModal || 'Modalda Sadece Fragman',
    config.onlyTrailerInPreviewModal
  );
  section.appendChild(onlyTrailerCheckbox);

  panel.appendChild(section);

  setTimeout(() => {
    const modalRadio  = document.querySelector('input[name="globalPreviewMode"][value="modal"]');
    const studioRadio = document.querySelector('input[name="globalPreviewMode"][value="studioMini"]');

    const preferCb  = document.querySelector('input[name="preferTrailersInPreviewModal"]');
    const preferLbl = document.querySelector('label[for="preferTrailersInPreviewModal"]');

    const onlyCb    = document.querySelector('input[name="onlyTrailerInPreviewModal"]');
    const onlyLbl   = document.querySelector('label[for="onlyTrailerInPreviewModal"]');

    const smTrailerCb  = document.querySelector('input[name="studioMiniTrailerPopover"]');
    const smTrailerLbl = document.querySelector('label[for="studioMiniTrailerPopover"]');
    const smTrailerContainer = smTrailerCb ? smTrailerCb.closest('.checkboxContainer') || smTrailerCb.parentElement : null;

    const setDisabled = (el, lbl, disabled) => {
      if (!el || !lbl) return;
      el.disabled = disabled;
      el.style.opacity = disabled ? '0.5' : '1';
      lbl.style.opacity = disabled ? '0.5' : '1';
    };

    const setVisible = (element, visible) => {
      if (!element) return;
      element.style.display = visible ? '' : 'none';
    };

    const updateByMode = () => {
      const isModal = !!modalRadio?.checked;
      const isStudio = !!studioRadio?.checked;

      if (!preferCb || !onlyCb) return;

      if (isModal) {
        setDisabled(preferCb, preferLbl, false);
        setDisabled(onlyCb,   onlyLbl,   false);
      } else {
        setDisabled(preferCb, preferLbl, true);
        setDisabled(onlyCb,   onlyLbl,   true);
      }

      if (smTrailerContainer) {
        setVisible(smTrailerContainer, isStudio);
      } else if (smTrailerCb && smTrailerLbl) {
        setVisible(smTrailerCb, isStudio);
        setVisible(smTrailerLbl, isStudio);
      }

      if (smTrailerCb && smTrailerLbl) {
        setDisabled(smTrailerCb, smTrailerLbl, !isStudio);
      }
    };

    const publishMode = () => {
      const mode = modalRadio?.checked ? 'modal' : 'studioMini';
      window.dispatchEvent(new CustomEvent('jms:globalPreviewModeChanged', { detail: { mode } }));
    };

    const onPreferChange = () => {
      if (!modalRadio?.checked || !preferCb || !onlyCb) return;

      if (preferCb.checked) {
        if (onlyCb.checked) onlyCb.checked = false;
      }
    };

    const onOnlyChange = () => {
      if (!modalRadio?.checked || !preferCb || !onlyCb) return;

      if (onlyCb.checked) {
        if (preferCb.checked) preferCb.checked = false;
      }
    };

    updateByMode();
    publishMode();

    modalRadio?.addEventListener('change', () => { updateByMode(); publishMode(); });
    studioRadio?.addEventListener('change', () => { updateByMode(); publishMode(); });
    preferCb?.addEventListener('change', onPreferChange);
    onlyCb?.addEventListener('change', onOnlyChange);
  }, 100);

  return panel;
}
