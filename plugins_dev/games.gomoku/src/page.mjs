import css from './page.css';
import { mount as mountSettings } from './settings.mjs';
import { zh, en } from './page-strings.mjs';

export function mount(container, context) {
  if (!context.controls) throw new Error('plugin-host-upgrade-required');
  const t = context.language.startsWith('zh') ? zh : en;
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'gomoku-page';
  root.innerHTML = `
    <section class="intro" aria-label="">
      <ul></ul>
    </section>
    <section class="features" aria-labelledby="gomoku-features-title">
      <h2 id="gomoku-features-title"><span class="section-icon" data-icon="blocks"></span><span class="heading-label"></span><span class="section-count"></span></h2>
      <ul></ul>
    </section>
    <section class="settings" aria-labelledby="gomoku-settings-title">
      <h2 id="gomoku-settings-title"><span class="section-icon" data-icon="link"></span><span class="heading-label"></span></h2>
      <div class="settings-body"></div>
    </section>
    <section class="usage" aria-labelledby="gomoku-usage-title">
      <h2 id="gomoku-usage-title"><span class="section-icon" data-icon="message-square"></span><span class="heading-label"></span></h2>
      <p></p>
      <blockquote></blockquote>
    </section>`;
  container.replaceChildren(style, root);
  const query = (selector) => root.querySelector(selector);
  query('.intro').setAttribute('aria-label', t.introLabel);
  const introItems = [
    [t.introRulesTitle, t.introRulesDetail],
    [t.introTurnsTitle, t.introTurnsDetail],
    [t.introEngineTitle, t.introEngineDetail],
    [t.introReplayTitle, t.introReplayDetail],
  ];
  const introList = query('.intro ul');
  for (const [title, detail] of introItems) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const copy = document.createElement('span');
    copy.textContent = detail;
    item.append(heading, copy);
    introList.append(item);
  }
  const features = [
    { icon: 'blocks', title: t.boardTitle, detail: t.boardDetail },
    { icon: 'refresh-cw', title: t.turnsTitle, detail: t.turnsDetail },
    { icon: 'circle-check', title: t.winTitle, detail: t.winDetail },
    { icon: 'list-tree', title: t.engineTitle, detail: t.engineDetail },
    { icon: 'circle-dashed', title: t.pauseTitle, detail: t.pauseDetail },
    { icon: 'file-text', title: t.historyTitle, detail: t.historyDetail },
  ];
  const featureList = query('.features ul');
  for (const feature of features) {
    const item = document.createElement('li');
    const iconSlot = document.createElement('span');
    iconSlot.className = 'feature-icon';
    iconSlot.dataset.icon = feature.icon;
    const copy = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = feature.title;
    const detail = document.createElement('p');
    detail.textContent = feature.detail;
    copy.append(heading, detail);
    item.append(iconSlot, copy);
    featureList.append(item);
  }
  query('.features h2 .heading-label').textContent = t.featuresTitle;
  query('.features h2 .section-count').textContent = String(features.length);
  query('.settings h2 .heading-label').textContent = t.pageSettingsTitle;
  const settingsCleanup = mountSettings(query('.settings-body'), context);
  query('.usage h2 .heading-label').textContent = t.usageTitle;
  query('.usage p').textContent = t.usage;
  query('.usage blockquote').textContent = t.usageExample;
  const handles = [];
  for (const slot of root.querySelectorAll('[data-icon]')) {
    const name = slot.dataset.icon;
    if (context.controls.icons?.includes(name))
      handles.push(context.controls.mount(slot, { type: 'icon', name, size: 18 }));
    else slot.hidden = true;
  }
  function cleanup() {
    settingsCleanup();
    for (const handle of handles) handle.destroy();
    container.replaceChildren();
  }
  context.signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
