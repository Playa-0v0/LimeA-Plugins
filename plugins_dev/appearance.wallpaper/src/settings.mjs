import css from './settings.css';
import { mountPreviewLibrary } from './preview-library.mjs';
export async function mount(container, ctx) {
  const en = ctx.language.startsWith('en');
  const t = (zh, english) => (en ? english : zh);
  const style = document.createElement('style');
  style.textContent = css;
  const page = document.createElement('section');
  page.className = 'wallpaper-settings';
  page.innerHTML = `<div class="actions"><button data-action="pick">${t('选择文件', 'Choose file')}</button><button data-action="scan">${t('扫描工坊库', 'Scan workshop')}</button><button data-action="clear">${t('恢复默认背景', 'Clear wallpaper')}</button></div>
    <output role="status" aria-live="polite"></output><div class="library" role="list" aria-label="${t('壁纸库', 'Wallpapers')}"></div>
    <form><label>${t('玻璃外观', 'Glass appearance')}<input name="glass" type="checkbox"></label>
    <label>${t('工作区不透明度', 'Workspace opacity')}<input aria-label="${t('工作区不透明度', 'Workspace opacity')}" name="opacity" type="range" min="0.5" max="1" step="0.01"><span data-value="opacity"></span></label>
    <label>${t('外框加深', 'Darken window frame')}<input aria-label="${t('外框加深', 'Darken window frame')}" aria-describedby="shell-dim-hint" name="shellDim" type="range" min="0" max="0.8" step="0.01"><span data-value="shellDim"></span></label>
    <p id="shell-dim-hint" class="note">${t('只加深标题栏、左侧栏和四周留白。0% 不额外加深，数值越高，外框越深。', 'Darkens only the title bar, left sidebar, and window insets. 0% adds no extra shading; higher values make the frame darker.')}</p>
    <label>${t('模糊程度', 'Blur')}<input aria-label="${t('模糊程度', 'Blur')}" name="blur" type="range" min="0" max="24" step="1"><span data-value="blur"></span></label>
    <label>${t('壁纸压暗', 'Dim wallpaper')}<input aria-label="${t('壁纸压暗', 'Dim wallpaper')}" name="dim" type="range" min="0" max="0.8" step="0.01"><span data-value="dim"></span></label>
    <label>${t('帧率上限', 'Frame rate')}<select name="fps"><option>15</option><option>30</option><option>60</option></select></label>
    <label>${t('填充方式', 'Fit')}<select name="fit"><option value="cover">${t('填满', 'Cover')}</option><option value="contain">${t('完整显示', 'Contain')}</option><option value="stretch">${t('拉伸', 'Stretch')}</option></select></label>
    <label>${t('暂停播放', 'Pause playback')}<input name="paused" type="checkbox"></label></form>
    <p class="note">${t('默认静音，窗口隐藏时暂停。场景兼容性取决于 WebWallGL；不支持启动应用程序类壁纸。', 'Muted by default; pauses when hidden. Scene compatibility depends on WebWallGL. Application wallpapers are not supported.')}</p>`;
  container.append(style, page);
  let disposed = false;
  let savedData;
  const output = page.querySelector('output'),
    library = page.querySelector('.library'),
    form = page.querySelector('form');
  const libraryView = mountPreviewLibrary(library, {
    t,
    command: ctx.command,
    signal: ctx.signal,
    onSelect: (id) => void action('select', id),
  });
  const fields = [...form.elements];
  const actionButtons = [...page.querySelectorAll('[data-action]')];
  const widgets = new Map();
  const controls = () => [...fields, ...actionButtons, ...library.querySelectorAll('button')];
  const valueText = (field) =>
    field.name === 'blur' ? `${field.value}px` : `${Math.round(field.value * 100)}%`;
  function syncControl(field) {
    const widget = widgets.get(field);
    if (!widget) return;
    widget.options.disabled = field.disabled;
    if (widget.options.type === 'switch') widget.options.checked = field.checked;
    if (widget.options.type === 'select') widget.options.value = field.value;
    if (widget.options.type === 'slider') {
      widget.options.value = Number(field.value);
      widget.options.valueText = valueText(field);
    }
    widget.handle.update({ ...widget.options });
  }
  function preview(field) {
    const label = page.querySelector(`[data-value="${field.name}"]`);
    if (label) label.textContent = valueText(field);
    syncControl(field);
  }
  function configure(field) {
    preview(field);
    void action('configure', {
      [field.name]:
        field.type === 'checkbox'
          ? field.checked
          : field.name === 'fit'
            ? field.value
            : Number(field.value),
    });
  }
  function mountControl(element, options) {
    const target = document.createElement('span');
    target.className = 'host-control';
    target.dataset.type = options.type;
    element.replaceWith(target);
    const handle = ctx.controls.mount(target, options);
    widgets.set(element, { handle, options });
  }
  function render(data) {
    savedData = data;
    libraryView.update(data.items, data.settings.current, data.previewsSupported);
    for (const field of fields) {
      if (field.type === 'checkbox') field.checked = data.settings[field.name];
      else field.value = data.settings[field.name];
      preview(field);
    }
    if (data.error) output.textContent = data.error;
  }
  async function action(method, payload) {
    controls().forEach((el) => {
      el.disabled = true;
      syncControl(el);
    });
    output.textContent = t('处理中…', 'Working…');
    try {
      const result = await ctx.command(method, payload);
      const data = await ctx.command('list');
      if (disposed) return;
      output.textContent =
        method === 'scan'
          ? t(`找到 ${result.count} 个项目`, `Found ${result.count} projects`)
          : t('已保存', 'Saved');
      render(data);
      if (method === 'scan' || method === 'pick') libraryView.refresh();
    } catch (error) {
      if (!disposed) {
        if (savedData) render(savedData);
        output.textContent = error.message;
      }
    } finally {
      if (!disposed)
        controls().forEach((el) => {
          el.disabled = false;
          syncControl(el);
        });
    }
  }
  actionButtons.forEach(
    (button) =>
      (button.onclick = () =>
        void action(
          button.dataset.action === 'clear' ? 'select' : button.dataset.action,
          button.dataset.action === 'clear' ? null : undefined,
        )),
  );
  form.onchange = (event) => {
    if (fields.includes(event.target)) configure(event.target);
  };
  form.oninput = (event) => {
    if (fields.includes(event.target)) preview(event.target);
  };
  form.onsubmit = (event) => event.preventDefault();
  render(await ctx.command('list'));
  // Prefer the host's real components. Keep native controls for older hosts.
  if (ctx.controls) {
    for (const button of actionButtons) {
      mountControl(button, { type: 'button', label: button.textContent, onPress: button.onclick });
    }
    for (const field of fields) {
      const label = field.closest('label').firstChild.textContent;
      if (field.type === 'checkbox') {
        mountControl(field, {
          type: 'switch',
          label,
          checked: field.checked,
          onCheckedChange(value) {
            field.checked = value;
            configure(field);
          },
        });
      } else if (field.type === 'range') {
        mountControl(field, {
          type: 'slider',
          label,
          value: Number(field.value),
          valueText: valueText(field),
          min: Number(field.min),
          max: Number(field.max),
          step: Number(field.step),
          onValueChange(value) {
            field.value = String(value);
            preview(field);
          },
          onValueCommit(value) {
            field.value = String(value);
            configure(field);
          },
        });
      } else {
        mountControl(field, {
          type: 'select',
          label,
          value: field.value,
          options: [...field.options].map((option) => ({
            value: option.value,
            label: option.textContent,
          })),
          onValueChange(value) {
            field.value = value;
            configure(field);
          },
        });
      }
    }
  }
  const cleanup = () => {
    disposed = true;
    libraryView.destroy();
    for (const { handle } of widgets.values()) handle.destroy();
    widgets.clear();
    page.remove();
    style.remove();
  };
  ctx.signal.addEventListener('abort', cleanup, { once: true });
  if (ctx.signal.aborted) cleanup();
  return cleanup;
}
