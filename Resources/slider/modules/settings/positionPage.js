import { applySettings } from "./applySettings.js";
import { getActivePositionProfile } from "../positionProfiles.js";
import {
  markPositionEditing,
  writeAnchorRelease,
  applyProviderBackgroundMode,
  isFlowLayoutActive
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

  function openPositionModal(inputElement, configKey, cssProperty, placeholder, target, containerType, blockLabel, fieldLabelText) {
    if (document.querySelector('.position-modal')) return null;
    const mainModal = hideMainModal();

    const modal = document.createElement('div');
    modal.className = 'position-modal';
    modal.style.display = 'block';

    const modalContent = document.createElement('div');
    modalContent.className = 'position-modal-content';

    const closeModal = () => {
      document.removeEventListener('keydown', onKey, true);
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

    const closeModal = () => {
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

  function render() {
    section.appendChild(createGlobalResetButton());

    const profileNames = { classic: 'Normal / Peak / Compact', cinema: 'Cinema', mosaic: 'Mosaic', coverflow: 'Coverflow 3D' };
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
