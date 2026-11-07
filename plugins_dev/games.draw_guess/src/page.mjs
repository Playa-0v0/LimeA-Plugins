import css from './page.css';
import { zh, en } from './page-strings.mjs';

export function mount(container, context) {
  if (!context.controls) throw new Error('plugin-host-upgrade-required');
  const t = context.language.startsWith('zh') ? zh : en;
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'draw-guess-page';
  root.innerHTML = `
    <section class="intro" aria-label="">
      <ul>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
      </ul>
    </section>
    <section class="features" aria-labelledby="draw-guess-features-title">
      <h2 id="draw-guess-features-title"><span class="section-icon" data-icon="blocks"></span><span class="heading-label"></span><span class="section-count"></span></h2>
      <ul>
        <li><span class="feature-icon" data-icon="blocks"></span><div><h3></h3><p></p></div></li>
        <li><span class="feature-icon" data-icon="shield-check"></span><div><h3></h3><p></p></div></li>
        <li><span class="feature-icon" data-icon="message-square"></span><div><h3></h3><p></p></div></li>
        <li><span class="feature-icon" data-icon="list-tree"></span><div><h3></h3><p></p></div></li>
      </ul>
    </section>
    <section class="usage" aria-labelledby="draw-guess-usage-title">
      <h2 id="draw-guess-usage-title"><span class="section-icon" data-icon="message-square"></span><span class="heading-label"></span></h2>
      <p></p>
      <blockquote></blockquote>
    </section>`;
  container.replaceChildren(style, root);
  const query = (selector) => root.querySelector(selector);
  query('.intro').setAttribute('aria-label', t.introLabel);
  [...root.querySelectorAll('.intro li')].forEach((item, i) => {
    item.querySelector('strong').textContent = [
      t.introTurnTitle,
      t.introGuessTitle,
      t.introCasualTitle,
      t.introReplayTitle,
    ][i];
    item.querySelector('span').textContent = [
      t.introTurnDetail,
      t.introGuessDetail,
      t.introCasualDetail,
      t.introReplayDetail,
    ][i];
  });
  query('.features h2 .heading-label').textContent = t.featuresTitle;
  query('.features h2 .section-count').textContent = String(4);
  [...root.querySelectorAll('.features li')].forEach((item, i) => {
    item.querySelector('h3').textContent = [
      t.boardTitle,
      t.secretTitle,
      t.agentTitle,
      t.historyTitle,
    ][i];
    item.querySelector('p').textContent = [
      t.boardDetail,
      t.secretDetail,
      t.agentDetail,
      t.historyDetail,
    ][i];
  });
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
    for (const handle of handles) handle.destroy();
    container.replaceChildren();
  }
  context.signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
