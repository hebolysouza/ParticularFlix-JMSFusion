import { applySettings } from "./applySettings.js";
import { getActivePositionProfile, readProfilePositions, POSITION_KEYS } from "../positionProfiles.js";
import { TUNING_FIELDS, readTuning, saveTuning, applyLayoutTuning, isFlowProfile, revertTuningWhenSettingsCloses, setLivePreview } from "../layoutTuning.js";
import { startDragEditor } from "../dragEditor.js";
import {
  markPositionEditing,
  writeAnchorRelease,
  applyProviderBackgroundMode,
  isFlowLayoutActive,
  ensurePositionHelperStyles
} from "../positionUtils.js";

/*
 * Tela de Posicoes (fork ParticularFlix).
 * - Cada bloco mostra o que ele e (descricao) e cada campo diz o que muda (cima/baixo, esquerda/direita...).
 * - A pre-visualizacao ao vivo agrupa as alteracoes em um unico quadro de animacao (antes cada tique de
 *   valor escrevia estilo em todos os slides na hora) e pausa as medicoes do cabecalho durante a edicao.
 * - O editor flutuante nao usa mais display:none na janela principal (isso recalculava o layout da janela
 *   inteira a cada abertura e fechamento); ela fica apenas invisivel.
 * - Provider: o fundo da caixa agora e uma opcao propria, e os icones dentro da caixa tem posicao propria.
 */

const PENDING = new Map();
let flushRaf = 0;

export function createPositionEditor(config, labels, section) {
  const L = (key, fallback) => (config.languageLabels && config.languageLabels[key]) || fallback;

  function withPositionUnit(labelText, unit) {
    const label = String(labelText || '').trim();
    if (!label) return '';
    if (/\([^)]*\)/.test(label)) {
      return label.replace(/\([^)]*\)/, `(${unit})`);
    }
    return `${label} (${unit})`;
  }

  /* ---------- textos: o que cada campo muda ---------- */

  const PROP_TEXT = {
    top: {
      label: () => L('posTopLabel', 'Vertical (Top, %)'),
      hint: () => L('posTopHint', 'Positive moves down, negative moves up. Empty or 0 = default position.')
    },
    left: {
      label: () => L('posLeftLabel', 'Horizontal (Left, %)'),
      hint: () => L('posLeftHint', 'Positive moves right, negative moves left. Empty or 0 = default position.')
    },
    width: {
      label: () => L('posWidthLabel', 'Width (%)'),
      hint: () => L('posWidthHint', 'Block width relative to the slider. Empty or 0 = automatic.')
    },
    height: {
      label: () => L('posHeightLabel', 'Height (%)'),
      hint: () => L('posHeightHint', 'Block height relative to the slider. Empty or 0 = automatic.')
    }
  };

  const BLOCK_DESC = {
    homeSections: () => L('posDescHomeSections', 'Home rows below the slider (Continue Watching, new releases...). Moves all of that content up or down.'),
    slide: () => L('posDescSlide', 'The whole slider (the big card with the trailer). Moves and resizes the entire panel.'),
    logo: () => L('posDescLogo', 'The logo (title image) of the movie or series.'),
    meta: () => L('posDescMeta', 'The middle badge row: watched, runtime, rating, match %, age rating and audio/languages. It groups the Status, Rating and Languages blocks, so moving it here moves them all together.'),
    format: () => L('posDescFormat', 'The top badges: type (MOVIE/SERIES) and quality (FHD, SDR, AVC...).'),
    status: () => L('posDescStatus', 'Only the "Watched, runtime and end time" part inside the badge row.'),
    rating: () => L('posDescRating', 'Only the ratings part: match %, community rating, Rotten Tomatoes and age rating.'),
    plot: () => L('posDescPlot', 'The plot summary text.'),
    title: () => L('posDescTitle', 'The title as text. In the Cinema and Mosaic layouts it is hidden when the item has a logo.'),
    director: () => L('posDescDirector', 'The "Director: ..." line (and writer, if enabled). In the Cinema and Mosaic layouts it sits right below the plot.'),
    info: () => L('posDescInfo', 'The genre, year and country line.'),
    button: () => L('posDescButton', 'The Play, Details, Mark as watched and Favorite buttons.'),
    existingDot: () => L('posDescDot', 'The slider navigation (dots or thumbnails).'),
    provider: () => L('posDescProvider', 'The icon box (settings gear, IMDb, TMDb, YouTube, Cast). Changing it moves the whole box, including its dark background.'),
    providericons: () => L('posDescProviderIcons', 'Only the icons inside the box, without moving the background. To remove the background, use the "Box background" option in the Provider block.'),
    sliderWrapper: () => L('posDescSliderWrapper', 'Advanced slider container. In most cases you do not need to change it.'),
    progressSeconds: () => L('posDescProgressSeconds', 'The seconds counter of the slide progress bar.'),
    progress: () => L('posDescProgress', 'The slide progress bar.')
  };

  function appendHeader(text, descKey) {
    const header = document.createElement('h3');
    header.textContent = text;
    section.appendChild(header);
    const descFn = BLOCK_DESC[descKey];
    if (descFn) {
      const p = document.createElement('p');
      p.className = 'position-block-desc';
      p.textContent = descFn();
      section.appendChild(p);
    }
  }

  /* ---------- aplicacao ao vivo (em lote, um quadro por vez) ---------- */

  function writeStyleValue(el, cssProperty, value, important = false) {
    if (!el) return;

    if (value === '') {
      if (el.style.getPropertyValue(cssProperty) !== '') el.style.removeProperty(cssProperty);
      return;
    }

    const priority = important ? 'important' : '';
    if (el.style.getPropertyValue(cssProperty) === value && el.style.getPropertyPriority(cssProperty) === priority) return;
    el.style.setProperty(cssProperty, value, priority);
  }

  let refreshActiveStatus = null;

  function selectorFor(containerType) {
    if (!containerType) return '#monwui-slides-container';
    return containerType === 'button' ? '.monwui-main-button-container'
      : containerType === 'slider' ? '.monwui-slider-wrapper:not(.monwui-artist-menu)'
      : containerType === 'existingDot' ? '.monwui-dot-navigation-container'
      : containerType === 'progress' ? '.monwui-slide-progress-bar'
      : containerType === 'progressSeconds' ? '.monwui-slide-progress-seconds'
      : `.monwui-${containerType}-container`;
  }

  function applyContainerStyleNow(target, containerType, cssProperty, newValue) {
    // 0 equivale a "padrao" depois de salvo (o salvamento converte 0 em vazio); a previa faz o mesmo
    const numeric = Number(newValue);
    const effective = (newValue === '' || !Number.isFinite(numeric) || numeric === 0) ? '' : newValue;

    if (target === 'homeSections') {
      const elements = [
        document.querySelector(".homeSectionsContainer"),
        document.querySelector("#favoritesTab")
      ];
      elements.forEach(el => {
        writeStyleValue(el, cssProperty, effective === '' ? '' : `${effective}vh`);
      });
      return;
    }

    const flowLayout = isFlowLayoutActive();
    const isMainSlideTop = !containerType && target === 'slides' && cssProperty === 'top';
    const unit = isMainSlideTop ? 'vh' : '%';
    const important = isMainSlideTop || flowLayout;

    document.querySelectorAll(selectorFor(containerType)).forEach(el => {
      writeStyleValue(el, cssProperty, effective === '' ? '' : `${effective}${unit}`, important);
      if (containerType && (cssProperty === 'top' || cssProperty === 'left')) {
        writeAnchorRelease(el, cssProperty, effective !== '');
      }
    });
  }

  function flushPending() {
    flushRaf = 0;
    const jobs = [...PENDING.values()];
    PENDING.clear();
    for (const job of jobs) {
      try { applyContainerStyleNow(job.target, job.containerType, job.cssProperty, job.value); } catch {}
    }
    try { if (refreshActiveStatus) refreshActiveStatus(); } catch {}
  }

  function updateContainerStyle(target, containerType, cssProperty, newValue) {
    markPositionEditing();
    PENDING.set(`${target}|${containerType}|${cssProperty}`, { target, containerType, cssProperty, value: newValue });
    if (!flushRaf) flushRaf = requestAnimationFrame(flushPending);
  }

  function updateFlexStyle(containerType, flexProperty, newValue) {
    const selector = selectorFor(containerType);
    markPositionEditing();

    document.querySelectorAll(selector).forEach(el => {
      if (flexProperty.includes('Display')) {
        el.style.display = newValue || '';
      } else {
        let camel = flexProperty.charAt(0).toLowerCase() + flexProperty.slice(1);
        const cssProp = camel.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
        el.style[cssProp] = newValue || '';
      }
    });
  }

  /* ---------- janela principal escondida sem recalcular layout ---------- */

  function hideMainModal() {
    const mainModal = document.getElementById('settings-modal');
    if (!mainModal) return null;
    mainModal.style.visibility = 'hidden';
    mainModal.style.pointerEvents = 'none';
    return mainModal;
  }

  function showMainModal(mainModal) {
    if (!mainModal) return;
    mainModal.style.visibility = '';
    mainModal.style.pointerEvents = '';
  }

  /* ---------- campos ---------- */

  function createSettingItem(labelText, configKey, cssProperty, placeholder, target = 'slides', containerType = '', blockLabel = '') {
    const container = document.createElement('div');
    container.className = 'position-item';

    const inputId = `input-${configKey}`;
    const propText = PROP_TEXT[cssProperty];

    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = inputId;
    if (propText) label.title = propText.hint();

    const input = document.createElement('input');
    input.type = 'number';
    input.name = configKey;
    input.id = inputId;
    input.value = config[configKey] || '';
    input.placeholder = placeholder || L('placeholderText', 'Digite um valor');
    input.dataset.cssProperty = cssProperty;
    input.dataset.target = target;
    input.dataset.containerType = containerType;
    if (propText) input.title = propText.hint();

    const allowsNegative = ['top', 'left'].includes(cssProperty);
    const isProgressHeight = configKey === 'progressBarHeight';

    if (!allowsNegative) {
      input.min = 0;
    }
    if (isProgressHeight) {
      input.min = 0.1;
      input.max = 10;
      input.step = 0.1;
    }

    const resetBtn = document.createElement('button');
    resetBtn.textContent = L('resetButton', 'Padrão');
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListener('click', () => {
      input.value = '';
      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    input.addEventListener('click', function(e) {
      e.stopPropagation();
      openPositionModal(this, configKey, cssProperty, placeholder, target, containerType, blockLabel, labelText);
    });

    input.addEventListener('input', function() {
      let value = parseFloat(this.value);
      if (!allowsNegative && value < 0) {
        value = 0;
      }
      if (isProgressHeight) {
        if (value < 0.1) value = 0.1;
        if (value > 10) value = 10;
      }
      const newValue = isNaN(value) ? '' : value;
      if (String(newValue) !== this.value) this.value = newValue;
      config[configKey] = newValue;
      updateContainerStyle(target, containerType, cssProperty, newValue);
    });

    container.append(label, input, resetBtn);
    return container;
  }

  function createGlobalResetButton() {
    const container = document.createElement('div');
    container.className = 'global-reset-container';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = L('resetAllButton', 'Restaurar todas as posições');
    resetBtn.type = 'button';
    resetBtn.className = 'global-reset-button';
    resetBtn.addEventListener('click', resetAllSettings);

    container.appendChild(resetBtn);
    return container;
  }

  function resetAllSettings() {
    document.querySelectorAll('.position-item input').forEach(input => {
      input.value = '';
      const configKey = input.name;
      const cssProperty = input.dataset.cssProperty || '';
      const target = input.dataset.target || 'slides';
      const containerType = input.dataset.containerType || '';

      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
    });

    document.querySelectorAll('.flex-item select:not([data-special])').forEach(select => {
      select.value = '';
      const configKey = select.name;
      const containerType = select.dataset.containerType || '';

      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), '');
    });

    const bgSelect = section.querySelector('select[name="providerBoxBackground"]');
    if (bgSelect) {
      bgSelect.value = '';
      config.providerBoxBackground = '';
      applyProviderBackgroundMode('');
    }

    if (config.homeSectionsTop !== undefined) {
      config.homeSectionsTop = '';
      updateContainerStyle('homeSections', '', 'top', '');
    }

    if (config.sliderContainerTop !== undefined) {
      config.sliderContainerTop = '';
      updateContainerStyle('slider', 'slider', 'top', '');
    }

    if (config.progressBarTop !== undefined) {
      config.progressBarTop = '';
      updateContainerStyle('progress', 'progress', 'top', '');
    }
  }


  /* ---------- editor flutuante: arrastavel, longe do item editado, com o item contornado ---------- */

  function targetSelector(containerType, target) {
    if (target === 'homeSections') return '.homeSectionsContainer';
    return selectorFor(containerType);
  }

  function describeTarget(selector) {
    const all = Array.from(document.querySelectorAll(selector));
    const el = all.find((n) => n.closest('.monwui-slide.active')) || all[0];
    if (!el) return 'missing';
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || r.width < 2 || r.height < 2) return 'hidden';
    const inside = r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
    return inside ? 'visible' : 'offscreen';
  }

  function setupFloatingEditor(modal, content, handle, containerType, target) {
    ensurePositionHelperStyles();
    const tuningMode = containerType === '__tuning__';
    const selector = tuningMode ? '.monwui-slide.active' : targetSelector(containerType, target);
    const imp = (el, prop, val) => el.style.setProperty(prop, val, 'important');

    // a camada cheia some: a tela de trás continua visível e clicável
    [['position', 'fixed'], ['inset', 'auto'], ['top', '0'], ['left', '0'], ['width', '0'], ['height', '0'],
      ['padding', '0'], ['background', 'none'], ['pointer-events', 'none'], ['display', 'block']].forEach(([k, v]) => imp(modal, k, v));

    [['position', 'fixed'], ['transform', 'none'], ['margin', '0'], ['pointer-events', 'auto'], ['z-index', '2147483000'],
      ['width', 'min(340px, calc(100vw - 24px))'], ['max-width', 'calc(100vw - 24px)'], ['padding', '14px'],
      ['gap', '10px'], ['border-radius', '16px'], ['opacity', '0.97']].forEach(([k, v]) => imp(content, k, v));

    // botao de fechar: canto superior direito, sem sobrepor titulo nem campos
    const closeEl = content.querySelector('.position-close');
    if (closeEl) {
      [['position', 'absolute'], ['top', '10px'], ['right', '10px'], ['left', 'auto'], ['bottom', 'auto'], ['width', '30px'], ['height', '30px'],
        ['margin', '0'], ['padding', '0'], ['display', 'flex'], ['align-items', 'center'], ['justify-content', 'center'], ['float', 'none'],
        ['transform', 'none'], ['border-radius', '50%'], ['background', 'rgba(255,255,255,.1)'], ['font-size', '20px'], ['line-height', '1'], ['z-index', '3']].forEach(([k, v]) => imp(closeEl, k, v));
    }
    handle.style.paddingRight = '40px';

    const marked = tuningMode ? [] : Array.from(document.querySelectorAll(selector));
    marked.forEach((el) => el.classList.add('jms-pos-target'));

    const status = document.createElement('p');
    status.className = 'position-modal-status';
    if (!tuningMode) content.appendChild(status);

    const statusText = {
      visible: L('posStatusVisible', 'Item visible on screen (outlined in yellow).'),
      hidden: L('posStatusHidden', 'The item exists but is hidden or has no size on this slide (for example this title has no data for it).'),
      offscreen: L('posStatusOffscreen', 'The item is outside the visible area. Press Default to bring it back.'),
      missing: L('posStatusMissing', 'This item does not exist on the current slide.')
    };
    refreshActiveStatus = () => {
      const state = describeTarget(selector);
      status.textContent = statusText[state];
      status.dataset.state = state;
    };
    refreshActiveStatus();
    const timer = setInterval(() => { if (refreshActiveStatus) refreshActiveStatus(); }, 700);

    // posição inicial: do lado oposto ao do item, para nunca ficar por cima dele
    const place = () => {
      const w = content.offsetWidth || 340;
      const h = content.offsetHeight || 190;
      const first = Array.from(document.querySelectorAll(selector)).find((n) => n.closest('.monwui-slide.active')) || document.querySelector(selector);
      const r = first ? first.getBoundingClientRect() : null;
      const cx = r && r.width ? r.left + r.width / 2 : window.innerWidth / 2;
      const cy = r && r.height ? r.top + r.height / 2 : window.innerHeight / 2;
      // ajustes globais: a caixinha vai para o canto direito de cima, longe do texto (que fica a esquerda e embaixo)
      const left = tuningMode ? window.innerWidth - w - 16 : (cx > window.innerWidth / 2 ? 16 : window.innerWidth - w - 16);
      const top = tuningMode ? 84 : (cy > window.innerHeight / 2 ? 72 : window.innerHeight - h - 16);
      imp(content, 'left', `${Math.max(8, left)}px`);
      imp(content, 'top', `${Math.max(8, top)}px`);
    };
    place();

    // arrastar pelo título
    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';
    handle.style.touchAction = 'none';
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const w = content.offsetWidth;
      const h = content.offsetHeight;
      const x = Math.min(Math.max(4, e.clientX - drag.dx), window.innerWidth - w - 4);
      const y = Math.min(Math.max(4, e.clientY - drag.dy), window.innerHeight - h - 4);
      imp(content, 'left', `${x}px`);
      imp(content, 'top', `${y}px`);
    };
    const onUp = () => { drag = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    handle.addEventListener('pointerdown', (e) => {
      const rect = content.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });

    return {
      dispose() {
        clearInterval(timer);
        refreshActiveStatus = null;
        onUp();
        document.querySelectorAll('.jms-pos-target').forEach((el) => el.classList.remove('jms-pos-target'));
      }
    };
  }

  function openPositionModal(inputElement, configKey, cssProperty, placeholder, target, containerType, blockLabel, fieldLabelText) {
    if (document.querySelector('.position-modal')) return null;
    const mainModal = hideMainModal();

    const modal = document.createElement('div');
    modal.className = 'position-modal';
    modal.style.display = 'block';

    const modalContent = document.createElement('div');
    modalContent.className = 'position-modal-content';

    let floating = null;
    const closeModal = () => {
      document.removeEventListener('keydown', onKey, true);
      if (floating) floating.dispose();
      modal.remove();
      showMainModal(mainModal);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener('keydown', onKey, true);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'position-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeModal;

    const title = document.createElement('h3');
    let sectionLabel = blockLabel;
    if (!sectionLabel) {
      sectionLabel = containerType === 'homeSections'
        ? L('homeSectionsPosition', '')
        : containerType
          ? config.languageLabels[`${containerType}Container`]
          : L('slidesPosition', '');
    }

    const fieldLabel = fieldLabelText
      || inputElement.previousElementSibling?.textContent
      || config.languageLabels[configKey]
      || configKey.replace(/([A-Z])/g, ' $1').trim();

    title.textContent = sectionLabel ? `${sectionLabel} — ${fieldLabel}` : fieldLabel;
    title.className = 'position-modal-title';

    const hint = document.createElement('p');
    hint.className = 'position-modal-desc';
    hint.textContent = PROP_TEXT[cssProperty]?.hint() || '';

    const inputContainer = document.createElement('div');
    inputContainer.className = 'position-modal-input-container';

    const modalInput = document.createElement('input');
    modalInput.type = 'number';
    modalInput.value = inputElement.value;
    modalInput.placeholder = placeholder || L('placeholderText', 'Digite um valor');
    modalInput.className = 'position-modal-input';

    const isProgressHeight = configKey === 'progressBarHeight';
    const allowsNegative = ['top', 'left'].includes(cssProperty);
    if (isProgressHeight) {
      modalInput.min = 0.1;
      modalInput.max = 10;
      modalInput.step = 0.1;
    } else if (!allowsNegative) {
      modalInput.min = 0;
    }

    inputContainer.append(modalInput);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'position-modal-apply';
    doneBtn.textContent = L('posDoneButton', 'Done');
    doneBtn.onclick = closeModal;

    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'reset-button';
    defaultBtn.textContent = L('resetButton', 'Padrão');
    defaultBtn.onclick = () => {
      modalInput.value = '';
      inputElement.value = '';
      config[configKey] = '';
      updateContainerStyle(target, containerType, cssProperty, '');
      modalInput.focus();
    };
    inputContainer.append(defaultBtn, doneBtn);

    if (configKey === 'homeSectionsTop') {
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'position-modal-apply';
      applyBtn.textContent = L('applyButton', 'Aplicar');
      applyBtn.onclick = () => {
        if (typeof applySettings === 'function') {
          applySettings(false);
        }
      };
      inputContainer.append(applyBtn);
    }

    modalInput.addEventListener('input', () => {
      let value = parseFloat(modalInput.value);
      if (isProgressHeight) {
        if (!isNaN(value)) {
          if (value < 0.1) value = 0.1;
          if (value > 10) value = 10;
          if (String(value) !== modalInput.value) modalInput.value = value;
        }
      } else if (!allowsNegative && value < 0) {
        value = 0;
        modalInput.value = value;
      }

      const next = isNaN(value) ? '' : value;
      inputElement.value = next;
      config[configKey] = next;
      updateContainerStyle(target, containerType, cssProperty, next);
    });

    modalContent.append(closeBtn, title, hint, inputContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    floating = setupFloatingEditor(modal, modalContent, title, containerType, target);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    setTimeout(() => {
      modalInput.focus();
      modalInput.select?.();
    }, 60);

    return modal;
  }

  function createFlexSettingItem(labelText, configKey, options, containerType) {
    const container = document.createElement('div');
    container.className = 'flex-item';

    const selectId = `select-${configKey}`;

    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = selectId;

    const select = document.createElement('select');
    select.name = configKey;
    select.id = selectId;
    select.dataset.containerType = containerType;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = L('selectDefault', 'Padrão');
    select.appendChild(emptyOption);

    options.forEach(option => {
      const optElement = document.createElement('option');
      optElement.value = option.value;
      optElement.textContent = option.label;
      if (config[configKey] === option.value) {
        optElement.selected = true;
      }
      select.appendChild(optElement);
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = L('resetButton', 'Padrão');
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListener('click', () => {
      select.value = '';
      config[configKey] = '';
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), '');
    });

    select.addEventListener('change', function() {
      config[configKey] = this.value;
      updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), this.value);
    });

    select.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openSelectModal(this, configKey, options, containerType);
    });

    container.append(label, select, resetBtn);
    return container;
  }

  function openSelectModal(selectElement, configKey, options, containerType) {
    if (document.querySelector('.position-modal')) return null;
    const mainModal = hideMainModal();

    const modal = document.createElement('div');
    modal.className = 'position-modal';
    modal.style.display = 'block';

    const modalContent = document.createElement('div');
    modalContent.className = 'position-modal-content';

    let floating = null;
    const closeModal = () => {
      if (floating) floating.dispose();
      modal.remove();
      showMainModal(mainModal);
    };

    const title = document.createElement('h3');
    const sectionLabel = containerType
      ? config.languageLabels[`${containerType}Container`]
      : L('slidesPosition', '');
    const fieldLabel = selectElement.previousElementSibling?.textContent
      || config.languageLabels[configKey]
      || configKey.replace(/([A-Z])/g, ' $1').trim();
    title.textContent = sectionLabel
      ? `${sectionLabel} — ${fieldLabel}`
      : fieldLabel;
    title.className = 'position-modal-title';
    modalContent.appendChild(title);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'position-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeModal;
    modalContent.appendChild(closeBtn);

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'position-modal-options';

    options.forEach(option => {
      const optionBtn = document.createElement('button');
      optionBtn.className = 'position-modal-option';
      if (selectElement.value === option.value) {
        optionBtn.classList.add('active');
      }
      optionBtn.textContent = option.label;
      optionBtn.onclick = () => {
        selectElement.value = option.value;
        config[configKey] = option.value;
        updateFlexStyle(containerType, configKey.replace(`${containerType}Container`, ''), option.value);
        optionsContainer.querySelectorAll('.position-modal-option').forEach(btn => btn.classList.remove('active'));
        optionBtn.classList.add('active');
      };
      optionsContainer.appendChild(optionBtn);
    });

    modalContent.appendChild(optionsContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    floating = setupFloatingEditor(modal, modalContent, title, containerType, 'slides');

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  /* Seletor simples (sem o editor flutuante) para opcoes especiais, como o fundo da caixa de provedores. */
  function createChoiceItem(labelText, configKey, options, onChange, hintText) {
    const container = document.createElement('div');
    container.className = 'flex-item position-choice';

    const selectId = `select-${configKey}`;
    const label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = selectId;
    if (hintText) label.title = hintText;

    const select = document.createElement('select');
    select.name = configKey;
    select.id = selectId;
    select.dataset.special = '1';
    options.forEach(option => {
      const optElement = document.createElement('option');
      optElement.value = option.value;
      optElement.textContent = option.label;
      if ((config[configKey] || '') === option.value) optElement.selected = true;
      select.appendChild(optElement);
    });
    select.addEventListener('change', function() {
      config[configKey] = this.value;
      onChange(this.value);
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = L('resetButton', 'Padrão');
    resetBtn.type = 'button';
    resetBtn.className = 'reset-button';
    resetBtn.addEventListener('click', () => {
      select.value = '';
      config[configKey] = '';
      onChange('');
    });

    container.append(label, select, resetBtn);
    return container;
  }

  /* ---------- montagem da tela ---------- */

  function appendFlexSettings(type) {
    section.appendChild(
      createFlexSettingItem(
        L('flexDisplay', 'Tipo de exibição'),
        `${type}ContainerDisplay`,
        [
          { value: 'flex', label: L('flex', 'Flex') },
          { value: 'inline-flex', label: L('inlineFlex', 'Inline Flex') },
        ],
        type
      )
    );

    section.appendChild(
      createFlexSettingItem(
        L('flexDirection', 'Direção dos itens'),
        `${type}ContainerFlexDirection`,
        [
          { value: 'row', label: L('row', 'Linha') },
          { value: 'column', label: L('column', 'Coluna') },
          { value: 'row-reverse', label: L('rowreverse', 'Linha invertida') },
          { value: 'column-reverse', label: L('columnreverse', 'Coluna invertida') }
        ],
        type
      )
    );

    section.appendChild(
      createFlexSettingItem(
        L('justifyContent', 'Alinhamento no eixo principal'),
        `${type}ContainerJustifyContent`,
        [
          { value: 'flex-start', label: L('flexstart', 'Início') },
          { value: 'flex-end', label: L('flexend', 'Fim') },
          { value: 'center', label: L('center', 'Centro') },
          { value: 'space-between', label: L('spacebetween', 'Espaço entre') },
          { value: 'space-around', label: L('spacearound', 'Espaço ao redor') },
          { value: 'space-evenly', label: L('spaceevenly', 'Espaço uniforme') }
        ],
        type
      )
    );

    section.appendChild(
      createFlexSettingItem(
        L('alignItems', 'Alinhamento no eixo cruzado'),
        `${type}ContainerAlignItems`,
        [
          { value: 'flex-start', label: L('flexstart', 'Início') },
          { value: 'flex-end', label: L('flexend', 'Fim') },
          { value: 'center', label: L('center', 'Centro') },
          { value: 'baseline', label: L('baseline', 'Linha de base') },
          { value: 'stretch', label: L('stretch', 'Esticar') }
        ],
        type
      )
    );

    section.appendChild(
      createFlexSettingItem(
        L('flexWrap', 'Quebra de linha'),
        `${type}ContainerFlexWrap`,
        [
          { value: 'nowrap', label: L('nowrap', 'Sem quebra') },
          { value: 'wrap', label: L('wrap', 'Quebrar') },
          { value: 'wrap-reverse', label: L('wrapreverse', 'Quebrar invertido') }
        ],
        type
      )
    );
  }

  function appendPositionFields(prefixKey, target, type, blockLabel, topUnitLabel) {
    const ph = L('placeholderText', 'Digite um valor');
    section.appendChild(createSettingItem(topUnitLabel || PROP_TEXT.top.label(), `${prefixKey}Top`, 'top', ph, target, type, blockLabel));
    section.appendChild(createSettingItem(PROP_TEXT.left.label(), `${prefixKey}Left`, 'left', ph, target, type, blockLabel));
    section.appendChild(createSettingItem(PROP_TEXT.width.label(), `${prefixKey}Width`, 'width', ph, target, type, blockLabel));
    section.appendChild(createSettingItem(PROP_TEXT.height.label(), `${prefixKey}Height`, 'height', ph, target, type, blockLabel));
  }

  /* ---------- ajustes globais do estilo (margens, largura do texto, sinopse) e copia entre estilos ---------- */

  const STYLE_NAMES = {
    classic: 'Normal / Peak / Compact', normal: 'Normal', peak: 'Peak', compact: 'Compact',
    cinema: 'Cinema', mosaic: L('mosaicName', 'Mosaico'), coverflow: 'Coverflow 3D'
  };

  function collectTuning() {
    const out = {};
    section.querySelectorAll('[data-jms-lay]').forEach((el) => { out[el.dataset.jmsLay] = el.value === '' ? '' : (el.tagName === 'SELECT' ? el.value : Number(el.value)); });
    return out;
  }

  function previewTuning() {
    revertTuningWhenSettingsCloses();
    const v = collectTuning();
    setLivePreview(v);
    applyLayoutTuning(v);
  }

  /* Caixinha flutuante para os ajustes globais: a janela de configuracoes some e a tela de tras fica visivel. */
  function openTuningModal(el, labelText, hintText) {
    if (document.querySelector('.position-modal')) return null;
    const mainModal = hideMainModal();
    const modal = document.createElement('div');
    modal.className = 'position-modal';
    modal.style.display = 'block';
    const content = document.createElement('div');
    content.className = 'position-modal-content';
    let floating = null;
    const closeModal = () => {
      document.removeEventListener('keydown', onKey, true);
      if (floating) floating.dispose();
      modal.remove();
      showMainModal(mainModal);
      if (!committed) el.value = orig;
      previewTuning();
    };
    const doSave = () => {
      const v = el.value === '' ? '' : (el.tagName === 'SELECT' ? el.value : Number(el.value));
      saveTuning(getActivePositionProfile(), { [name]: v });
      committed = true;
      previewTuning();
      setSaved(L('posSavedHere', 'Salvo neste estilo.'));
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSave(); closeModal(); }
    };
    document.addEventListener('keydown', onKey, true);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'position-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeModal;
    const title = document.createElement('h3');
    title.className = 'position-modal-title';
    title.textContent = labelText;
    const hint = document.createElement('p');
    hint.className = 'position-block-desc';
    hint.textContent = hintText || '';
    content.append(closeBtn, title, hint);

    const name = el.dataset.jmsLay;
    const f = TUNING_FIELDS[name] || {};
    const saved = document.createElement('p');
    saved.style.cssText = 'margin:0;font-size:12px;opacity:.85;display:none';
    const setSaved = (t) => { saved.textContent = t; saved.style.display = t ? 'block' : 'none'; };
    const orig = el.value;
    let committed = false;

    if (el.tagName === 'SELECT') {
      const box = document.createElement('div');
      box.className = 'position-modal-options';
      Array.from(el.options).forEach((opt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'position-modal-option';
        if (el.value === opt.value) b.classList.add('active');
        b.textContent = opt.textContent;
        b.onclick = () => {
          el.value = opt.value;
          box.querySelectorAll('.position-modal-option').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          previewTuning();
          committed = false;
          setSaved('');
        };
        box.appendChild(b);
      });
      content.appendChild(box);
    } else {
      const def = Number.isFinite(f.def) ? f.def : f.min;
      const row = document.createElement('div');
      row.className = 'position-modal-input-container';
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'position-modal-input';
      num.min = f.min; num.max = f.max; num.step = f.step;
      num.placeholder = `${def} (${L('posDefaultShort', 'padrão')})`;
      num.value = el.value;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = f.min; range.max = f.max; range.step = f.step;
      range.value = el.value === '' ? String(def) : el.value;
      range.style.cssText = 'width:100%;margin-top:8px';
      const push = (v) => { el.value = v; previewTuning(); committed = false; setSaved(''); };
      num.addEventListener('input', () => { if (num.value !== '') range.value = num.value; push(num.value); });
      range.addEventListener('input', () => { num.value = range.value; push(range.value); });
      const def2 = document.createElement('button');
      def2.type = 'button';
      def2.className = 'reset-button';
      def2.textContent = L('resetButton', 'Padrão');
      def2.style.marginTop = '8px';
      def2.onclick = () => { num.value = ''; range.value = String(def); push(''); };
      row.append(num, range, def2);
      content.appendChild(row);
      setTimeout(() => { num.focus(); num.select?.(); }, 60);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'position-modal-apply';
    saveBtn.textContent = L('posSaveHere', 'Salvar esta mudança');
    saveBtn.onclick = doSave;
    content.append(saveBtn, saved);
    modal.appendChild(content);
    document.body.appendChild(modal);
    floating = setupFloatingEditor(modal, content, title, '__tuning__', 'slides');
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    return modal;
  }

  function bindTuningEditor(el, labelText, hintText) {
    const open = (e) => { if (e) e.preventDefault(); el.blur(); openTuningModal(el, labelText, hintText); };
    if (el.tagName === 'SELECT') el.addEventListener('mousedown', open);
    else el.addEventListener('focus', () => open());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && el.tagName === 'SELECT') open(e); });
  }

  function createTuningNumber(name, labelText, hintText, stored) {
    const f = TUNING_FIELDS[name];
    const row = document.createElement('div');
    row.className = 'position-item';
    const label = document.createElement('label');
    label.textContent = labelText;
    label.title = hintText;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = `jmsLay:${name}`;
    input.id = `input-jmsLay-${name}`;
    input.dataset.jmsLay = name;
    input.min = f.min; input.max = f.max; input.step = f.step;
    input.value = stored[name] === '' ? '' : String(stored[name]);
    input.placeholder = Number.isFinite(f.def) ? `${f.def} (${L('posDefaultShort', 'padrão')})` : L('placeholderText', 'Digite um valor');
    input.title = hintText;
    label.htmlFor = input.id;
    input.addEventListener('input', previewTuning);
    bindTuningEditor(input, labelText, hintText);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset-button';
    reset.textContent = L('resetButton', 'Padrão');
    reset.addEventListener('click', () => { input.value = ''; previewTuning(); });
    const hint = document.createElement('p');
    hint.className = 'position-block-desc';
    hint.textContent = hintText;
    row.append(label, input, reset);
    section.append(row, hint);
    return input;
  }

  function appendStringSelect(name, labelText, hintText, options, stored) {
    const row = document.createElement('div');
    row.className = 'position-item';
    const label = document.createElement('label');
    label.textContent = labelText;
    const sel = document.createElement('select');
    sel.name = `jmsLay:${name}`;
    sel.id = `input-jmsLay-${name}`;
    sel.dataset.jmsLay = name;
    label.htmlFor = sel.id;
    options.forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (stored[name] === v) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', previewTuning);
    bindTuningEditor(sel, labelText, hintText);
    const hint = document.createElement('p');
    hint.className = 'position-block-desc';
    hint.textContent = hintText;
    row.append(label, sel);
    section.append(row, hint);
  }

  function appendTuningBlock() {
    const profile = getActivePositionProfile();
    const flow = isFlowProfile(profile);
    const stored = readTuning(profile);
    const h = document.createElement('h3');
    h.textContent = L('posTuneTitle', 'Ajustes globais do estilo');
    const d = document.createElement('p');
    d.className = 'position-block-desc';
    d.textContent = L('posTuneDesc', 'Estes ajustes mexem no estilo inteiro de uma vez, sem desalinhar os blocos entre si. Cada estilo (Normal, Peak, Compact, Cinema, Mosaico e Coverflow) guarda os seus. Vazio = padrão do estilo. Só valem depois de Salvar.');
    section.append(h, d);

    if (profile === 'cinema') {
      const lrow = document.createElement('div');
      lrow.className = 'position-item';
      const llabel = document.createElement('label');
      llabel.textContent = L('posLayoutMode', 'Disposição');
      const lsel = document.createElement('select');
      lsel.name = 'jmsLay:layout';
      lsel.id = 'input-jmsLay-layout';
      lsel.dataset.jmsLay = 'layout';
      llabel.htmlFor = lsel.id;
      [['', L('posLayoutStack', 'Pilha única (padrão)')], ['zones', L('posLayoutZones', 'Duas zonas (textos em cima, botões embaixo)')]].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if (stored.layout === v) o.selected = true;
        lsel.appendChild(o);
      });
      lsel.addEventListener('change', previewTuning);
      bindTuningEditor(lsel, L('posLayoutMode', 'Disposição'), L('posLayoutHint', ''));
      const lhint = document.createElement('p');
      lhint.className = 'position-block-desc';
      lhint.textContent = L('posLayoutHint', 'Pilha única: todos os blocos empilhados na parte de baixo. Duas zonas: logo, título, sinopse (com a barra de progresso do filme) e diretor em cima; selos no meio; botões e gênero centralizados embaixo. Se você já tinha deslocamentos manuais no Cinema, use "Redefinir tudo" ao trocar para Duas zonas.');
      lrow.append(llabel, lsel);
      section.append(lrow, lhint);
    }

    if (flow) {
      createTuningNumber('padX', L('posTunePadX', 'Margem lateral (px)'), L('posTunePadXHint', 'Distância entre a coluna de texto e a borda do slide. Também afasta da borda os selos do topo, a caixa de ícones e a navegação.'), stored);
      createTuningNumber('padB', L('posTunePadB', 'Margem inferior (%)'), L('posTunePadBHint', 'Distância entre o último bloco (botões e gênero) e a borda de baixo do slide.'), stored);
      createTuningNumber('textW', L('posTuneTextW', 'Largura do texto (vw)'), L('posTuneTextWHint', 'Largura máxima da coluna de texto (logo, selos, sinopse). Valores menores deixam a sinopse mais estreita.'), stored);
      createTuningNumber('gap', L('posTuneGap', 'Espaço entre blocos (px)'), L('posTuneGapHint', 'Espaço vertical entre logo, selos, sinopse, botões e gênero.'), stored);
      createTuningNumber('fmtTop', L('posTuneFmtTop', 'Selos do topo: distância do topo (px)'), L('posTuneFmtTopHint', 'Posição vertical dos selos de Filme/Série e qualidade. Aumente para descer, diminua para subir. Vazio = padrão do estilo.'), stored);
      createTuningNumber('fmtLeft', L('posTuneFmtLeft', 'Selos do topo: distância da esquerda (px)'), L('posTuneFmtLeftHint', 'Posição horizontal dos selos. Vazio = acompanha a margem lateral.'), stored);
      appendStringSelect('align', L('posAlignBtn', 'Botões (Assistir, Trailer...): alinhamento'), L('posAlignBtnHint', 'Alinha só a linha de botões. Centralizado embaixo deixa os botões centralizados e colados na parte de baixo da tela, como na produção.'), [['', L('posAlignDefault', 'Padrão do estilo')], ['left', L('posAlignLeft', 'Esquerda')], ['center', L('posAlignCenter', 'Centralizado')], ['bottom', L('posAlignBottom', 'Centralizado embaixo')], ['right', L('posAlignRight', 'Direita')]], stored);
      createTuningNumber('btnX', L('posBtnX', 'Botões: mover na horizontal (px)'), L('posBtnXHint', 'Positivo move para a direita, negativo para a esquerda. Independente do resto.'), stored);
      createTuningNumber('btnY', L('posBtnY', 'Botões: mover na vertical (px)'), L('posBtnYHint', 'Positivo move para baixo, negativo para cima. Independente do resto.'), stored);
      appendStringSelect('alignInfo', L('posAlignInfo', 'Gênero, ano e país: alinhamento'), L('posAlignInfoHint', 'Alinha só a linha de gênero, ano e país. Não mexe nos botões.'), [['', L('posAlignDefault', 'Padrão do estilo')], ['left', L('posAlignLeft', 'Esquerda')], ['center', L('posAlignCenter', 'Centralizado')], ['right', L('posAlignRight', 'Direita')]], stored);
      createTuningNumber('infoX', L('posInfoX', 'Gênero, ano e país: mover na horizontal (px)'), L('posInfoXHint', 'Positivo move para a direita, negativo para a esquerda. Independente dos botões.'), stored);
      createTuningNumber('infoY', L('posInfoY', 'Gênero, ano e país: mover na vertical (px)'), L('posInfoYHint', 'Positivo move para baixo, negativo para cima. Independente dos botões.'), stored);
      appendStringSelect('corners', L('posCorners', 'Cantos arredondados do slider'), L('posCornersHint', 'Padrão: os 4 cantos arredondados. Os cantos cortam o que estiver fora da moldura, então tire o arredondamento se for mover selos para as bordas.'), [['', L('posCornersDefault', 'Padrão (4 cantos)')], ['left', L('posCornersLeft', 'Sem arredondar à esquerda')], ['right', L('posCornersRight', 'Sem arredondar à direita')], ['top', L('posCornersTop', 'Sem arredondar em cima')], ['none', L('posCornersNone', 'Nenhum canto arredondado')]], stored);
      const dragRow = document.createElement('div');
      dragRow.className = 'position-item';
      const dragBtn = document.createElement('button');
      dragBtn.type = 'button';
      dragBtn.className = 'position-modal-apply';
      dragBtn.textContent = L('posDragButton', 'Arrastar elementos na tela');
      dragBtn.addEventListener('click', () => startDragEditor({
        labels: L,
        hideMain: hideMainModal,
        showMain: showMainModal,
        onSaved: () => {
          const st = readTuning(getActivePositionProfile());
          section.querySelectorAll('[data-jms-lay]').forEach((el) => { if (el.tagName !== 'SELECT' && st[el.dataset.jmsLay] !== undefined) el.value = st[el.dataset.jmsLay] === '' ? '' : String(st[el.dataset.jmsLay]); });
          previewTuning();
        }
      }));
      const dragHint = document.createElement('p');
      dragHint.className = 'position-block-desc';
      dragHint.textContent = L('posDragHint', 'Arraste selos, logo, informações, sinopse, diretor, botões e a linha de gênero direto na tela. Linhas-guia mostram o alinhamento com o centro, as margens e os outros blocos. Segure Alt para soltar sem imã.');
      dragRow.append(dragBtn);
      section.append(dragRow, dragHint);
      if (profile === 'cinema') createTuningNumber('zoneGap', L('posTuneZoneGap', 'Espaço entre a sinopse e os selos (vh), só em Duas zonas'), L('posTuneZoneGapHint', 'Distância entre o último bloco de texto (sinopse, barra de progresso, diretor) e a linha de selos. Vazio = automático.'), stored);
    }

    const row = document.createElement('div');
    row.className = 'position-item';
    const label = document.createElement('label');
    label.textContent = L('posTunePlot', 'Sinopse');
    const select = document.createElement('select');
    select.name = 'jmsLay:plot';
    select.id = 'input-jmsLay-plot';
    select.dataset.jmsLay = 'plot';
    label.htmlFor = select.id;
    const opts = [['', L('posPlotDefault', 'Padrão do estilo')], ['hidden', L('posPlotHidden', 'Ocultar totalmente')]];
    if (flow) opts.push(['l2', L('posPlotL2', 'Até 2 linhas')], ['l3', L('posPlotL3', 'Até 3 linhas')], ['l4', L('posPlotL4', 'Até 4 linhas')], ['full', L('posPlotFull', 'Completa (sem cortar)')]);
    opts.forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (stored.plot === v) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', previewTuning);
    bindTuningEditor(select, label.textContent, '');
    const hint = document.createElement('p');
    hint.className = 'position-block-desc';
    hint.textContent = flow
      ? L('posPlotHintFlow', 'Mostra a sinopse cortada em até N linhas, completa, ou a esconde por inteiro (o espaço dela some e os outros blocos sobem).')
      : L('posPlotHintClassic', 'Esconde a sinopse por inteiro neste estilo. Os demais blocos não se mexem.');
    row.append(label, select);
    section.append(row, hint);
  }

  function appendCopyBlock() {
    const current = getActivePositionProfile();
    const h = document.createElement('h3');
    h.textContent = L('posCopyTitle', 'Copiar de outro estilo');
    const d = document.createElement('p');
    d.className = 'position-block-desc';
    d.textContent = L('posCopyDesc', 'Preenche os campos desta tela com as posições e ajustes salvos de outro estilo (a prévia muda na hora). Só fica gravado depois de Salvar.');
    const row = document.createElement('div');
    row.className = 'position-item';
    const select = document.createElement('select');
    select.id = 'jms-copy-from';
    ['normal', 'peak', 'compact', 'cinema', 'mosaic', 'coverflow'].forEach((id) => {
      if (id === current) return;
      const o = document.createElement('option');
      o.value = id; o.textContent = STYLE_NAMES[id];
      select.appendChild(o);
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reset-button';
    btn.textContent = L('posCopyButton', 'Copiar');
    btn.addEventListener('click', () => {
      const src = select.value;
      const positions = readProfilePositions(src);
      const keys = new Set(POSITION_KEYS);
      section.querySelectorAll('input[name], select[name]').forEach((el) => {
        if (!keys.has(el.name) || el.dataset.special) return;
        const v = positions[el.name] === undefined ? '' : String(positions[el.name]);
        if (el.value === v) return;
        el.value = v;
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
      const t = readTuning(src);
      section.querySelectorAll('[data-jms-lay]').forEach((el) => {
        const v = t[el.dataset.jmsLay];
        const next = v === undefined || v === '' ? '' : String(v);
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === next)) return;
        el.value = next;
      });
      previewTuning();
    });
    row.append(select, btn);
    section.append(h, d, row);
  }

  function render() {
    section.appendChild(createGlobalResetButton());

    const profileNames = STYLE_NAMES;
    const profileNote = document.createElement('h5');
    profileNote.className = 'position-profile-note';
    const noteTpl = L('positionProfileNote',
      'Perfil de posição ativo: {profile}. Cada layout do slider guarda as próprias posições. No Cinema e no Mosaico, Topo e Esquerda deslocam o bloco a partir do lugar padrão do layout (vazio = padrão).');
    profileNote.textContent = noteTpl.replace('{profile}', profileNames[getActivePositionProfile()] || getActivePositionProfile());
    section.appendChild(profileNote);

    const howTo = document.createElement('p');
    howTo.className = 'position-block-desc';
    howTo.textContent = L('posHowTo', 'How to use: click a field to open the quick editor and see the slider change live. Values only stick after you Save. The Default button returns a field to its original value.');
    section.appendChild(howTo);

    appendTuningBlock();
    appendCopyBlock();

    appendHeader(L('homeSectionsPosition', 'Posição das fileiras da home'), 'homeSections');
    section.appendChild(
      createSettingItem(
        L('posHomeTopLabel', 'Vertical (vh): positive moves down, negative moves up'),
        'homeSectionsTop',
        'top',
        L('placeholderText', 'Digite um valor'),
        'homeSections',
        '',
        L('homeSectionsPosition', 'Fileiras da home')
      )
    );

    appendHeader(L('slidesPosition', 'Posição do slider'), 'slide');
    appendPositionFields('slide', 'slides', '', L('slidesPosition', 'Slider'), withPositionUnit(PROP_TEXT.top.label(), 'vh'));

    const containers = [
      { type: 'logo', label: L('logoContainer', 'Logo'), flexSettings: false, positionSettings: true },
      { type: 'format', label: L('formatContainer', 'Format badges (type and quality)'), flexSettings: true, positionSettings: true },
      { type: 'meta', label: L('metaContainer', 'Linha de selos (meta)'), flexSettings: true, positionSettings: true },
      { type: 'status', label: L('statusContainer', 'Status (assistido, duração, término)'), flexSettings: true, positionSettings: true },
      { type: 'rating', label: L('ratingContainer', 'Avaliações e classificação'), flexSettings: true, positionSettings: true },
      { type: 'plot', label: L('plotContainer', 'Sinopse'), flexSettings: true, positionSettings: true },
      { type: 'title', label: L('titleContainer', 'Título em texto'), flexSettings: true, positionSettings: true },
      { type: 'director', label: L('directorContainer', 'Diretor'), flexSettings: true, positionSettings: true },
      { type: 'info', label: L('infoContainer', 'Gênero, ano e país'), flexSettings: true, positionSettings: true },
      { type: 'button', label: L('buttonContainer', 'Botões (Play, Detalhes...)'), flexSettings: true, positionSettings: true },
      { type: 'existingDot', label: L('dotContainer', 'Navegação (bolinhas)'), flexSettings: true, positionSettings: true },
      { type: 'provider', label: L('providerContainer', 'Provider (caixa de ícones e engrenagem)'), flexSettings: true, positionSettings: true },
      { type: 'providericons', label: L('providericonsContainer', 'Ícones dentro da caixa do Provider'), flexSettings: true, positionSettings: true }
    ];

    containers.forEach(({ type, label, flexSettings, positionSettings }) => {
      appendHeader(label, type);

      if (type === 'provider') {
        section.appendChild(
          createChoiceItem(
            L('providerBgLabel', 'Box background'),
            'providerBoxBackground',
            [
              { value: '', label: L('providerBgDefault', 'Default (dark box)') },
              { value: 'none', label: L('providerBgNone', 'No background (icons only)') }
            ],
            (value) => applyProviderBackgroundMode(value),
            L('providerBgHint', 'Removes or keeps the dark background behind the gear and icons. The icons stay in the same place.')
          )
        );
      }

      if (positionSettings) {
        appendPositionFields(`${type}Container`, type, type, label);
      }

      if (flexSettings) {
        appendFlexSettings(type);
      }
    });

    appendHeader(L('posSliderWrapperTitle', 'Advanced slider container'), 'sliderWrapper');
    appendPositionFields('sliderContainer', 'slider', 'slider', L('posSliderWrapperTitle', 'Advanced slider container'));
    appendFlexSettings('slider');

    appendHeader(L('progressSecondsHeader', 'Contador de segundos'), 'progressSeconds');
    const ph = L('placeholderText', 'Digite um valor');
    section.appendChild(createSettingItem(PROP_TEXT.top.label(), 'progressSecondsTop', 'top', ph, 'progress', 'progressSeconds', L('progressSecondsHeader', 'Contador de segundos')));
    section.appendChild(createSettingItem(PROP_TEXT.left.label(), 'progressSecondsLeft', 'left', ph, 'progress', 'progressSeconds', L('progressSecondsHeader', 'Contador de segundos')));

    appendHeader(L('progressBarHeader', 'Barra de progresso'), 'progress');
    appendPositionFields('progressBar', 'progress', 'progress', L('progressBarHeader', 'Barra de progresso'));
    return section;
  }

  return {
    render,
    updateContainerStyle,
    updateFlexStyle
  };
}
