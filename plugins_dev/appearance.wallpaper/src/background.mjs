export function mount(container, ctx) {
  if (!ctx.command || !ctx.setAppearance) throw new Error('需要支持接口版本 9 的 LimeA');
  ctx.setAppearance(null);
  let disposed = false,
    timer,
    frame,
    latest,
    visible = true,
    current,
    ready = false,
    booted = false,
    watchdog;
  const dim = document.createElement('div');
  dim.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none';
  const controls = () => {
    if (!frame || !latest?.item || !booted) return;
    dim.style.opacity = String(latest.settings.dim);
    frame.contentWindow?.postMessage(
      { wallpaper: true, type: 'configure', item: latest.item, settings: latest.settings, visible },
      new URL(latest.item.runtime).origin,
    );
    if (ready) ctx.setAppearance(latest.settings);
  };
  const report = (message) => {
    void ctx.command('report', message).catch(() => {});
  };
  const messages = (event) => {
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== new URL(latest.item.runtime).origin ||
      event.data?.wallpaper !== true
    )
      return;
    if (event.data.type === 'boot') {
      booted = true;
      controls();
    }
    if (event.data.type === 'ready') {
      ready = true;
      clearTimeout(watchdog);
      ctx.setAppearance(latest.settings);
      report(null);
    }
    if (event.data.type === 'error') {
      ready = false;
      clearTimeout(watchdog);
      ctx.setAppearance(null);
      report(String(event.data.message).slice(0, 300));
    }
  };
  window.addEventListener('message', messages);
  const unsubscribe = ctx.onVisibilityChange((value) => {
    visible = value;
    controls();
  });
  async function refresh() {
    try {
      const data = await ctx.command('playback');
      if (disposed) return;
      latest = data;
      const key = data.item ? `${data.item.id}:${data.item.base}:${data.settings.revision}` : null;
      if (key !== current) {
        current = key;
        ready = false;
        booted = false;
        clearTimeout(watchdog);
        frame?.remove();
        frame = null;
        dim.remove();
        ctx.setAppearance(null);
        if (data.item) {
          frame = document.createElement('iframe');
          frame.title = '壁纸 / Wallpaper';
          frame.tabIndex = -1;
          frame.setAttribute('aria-hidden', 'true');
          frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
          frame.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none';
          frame.src = `${data.item.runtime}index.html`;
          container.append(frame, dim);
          watchdog = setTimeout(() => {
            if (!ready) report('壁纸加载超时，请检查文件或重新选择 / Loading timed out');
          }, 45000);
        }
      } else controls();
    } catch (error) {
      if (!disposed) {
        ctx.setAppearance(null);
        report(String(error.message));
      }
    } finally {
      if (!disposed) timer = setTimeout(refresh, 1000);
    }
  }
  void refresh();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    unsubscribe();
    window.removeEventListener('message', messages);
    frame?.remove();
    dim.remove();
    ctx.setAppearance(null);
  };
  ctx.signal.addEventListener('abort', dispose, { once: true });
  return dispose;
}
