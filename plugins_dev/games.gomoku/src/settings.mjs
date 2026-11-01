import css from './settings.css';

// Shared by the plugin manager and the in-game dialog. Both use the same commands and storage.
export function mount(container, context) {
  const tr = (zh, en) => (context.language.startsWith('en') ? en : zh);
  const root = document.createElement('section');
  root.className = 'gomoku-settings';
  const style = document.createElement('style');
  style.textContent = css;
  root.innerHTML = `<p class="settings-intro">${tr('选择角色如何思考下一步。', 'Choose how your character considers its next move.')}</p>
    <form><fieldset class="mode-options"><legend>${tr('落子方式', 'Move selection')}</legend>
    <label><input type="radio" name="mode" value="model"><span><strong>${tr('模型落子', 'Model only')}</strong><small>${tr('角色自己读棋盘、想策略，棋力取决于当前模型。', 'Your character reads the board and chooses its own strategy.')}</small></span></label>
    <label><input type="radio" name="mode" value="engine"><span><strong>${tr('引擎辅助', 'Engine assisted')}</strong><small>${tr('计算三个候选落点及评分，由角色决定最终落子。', 'Calculate up to three scored candidates. Your character makes the final choice.')}</small></span></label></fieldset>
    <fieldset class="difficulty-options" hidden><legend>${tr('分析难度', 'Analysis level')}</legend><div>
    <label><input type="radio" name="difficulty" value="normal"><span><strong>${tr('普通', 'Normal')}</strong><small>${tr('较快分析，轻松陪玩', 'Quick analysis, casual play')}</small></span></label>
    <label><input type="radio" name="difficulty" value="hard"><span><strong>${tr('困难', 'Hard')}</strong><small>${tr('多想几步，寻找攻防机会', 'Deeper search for threats')}</small></span></label></div></fieldset>
    <p class="settings-feedback" role="status"></p><button class="retry-settings" type="button" hidden>${tr('重新读取', 'Reload settings')}</button>
    <small class="settings-note">${tr('自动保存，从下一局生效。所有聊天共用此设置。', 'Saved automatically. Applies next round, across chats.')}</small></form>`;
  root.prepend(style);
  container.append(root);
  const form = root.querySelector('form'),
    feedback = root.querySelector('.settings-feedback'),
    retry = root.querySelector('.retry-settings');
  const events = new AbortController();
  let disposed = false,
    ready = false,
    busy = false;
  const disable = () => {
    for (const input of form.querySelectorAll('input')) input.disabled = !ready || busy;
  };
  const show = (settings) => {
    for (const input of form.querySelectorAll('input'))
      input.checked = settings[input.name] === input.value;
    root.querySelector('.difficulty-options').hidden = settings.mode !== 'engine';
  };
  const failure = (text) => {
    ready = false;
    feedback.textContent = text;
    feedback.setAttribute('role', 'alert');
    retry.hidden = false;
  };
  async function load() {
    if (disposed || busy) return;
    busy = true;
    ready = false;
    retry.hidden = true;
    disable();
    feedback.setAttribute('role', 'status');
    feedback.textContent = tr('正在读取设置…', 'Loading settings…');
    try {
      const settings = await context.command('load-settings', {});
      if (disposed) return;
      show(settings);
      ready = true;
      feedback.textContent = '';
    } catch {
      if (!disposed)
        failure(tr('设置读取失败，请重试。', 'Could not load settings. Please retry.'));
    } finally {
      busy = false;
      if (!disposed) disable();
    }
  }
  form.addEventListener('submit', (event) => event.preventDefault(), { signal: events.signal });
  form.addEventListener(
    'change',
    async () => {
      if (disposed || !ready || busy) return;
      const values = Object.fromEntries(new FormData(form));
      show(values);
      busy = true;
      disable();
      feedback.textContent = tr('正在保存…', 'Saving…');
      try {
        const saved = await context.command('save-settings', values);
        if (disposed) return;
        show(saved);
        feedback.textContent = tr('已保存，下一局生效', 'Saved for the next round');
      } catch {
        if (!disposed)
          failure(
            tr(
              '保存未确认，请重新读取设置后核对。',
              'Save not confirmed. Reload and check settings.',
            ),
          );
      } finally {
        busy = false;
        if (!disposed) disable();
      }
    },
    { signal: events.signal },
  );
  retry.addEventListener('click', () => void load(), { signal: events.signal });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    events.abort();
    root.remove();
    context.signal.removeEventListener('abort', cleanup);
  };
  context.signal.addEventListener('abort', cleanup, { once: true });
  if (context.signal.aborted) cleanup();
  else void load();
  return cleanup;
}
