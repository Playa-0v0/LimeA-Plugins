import css from './page.css';
import { mount as mountSettings } from './settings.mjs';
import { zh, en } from './page-strings.mjs';

export async function mount(container, context) {
  if (!context.controls) throw new Error('plugin-host-upgrade-required');
  const t = context.language.startsWith('zh') ? zh : en;
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'wallpaper-page';
  root.innerHTML = `
    <section class="intro" aria-label="">
      <ul></ul>
    </section>
    <section class="features" aria-labelledby="wallpaper-features-title">
      <h2 id="wallpaper-features-title"><span class="section-icon" data-icon="blocks"></span><span class="heading-label"></span><span class="section-count"></span></h2>
      <ul></ul>
    </section>
    <section class="settings" aria-labelledby="wallpaper-settings-title">
      <h2 id="wallpaper-settings-title"><span class="section-icon" data-icon="link"></span><span class="heading-label"></span></h2>
      <p class="settings-description"></p>
      <div class="settings-body"><p class="settings-loading" role="status"></p></div>
    </section>
    <section class="usage" aria-labelledby="wallpaper-usage-title">
      <h2 id="wallpaper-usage-title"><span class="section-icon" data-icon="message-square"></span><span class="heading-label"></span></h2>
      <p></p>
      <blockquote></blockquote>
    </section>`;
  container.replaceChildren(style, root);
  const query = (selector) => root.querySelector(selector);
  query('.intro').setAttribute('aria-label', t.introLabel);
  const introItems = [
    [t.introSourcesTitle, t.introSourcesDetail],
    [t.introLibraryTitle, t.introLibraryDetail],
    [t.introGlassTitle, t.introGlassDetail],
    [t.introSafeTitle, t.introSafeDetail],
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
    { icon: 'blocks', title: t.sourcesTitle, detail: t.sourcesDetail },
    { icon: 'list-tree', title: t.libraryTitle, detail: t.libraryDetail },
    { icon: 'circle-check', title: t.glassTitle, detail: t.glassDetail },
    { icon: 'circle-dashed', title: t.frameTitle, detail: t.frameDetail },
    { icon: 'refresh-cw', title: t.playbackTitle, detail: t.playbackDetail },
    { icon: 'shield-check', title: t.securityTitle, detail: t.securityDetail },
    { icon: 'file-text', title: t.stateTitle, detail: t.stateDetail },
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
  query('.settings-description').textContent = t.pageSettingsDescription;
  const loading = query('.settings-loading');
  loading.textContent = t.settingsLoading;
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
  let settingsCleanup = () => {};
  try {
    settingsCleanup = await mountSettings(query('.settings-body'), context);
    loading.remove();
  } catch {
    loading.textContent = t.settingsLoadFailed;
    loading.setAttribute('role', 'alert');
  }
  function cleanup() {
    settingsCleanup();
    for (const handle of handles) handle.destroy();
    container.replaceChildren();
  }
  context.signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
