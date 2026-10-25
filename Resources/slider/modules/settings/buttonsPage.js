import { getConfig } from "../config.js";
import { createCheckbox, createSection, createImageTypeSelect, bindCheckboxKontrol } from "./shared.js";
import { applySettings } from "./applySettings.js";

export function createButtonsPanel(config, labels) {
    const panel = document.createElement('div');
    panel.id = 'buttons-panel';
    panel.className = 'settings-panel';

    const section = createSection(labels.buttons || 'Buton Ayarları');

    // Fork ParticularFlix: aparencia dos botoes de acao do slide (Assistir, Trailer, Assistido, Minha lista)
    const styleDiv = document.createElement('div');
    styleDiv.className = 'fsetting-item';
    const styleLabel = document.createElement('h3');
    styleLabel.textContent = labels.buttonStyle || 'Button style:';
    const styleSelect = document.createElement('select');
    styleSelect.name = 'buttonStyle';
    styleSelect.id = 'buttonStyleSelect';
    [
        { value: 'classic', label: labels.buttonStyleClassic || 'Original' },
        { value: 'pills', label: labels.buttonStylePills || 'Glass pills (icon and text)' },
        { value: 'orbs', label: labels.buttonStyleOrbs || 'Orbs (floating name)' }
    ].forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === (config.buttonStyle || 'classic')) opt.selected = true;
        styleSelect.appendChild(opt);
    });
    const styleDesc = document.createElement('p');
    styleDesc.className = 'description-text';
    styleDesc.textContent = labels.buttonStyleDesc || 'Look of the slide action buttons. Original: the plugin look (hover motion, photo background). Glass pills: frosted pills with icon and text always visible, Play in solid white. Round orbs: round glass icons that open into a pill with the text on hover, Play with a soft pulse. The two new looks ignore the button photo background, opacity and blur options below.';
    styleDiv.append(styleLabel, styleSelect, styleDesc);
    section.appendChild(styleDiv);

    const arrowDiv = document.createElement('div');
    arrowDiv.className = 'fsetting-item';
    const arrowLabel = document.createElement('h3');
    arrowLabel.textContent = labels.arrowStyle || 'Navigation arrow style:';
    const arrowSelect = document.createElement('select');
    arrowSelect.name = 'arrowStyle';
    arrowSelect.id = 'arrowStyleSelect';
    [
        { value: 'round', label: labels.arrowStyleRound || 'Round buttons (default)' },
        { value: 'bar', label: labels.arrowStyleBar || 'Translucent side bar (Netflix style)' }
    ].forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === (config.arrowStyle === 'bar' ? 'bar' : 'round')) opt.selected = true;
        arrowSelect.appendChild(opt);
    });
    const arrowDesc = document.createElement('p');
    arrowDesc.className = 'description-text';
    arrowDesc.textContent = labels.arrowStyleDesc || 'How you go to the previous or next slide.';
    arrowDiv.append(arrowLabel, arrowSelect, arrowDesc);
    section.appendChild(arrowDiv);

    const nextDiv = document.createElement('div');
    nextDiv.className = 'fsetting-item';
    const nextLabel = document.createElement('h3');
    nextLabel.textContent = labels.nextStyle || 'Next slide indicator:';
    const nextSelect = document.createElement('select');
    nextSelect.name = 'nextStyle';
    nextSelect.id = 'nextStyleSelect';
    [
        { value: 'card', label: labels.nextStyleCard || 'Up next card (default)' },
        { value: 'dots', label: labels.nextStyleDots || 'Modern dots' },
        { value: 'none', label: labels.nextStyleNone || 'Hidden' }
    ].forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === (['dots', 'none'].includes(config.nextStyle) ? config.nextStyle : 'card')) opt.selected = true;
        nextSelect.appendChild(opt);
    });
    const nextDesc = document.createElement('p');
    nextDesc.className = 'description-text';
    nextDesc.textContent = labels.nextStyleDesc || 'Shows what comes next.';
    nextDiv.append(nextLabel, nextSelect, nextDesc);
    section.appendChild(nextDiv);

    const dotsPrevDiv = document.createElement('div');
    dotsPrevDiv.className = 'fsetting-item';
    const dotsPrevLabel = document.createElement('h3');
    dotsPrevLabel.textContent = labels.dotsPreview || 'Image preview on the dots:';
    const dotsPrevSelect = document.createElement('select');
    dotsPrevSelect.name = 'dotsPreview';
    dotsPrevSelect.id = 'dotsPreviewSelect';
    [
        { value: 'on', label: labels.dotsPreviewOn || 'Show the image preview (default)' },
        { value: 'off', label: labels.dotsPreviewOff || 'Title only, no image' }
    ].forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === (config.dotsPreview === 'off' ? 'off' : 'on')) opt.selected = true;
        dotsPrevSelect.appendChild(opt);
    });
    const dotsPrevDesc = document.createElement('p');
    dotsPrevDesc.className = 'description-text';
    dotsPrevDesc.textContent = labels.dotsPreviewDesc || 'Hovering a dot shows the cover of that title, the same one used by the Up next card. Only applies to the Modern dots.';
    dotsPrevDiv.append(dotsPrevLabel, dotsPrevSelect, dotsPrevDesc);
    section.appendChild(dotsPrevDiv);

    const trailerButtonDiv = document.createElement('div');
    trailerButtonDiv.appendChild(createCheckbox('showTrailerButton', labels.showTrailerButton || 'Fragman Butonunu Göster', config.showTrailerButton));
    section.appendChild(trailerButtonDiv);

    const trailerBgDiv = document.createElement('div');
    trailerBgDiv.className = 'setting-item trailer-bg-container';
    const trailerBgLabel = document.createElement('label');
    trailerBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const trailerBgSelect = createImageTypeSelect('trailerBackgroundImageType', config.trailerBackgroundImageType || 'backdropUrl', true);
    trailerBgLabel.htmlFor = 'trailerBgSelect';
    trailerBgSelect.id = 'trailerBgSelect';
    trailerBgDiv.append(trailerBgLabel, trailerBgSelect);
    section.appendChild(trailerBgDiv);

    bindCheckboxKontrol('#showTrailerButton', '.trailer-bg-container', 0.6, [trailerBgSelect]);

    const watchButtonDiv = document.createElement('div');
    watchButtonDiv.appendChild(createCheckbox('showWatchButton', labels.showWatchButton || 'İzle Butonunu Göster', config.showWatchButton));
    section.appendChild(watchButtonDiv);

    const watchBgDiv = document.createElement('div');
    watchBgDiv.className = 'setting-item watch-bg-container';
    const watchBgLabel = document.createElement('label');
    watchBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const watchBgSelect = createImageTypeSelect('watchBackgroundImageType', config.watchBackgroundImageType || 'backdropUrl', true);
    watchBgLabel.htmlFor = 'watchBgSelect';
    watchBgSelect.id = 'watchBgSelect';
    watchBgDiv.append(watchBgLabel, watchBgSelect);
    section.appendChild(watchBgDiv);

    bindCheckboxKontrol('#showWatchButton', '.watch-bg-container', 0.6, [watchBgSelect]);

    const infoButtonDiv = document.createElement('div');
    infoButtonDiv.appendChild(createCheckbox('showInfoButton', labels.showInfoButton || 'Show details button (i)', config.showInfoButton !== false));
    section.appendChild(infoButtonDiv);

    const favoriteButtonDiv = document.createElement('div');
    favoriteButtonDiv.appendChild(createCheckbox('showFavoriteButton', labels.showFavoriteButton || 'Favori Butonunu Göster', config.showFavoriteButton));
    section.appendChild(favoriteButtonDiv);

    const favoriBgDiv = document.createElement('div');
    favoriBgDiv.className = 'setting-item favorite-bg-container';
    const favoriBgLabel = document.createElement('label');
    favoriBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const favoriBgSelect = createImageTypeSelect('favoriteBackgroundImageType', config.favoriteBackgroundImageType || 'backdropUrl', true);
    favoriBgLabel.htmlFor = 'favoriBgSelect';
    favoriBgSelect.id = 'favoriBgSelect';
    favoriBgDiv.append(favoriBgLabel, favoriBgSelect);
    section.appendChild(favoriBgDiv);

    bindCheckboxKontrol('#showFavoriteButton', '.favorite-bg-container', 0.6, [favoriBgSelect]);

    const playedButtonDiv = document.createElement('div');
    playedButtonDiv.appendChild(createCheckbox('showPlayedButton', labels.showPlayedButton || 'İzlenme Durumu Kontrol Butonunu Göster', config.showPlayedButton));
    section.appendChild(playedButtonDiv);

    const playedBgDiv = document.createElement('div');
    playedBgDiv.className = 'setting-item played-bg-container';
    const playedBgLabel = document.createElement('label');
    playedBgLabel.textContent = labels.buttonBackgroundImageType || 'Buton Arka Plan Görsel Türü:';
    const playedBgSelect = createImageTypeSelect('playedBackgroundImageType', config.playedBackgroundImageType || 'backdropUrl', true);
    playedBgLabel.htmlFor = 'playedBgSelect';
    playedBgSelect.id = 'playedBgSelect';
    playedBgDiv.append(playedBgLabel, playedBgSelect);
    section.appendChild(playedBgDiv);

    bindCheckboxKontrol('#showPlayedButton', '.played-bg-container', 0.6, [playedBgSelect]);

    const buttonOpacityDiv = document.createElement('div');
    buttonOpacityDiv.className = 'setting-item';
    const buttonOpacityLabel = document.createElement('label');
    buttonOpacityLabel.textContent = labels.backgroundOpacity || 'Buton Arka Plan Şeffaflığı:';
    const buttonOpacityInput = document.createElement('input');
    buttonOpacityInput.type = 'range';
    buttonOpacityInput.min = '0.3';
    buttonOpacityInput.max = '1';
    buttonOpacityInput.step = '0.1';
    buttonOpacityInput.name = 'buttonOpacity';
    buttonOpacityInput.id = 'buttonOpacity';
    buttonOpacityInput.value = config.buttonBackgroundOpacity ?? 0.5;
    buttonOpacityInput.name = 'buttonBackgroundOpacity';
    const buttonOpacityValue = document.createElement('span');
    buttonOpacityValue.className = 'range-value';
    buttonOpacityValue.textContent = buttonOpacityInput.value;
    buttonOpacityInput.addEventListener('input', () => {
        buttonOpacityValue.textContent = buttonOpacityInput.value;
    });
    buttonOpacityLabel.htmlFor = 'buttonOpacityInput';
    buttonOpacityInput.id = 'buttonOpacityInput';
    buttonOpacityDiv.append(buttonOpacityLabel, buttonOpacityInput, buttonOpacityValue);
    section.appendChild(buttonOpacityDiv);

    const buttonblurDiv = document.createElement('div');
    buttonblurDiv.className = 'setting-item';

    const buttonblurLabel = document.createElement('label');
    buttonblurLabel.textContent = labels.backgroundBlur || 'Arka plan bulanıklığı:';
    buttonblurLabel.htmlFor = 'buttonBackgroundBlur';

    const buttonblurInput = document.createElement('input');
    buttonblurInput.type = 'range';
    buttonblurInput.min = '0';
    buttonblurInput.max = '20';
    buttonblurInput.step = '1';
    buttonblurInput.value = config.buttonBackgroundBlur ?? 10;
    buttonblurInput.name = 'buttonBackgroundBlur';
    buttonblurInput.id = 'buttonBackgroundBlur';

    const buttonblurValue = document.createElement('span');
    buttonblurValue.className = 'range-value';
    buttonblurValue.textContent = buttonblurInput.value + 'px';

    buttonblurInput.addEventListener('input', () => {
    buttonblurValue.textContent = buttonblurInput.value + 'px';
    });

    buttonblurDiv.append(buttonblurLabel, buttonblurInput, buttonblurValue);
    section.appendChild(buttonblurDiv);

    panel.appendChild(section);
    return panel;
}
