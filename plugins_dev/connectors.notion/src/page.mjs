import css from './page.css';
import { zh, en } from './strings.mjs';

export function mount(container, context) {
  if (!context.connections || !context.controls) throw new Error('plugin-host-upgrade-required');
  const t = context.language.startsWith('zh') ? zh : en;
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'notion-page';
  root.innerHTML = `
    <section class="intro" aria-label="">
      <ul>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
        <li><strong></strong><span></span></li>
      </ul>
    </section>
    <section class="account" aria-labelledby="notion-account-title">
      <h2 id="notion-account-title"><span class="section-icon" data-icon="link"></span><span class="heading-label"></span></h2>
      <div class="account-row">
        <img class="account-icon" alt="">
        <div class="account-summary"><strong class="account-name"></strong><p class="account-hint"></p></div>
        <div class="account-actions"><span data-action="authorize"></span><span data-action="resume"></span><span data-action="cancel"></span><span data-action="refresh"></span><span data-action="disconnect"></span></div>
      </div>
      <p class="account-status" role="status" aria-live="polite"></p>
      <div class="account-error" role="alert"><p></p><span data-action="retry"></span></div>
    </section>
    <section class="features"><h2><span class="section-icon" data-icon="blocks"></span><span class="heading-label"></span><span class="section-count">7</span></h2><ul>
      <li><span class="feature-icon" data-icon="search"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="file-text"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="search"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="list-tree"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="blocks"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="message-square"></span><div><h3></h3><p></p></div></li>
      <li><span class="feature-icon" data-icon="file-text"></span><div><h3></h3><p></p></div></li>
    </ul></section>
    <section class="usage"><h2><span class="section-icon" data-icon="message-square"></span><span class="heading-label"></span></h2><p></p><blockquote></blockquote></section>`;
  container.replaceChildren(style, root);
  const query = (selector) => root.querySelector(selector);
  query('#notion-account-title .heading-label').textContent = t.accountTitle;
  query('.account-icon').src = new URL('assets/icon.png', context.resourceBase).href;
  query('.features h2 .heading-label').textContent = t.featuresTitle;
  [...root.querySelectorAll('.features li')].forEach((item, i) => {
    item.querySelector('h3').textContent = [
      t.searchTitle,
      t.pageTitle,
      t.blocksTitle,
      t.dataTitle,
      t.commentsTitle,
      t.writeTitle,
      t.extendedTitle,
    ][i];
    item.querySelector('p').textContent = [
      t.searchDetail,
      t.pageDetail,
      t.blocksDetail,
      t.dataDetail,
      t.commentsDetail,
      t.writeDetail,
      t.extendedDetail,
    ][i];
  });
  query('.intro').setAttribute('aria-label', t.introLabel);
  [...root.querySelectorAll('.intro li')].forEach((item, i) => {
    item.querySelector('strong').textContent = [
      t.introSearchTitle,
      t.introDocsTitle,
      t.introProjectsTitle,
      t.introMemoryTitle,
    ][i];
    item.querySelector('span').textContent = [
      t.introSearchDetail,
      t.introDocsDetail,
      t.introProjectsDetail,
      t.introMemoryDetail,
    ][i];
  });
  query('.usage h2 .heading-label').textContent = t.usageTitle;
  query('.usage p').textContent = t.usage;
  query('.usage blockquote').textContent = t.usageExample;
  let view,
    pending = false,
    polling = false,
    timer,
    disposed = false,
    error = '';
  const handles = new Map();
  const iconHandles = [];
  for (const slot of root.querySelectorAll('[data-icon]')) {
    const name = slot.dataset.icon;
    if (context.controls.icons?.includes(name)) {
      iconHandles.push(context.controls.mount(slot, { type: 'icon', name, size: 18 }));
    } else slot.hidden = true;
  }
  const alive = () => !disposed && !context.signal.aborted;
  const labels = {
    authorize: t.connect,
    resume: t.continue,
    cancel: t.cancel,
    refresh: t.refresh,
    disconnect: t.disconnect,
    retry: t.retry,
  };
  const actionIcons = {
    authorize: 'external-link',
    resume: 'external-link',
    refresh: 'refresh-cw',
    disconnect: 'unplug',
  };
  const buttonIcon = (action) =>
    context.controls.icons?.includes(actionIcons[action]) ? { icon: actionIcons[action] } : {};
  for (const [action, label] of Object.entries(labels)) {
    const slot = query(`[data-action="${action}"]`);
    handles.set(
      action,
      context.controls.mount(slot, {
        type: 'button',
        label,
        ...buttonIcon(action),
        variant: action === 'authorize' ? 'default' : 'outline',
        onPress: () => void perform(action),
      }),
    );
  }
  function render() {
    if (!alive()) return;
    const c = view?.connection,
      f = view?.authorization;
    const authorizing = f && ['preparing', 'authorizing'].includes(f.status);
    const connected = c?.status === 'connected';
    query('.account-name').textContent = !view
      ? t.loading
      : authorizing
        ? t.authorizing
        : connected
          ? c.workspaceName
          : c?.status === 'reauthorization_required'
            ? t.reauthorization
            : t.notConnected;
    query('.account-hint').textContent = authorizing
      ? t.authorizingHint
      : connected
        ? `${t.ready} · ${t.readOnly}`
        : t.readOnly;
    const shown = {
      authorize: Boolean(
        view && (!c || c.status === 'disconnected') && !authorizing && f?.status !== 'persisted',
      ),
      resume: Boolean(authorizing),
      cancel: Boolean(authorizing),
      refresh: Boolean(c && c.status !== 'disconnected'),
      disconnect: Boolean(c && c.status !== 'disconnected'),
      retry: Boolean(error),
    };
    for (const [action, handle] of handles) {
      query(`[data-action="${action}"]`).hidden = !shown[action];
      handle.update({
        type: 'button',
        label: labels[action],
        ...buttonIcon(action),
        variant: action === 'authorize' ? 'default' : 'outline',
        disabled: pending || (action === 'refresh' && Boolean(view?.operation)),
        onPress: () => void perform(action),
      });
    }
    let status = '';
    if (c?.status === 'disconnected') status = t.revocation[c.remoteRevocation];
    else if (view?.operation)
      status = view.operation.kind === 'refresh' ? t.refreshPending : t.revokePending;
    else if (f?.status === 'persisted') status = t.savedAcknowledging;
    else if (f && ['failed', 'expired', 'unknown', 'cancelled'].includes(f.status))
      status = t.auth[f.status];
    else if (c?.error || f?.error) status = t.recoveryHint;
    query('.account-status').textContent = status;
    query('.account-status').hidden = !status;
    query('.account-error').hidden = !error;
    query('.account-error p').textContent = error;
    query('.account').setAttribute('aria-busy', String(pending || !view));
  }
  function schedule() {
    clearTimeout(timer);
    if (alive() && (view?.operation || view?.authorization?.pending))
      timer = setTimeout(() => void load(), 2000);
  }
  async function load() {
    if (!alive() || pending || polling) return;
    polling = true;
    try {
      const next = await context.connections.request({ action: 'view' });
      if (alive() && (!view || next.revision >= view.revision)) {
        view = next;
        error = '';
      }
    } catch {
      if (alive()) error = t.loadFailed;
    } finally {
      polling = false;
      if (alive()) {
        render();
        schedule();
      }
    }
  }
  async function perform(action) {
    if (!alive() || pending) return;
    if (action === 'retry') {
      await load();
      return;
    }
    pending = true;
    error = '';
    render();
    try {
      const next = await context.connections.request({ action });
      if (alive() && (!view || next.revision >= view.revision)) view = next;
    } catch (e) {
      if (alive())
        error =
          e?.code === 'connection-vault-unavailable'
            ? t.vaultUnavailable
            : e?.code === 'connection-refresh-unavailable'
              ? t.refreshUnavailable
              : t.actionFailed;
    } finally {
      pending = false;
      if (alive()) {
        render();
        schedule();
      }
    }
  }
  const unsubscribe = context.connections.subscribe((next) => {
    if (alive() && (!view || next.revision >= view.revision)) {
      view = next;
      render();
      schedule();
    }
  });
  const onFocus = () => void load();
  window.addEventListener('focus', onFocus);
  function cleanup() {
    disposed = true;
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener('focus', onFocus);
    for (const handle of handles.values()) handle.destroy();
    for (const handle of iconHandles) handle.destroy();
    container.replaceChildren();
  }
  context.signal.addEventListener('abort', cleanup, { once: true });
  render();
  void load();
  return cleanup;
}
