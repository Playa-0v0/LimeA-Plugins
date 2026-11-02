import styles from './panel.css';
import { createDrawingSound } from './sound.mjs';

export async function mount(container, context) {
  const zh = context.language.startsWith('zh'),
    t = (a, b) => (zh ? a : b);
  const style = document.createElement('style');
  style.textContent = styles;
  const root = document.createElement('section');
  root.className = 'draw-guess';
  const sound = createDrawingSound(context.resourceBase);
  const soundEvents = new AbortController();
  root.addEventListener('pointerdown', sound.unlock, { capture: true, signal: soundEvents.signal });
  root.addEventListener('keydown', sound.unlock, { capture: true, signal: soundEvents.signal });
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, callback, className = '') => {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', callback);
    return node;
  };
  const heading = element('header', 'heading');
  const title = element('div');
  title.append(
    element('h2', '', t('你画我猜', 'Draw & Guess')),
    element('p', 'muted', t('画得像不像，都有乐趣。', 'A little abstract is part of the fun.')),
  );
  const clock = element('span', 'clock');
  const headingActions = element('div', 'actions');
  const soundSettings = element('details', 'sound-settings');
  const soundSummary = element('summary', '', t('音效', 'Sound'));
  const soundOptions = element('div', 'sound-options');
  for (const [key, label] of [
    ['enabled', t('启用音效', 'Enable sounds')],
    ['pencil', t('画笔声音', 'Drawing sounds')],
  ]) {
    const row = element('label');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = sound.preferences[key];
    checkbox.addEventListener('change', () => sound.configure({ [key]: checkbox.checked }));
    row.append(checkbox, document.createTextNode(label));
    soundOptions.append(row);
  }
  const volumeRow = element('label', '', t('音量', 'Volume'));
  const volume = element('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.value = String(sound.preferences.volume * 100);
  volume.setAttribute('aria-label', t('音效音量', 'Sound volume'));
  volume.addEventListener('input', () => sound.configure({ volume: Number(volume.value) / 100 }));
  volumeRow.append(volume);
  soundOptions.append(volumeRow);
  soundSettings.append(soundSummary, soundOptions);
  headingActions.append(soundSettings, clock);
  heading.append(title, headingActions);
  const error = element('p', 'error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const setup = element('div', 'setup');
  const duration = element('select');
  duration.setAttribute('aria-label', t('每轮时长', 'Round duration'));
  for (const minutes of [3, 5, 10]) {
    const option = element('option', '', `${minutes} ${t('分钟', 'min')}`);
    option.value = String(minutes * 60);
    duration.append(option);
  }
  const painter = element('select');
  painter.setAttribute('aria-label', t('谁先画', 'First painter'));
  for (const [value, label] of [
    ['human', t('我先画', 'I draw first')],
    ['model', t('角色先画', 'Character draws first')],
  ]) {
    const option = element('option', '', label);
    option.value = value;
    painter.append(option);
  }
  const start = button(t('开始游戏', 'Start game'), () => void beginRun(), 'primary');
  setup.append(element('label', '', t('每轮', 'Round')), duration, painter, start);
  const status = element('div', 'round-status');
  status.setAttribute('role', 'status');
  const choices = element('div', 'choices');
  const word = element('div', 'private-word');
  const hint = element('div', 'word-hint');
  hint.setAttribute('aria-live', 'polite');
  const result = element('div', 'round-result');
  result.setAttribute('role', 'status');
  const resultText = element('strong');
  const resultActions = element('div', 'actions');
  resultActions.append(
    button(t('再来一轮', 'Another round'), () => act('next'), 'primary'),
    button(t('下次再玩', 'Finish playing'), () => act('quit')),
  );
  result.append(resultText, resultActions);
  const canvas = element('div', 'drawing');
  const feedback = element('div', 'guesses');
  feedback.setAttribute('aria-live', 'polite');
  feedback.setAttribute('aria-label', t('猜测记录', 'Guesses'));
  const form = element('form', 'guess-form');
  const input = element('input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = t('你猜这是什么？', 'What do you think it is?');
  input.setAttribute('aria-label', t('你的猜测', 'Your guess'));
  const submit = element('button', 'primary', t('猜一下', 'Guess'));
  submit.type = 'submit';
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229))
      event.preventDefault();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (composing || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    act('guess', { text });
  });
  form.append(input, submit);
  const bottom = element('footer');
  const note = element(
    'span',
    'muted',
    t('画作自动保存 · 不计分', 'Drawing saved automatically · No scores'),
  );
  const controls = element('div', 'actions');
  const pause = button(t('暂停', 'Pause'), () => act('pause'));
  const reveal = button(t('揭晓答案', 'Reveal answer'), () => act('reveal'));
  const quit = button(t('结束游戏', 'End game'), () => act('quit'));
  const resume = button(t('继续这一轮', 'Resume round'), () => void beginRun(), 'primary');
  controls.append(pause, reveal, quit, resume);
  bottom.append(note, controls);
  const playArea = element('div', 'play-area');
  const playContent = element('div', 'play-content');
  playContent.append(status, choices, word, hint, result, canvas, feedback, form);
  const preparationOverlay = element('div', 'word-loading');
  preparationOverlay.setAttribute('role', 'status');
  preparationOverlay.setAttribute('aria-live', 'polite');
  preparationOverlay.append(
    element('span', '', t('请稍等，正在出题中…', 'Please wait, preparing words…')),
  );
  playArea.append(playContent, preparationOverlay);
  root.append(heading, setup, error, playArea, bottom);
  container.append(style, root);
  if (!context.canvas) {
    error.hidden = false;
    error.textContent = t(
      '请更新 LimeA，当前版本不支持共享画板。',
      'Update LimeA to use the shared canvas.',
    );
    return () => {
      soundEvents.abort();
      sound.dispose();
      root.remove();
      style.remove();
    };
  }
  let state = null,
    busy = false,
    visible = true,
    disposed = false,
    starting = false;
  let queue = Promise.resolve(),
    pendingScene = null,
    pendingImage = null,
    confirmedImage = null,
    saving = false,
    saveTimer;
  let renderedRound = null,
    renderedRevision = -1,
    snapshotKey = '',
    choiceKey = '',
    feedbackKey = '';
  let sequence = 0,
    appliedSequence = 0;
  const editor = await context.canvas.mount(canvas, {
    document: { version: 1, shapes: [] },
    readOnly: true,
    language: context.language,
    onInteraction: sound.interaction,
    onChange(document) {
      if (state?.painter !== 'human' || state.phase !== 'drawing') return;
      pendingScene = document;
      pendingImage = editor.snapshot();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => enqueue(flush), 300);
    },
  });
  const scope = () => ({ mode: context.mode, sessionId: context.sessionId });
  const showError = (exception) => {
    if (disposed || context.signal.aborted) return;
    error.hidden = false;
    error.textContent = t(
      '操作未完成，请重试。已保存的画作会保留。',
      'Could not complete the action. Your saved drawing is kept.',
    );
    console.warn('draw-guess action failed', exception);
  };
  const enqueue = (action) => {
    queue = queue
      .then(async () => {
        if (!disposed) await action();
      })
      .catch(showError);
    return queue;
  };
  function update(value, seq) {
    if (disposed || seq < appliedSequence) return;
    appliedSequence = seq;
    state = value;
    render();
  }
  async function command(action, extra = {}) {
    if (!state) return null;
    const seq = ++sequence;
    const value = await context.command('game-action', {
      ...scope(),
      roundId: state.id,
      epoch: state.epoch,
      action,
      ...extra,
    });
    if (action !== 'snapshot') update(value, seq);
    return value;
  }
  async function flush() {
    if (saving || !pendingScene || state?.phase !== 'drawing') return;
    saving = true;
    try {
      while (pendingScene && state?.phase === 'drawing') {
        const scene = pendingScene,
          image = pendingImage;
        pendingScene = null;
        await command('draw', { revision: state.canvasRevision, scene });
        confirmedImage = { key: `${state.id}:${state.epoch}:${state.canvasRevision}`, image };
      }
    } catch (error) {
      pendingScene = null;
      throw error;
    } finally {
      saving = false;
    }
  }
  function act(action, extra = {}) {
    enqueue(async () => {
      await flush();
      await command(action, extra);
      error.hidden = true;
      await snapshot();
    });
  }
  async function snapshot() {
    if (
      !busy ||
      !state ||
      pendingScene ||
      saving ||
      !visible ||
      !['ready', 'drawing'].includes(state.phase)
    )
      return;
    const key = `${state.id}:${state.epoch}:${state.canvasRevision}`;
    if (snapshotKey === key) return;
    const image = confirmedImage?.key === key ? confirmedImage.image : editor.snapshot();
    await command('snapshot', { revision: state.canvasRevision, image });
    snapshotKey = key;
  }
  async function load() {
    if (!context.sessionId) {
      render();
      return;
    }
    const seq = ++sequence;
    update(await context.command('load-game', scope()), seq);
    await snapshot();
  }
  async function beginRun() {
    if (busy || starting) return;
    starting = true;
    render();
    try {
      await context.command('save-settings', {
        duration: Number(duration.value),
        firstPainter: painter.value,
      });
      const accepted = await context.startRun(
        'play',
        t('一起玩你画我猜吧。', 'Let’s play Draw & Guess.'),
      );
      if (!accepted) throw new Error('run-busy');
      error.hidden = true;
      snapshotKey = '';
      await load();
    } catch (exception) {
      showError(exception);
    } finally {
      starting = false;
      render();
    }
  }
  function render() {
    const phase = state?.phase,
      active = state && !['ended', 'paused'].includes(phase);
    const generating = phase === 'preparing' || (starting && (!state || phase === 'ended'));
    preparationOverlay.hidden = !generating;
    playContent.inert = generating;
    playArea.hidden = !state && !generating;
    playArea.setAttribute('aria-busy', String(generating));
    root.dataset.phase = phase ?? 'idle';
    setup.hidden = Boolean(state && phase !== 'ended');
    start.disabled = busy || starting;
    duration.disabled = busy;
    painter.disabled = busy;
    result.hidden = phase !== 'result';
    form.hidden = phase !== 'drawing' || state?.painter !== 'model';
    canvas.hidden = !state;
    feedback.hidden = !state?.guesses.length;
    pause.hidden = !active || phase === 'result';
    reveal.hidden = !['drawing', 'ready'].includes(phase);
    quit.hidden = !state || phase === 'ended' || phase === 'result';
    resume.hidden = phase !== 'paused';
    resume.disabled = busy || starting;
    status.textContent = !state
      ? t('选好顺序，轮流把脑海里的东西画出来。', 'Choose who draws first, then take turns.')
      : phase === 'paused'
        ? t('本轮已暂停，画作已保留。', 'Paused. Your drawing is kept.')
        : phase === 'ended'
          ? t('今天先画到这里。', 'That was fun. See you next time.')
          : phase === 'result'
            ? `${t('第', 'Round ')} ${state.round} ${t('轮', '')}`
            : `${t('第', 'Round ')} ${state.round} ${t('轮 · ', ' · ')}${state.painter === 'human' ? t('你画，角色猜', 'You draw, character guesses') : t('角色画，你来猜', 'Character draws, you guess')}${state.thinking ? t(' · 正在思考…', ' · Thinking…') : ''}`;
    if (state?.error && state.error !== 'user') {
      error.hidden = false;
      error.textContent =
        state.error === 'interrupted'
          ? t('运行中断，可继续这一轮。', 'Interrupted. You can resume this round.')
          : t(
              '模型请求或绘画未完成，可继续重试；画作已保留。',
              'The model request or drawing did not complete. Resume to retry; your drawing is kept.',
            );
    }
    word.hidden =
      !state?.word || state.painter !== 'human' || Boolean(state.result) || phase === 'ended';
    word.textContent = state?.word
      ? `${t('你的题目：', 'Your word: ')}${state.word} · ${t('只有你看得到', 'Only you can see it')}`
      : '';
    hint.hidden = !state?.characterCount || Boolean(state.result) || phase === 'ended';
    hint.textContent = state?.characterCount
      ? t(`字数提示：${state.characterCount} 个字`, `Hint: ${state.characterCount} characters`)
      : '';
    if (phase === 'result')
      resultText.textContent = `${state.result === 'guessed' ? t('猜中了！', 'Got it!') : state.result === 'timeout' ? t('时间到了', 'Time’s up') : t('本轮揭晓', 'Revealed')} · ${state.word}`;
    const nextChoiceKey = JSON.stringify(state?.choices ?? []);
    choices.hidden = !state?.choices.length;
    if (choiceKey !== nextChoiceKey) {
      choiceKey = nextChoiceKey;
      choices.replaceChildren();
      (state?.choices ?? []).forEach((value, choice) =>
        choices.append(button(value, () => act('choose', { choice }), 'word-choice')),
      );
    }
    if (state) {
      const newRound = renderedRound !== state.id;
      if (newRound || (state.painter === 'model' && renderedRevision !== state.canvasRevision)) {
        editor.setDocument(state.scene);
        renderedRound = state.id;
        renderedRevision = state.canvasRevision;
        if (newRound) {
          pendingScene = null;
          confirmedImage = null;
          snapshotKey = '';
        }
      }
      editor.setReadOnly(state.painter !== 'human' || phase !== 'drawing' || !busy);
      const nextFeedbackKey = JSON.stringify(state.guesses);
      if (feedbackKey !== nextFeedbackKey) {
        feedbackKey = nextFeedbackKey;
        feedback.replaceChildren();
        for (const guess of state.guesses.slice(-6)) {
          const name =
            guess.by === 'human' ? t('你', 'You') : context.characterName || t('角色', 'Character');
          feedback.append(element('span', 'guess', `${name}：${guess.text}`));
        }
      }
    } else editor.setReadOnly(true);
    clock.textContent = state ? timeLeft() : '';
  }
  function timeLeft() {
    const seconds = Math.ceil(
      Math.max(0, state.deadline ? state.deadline - Date.now() : state.remaining) / 1000,
    );
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const settings = await context.command('load-settings');
  duration.value = String(settings.duration);
  painter.value = settings.firstPainter;
  const removeRunListener = context.onRunStateChange((value) => {
    busy = value;
    render();
    if (value) snapshotKey = '';
  });
  const removeVisibilityListener = context.onVisibilityChange((value) => {
    visible = value;
    sound.setVisible(value);
    if (!value && busy && state && !['paused', 'ended', 'result'].includes(state.phase))
      act('pause');
    if (value) enqueue(load);
  });
  let loading = false;
  const poll = setInterval(() => {
    if (disposed || !visible || loading) return;
    loading = true;
    enqueue(async () => {
      try {
        await flush();
        await load();
      } finally {
        loading = false;
      }
    });
  }, 700);
  const timer = setInterval(() => {
    if (state && visible) clock.textContent = timeLeft();
  }, 250);
  await load();
  render();
  return () => {
    disposed = true;
    soundEvents.abort();
    sound.dispose();
    clearTimeout(saveTimer);
    clearInterval(poll);
    clearInterval(timer);
    removeRunListener();
    removeVisibilityListener();
    editor.destroy();
    root.remove();
    style.remove();
  };
}
