import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const STYLE = `
:host{color:inherit;font:inherit}*{box-sizing:border-box}
.shark{display:flex;flex:1;min-height:0;height:100%;flex-direction:column;color:var(--foreground,#eee);font:14px system-ui;background:var(--panel,#131615);container-type:inline-size}
.intro{padding:18px 20px 0;display:flex;justify-content:space-between;align-items:center;gap:12px}.intro h2{font-size:18px;margin:0 0 6px}.intro p{font-size:12px;color:var(--muted-foreground,#aaa);margin:0;line-height:1.6}
button{font:inherit;cursor:pointer;border:1px solid var(--border,#394236);background:transparent;color:inherit;border-radius:9px;padding:8px 12px;transition:background-color 160ms ease-out,color 160ms ease-out,border-color 160ms ease-out}button:hover:enabled{background:var(--muted,#293126)}button:focus-visible{outline:2px solid var(--primary,#b4ea83);outline-offset:2px}button:disabled{cursor:default;opacity:.35}
.stage{flex:1;min-height:200px;position:relative;overflow:hidden}.stage canvas{display:block;width:100%;height:100%;touch-action:manipulation}.state{font-size:14px;font-weight:600;text-align:center;min-height:24px;margin:4px 16px 12px}.state[data-bitten=true]{color:#f19483}
.teeth{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;max-width:360px;width:100%;margin:0 auto;padding:0 20px 16px}.teeth button{padding:7px 4px;font-size:12px}.bottom{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px 16px}.bottom small{font-size:11px;color:var(--muted-foreground,#aaa)}.restart{background:var(--primary,#b4ea83);color:var(--primary-foreground,#172211);border-color:transparent}.error{color:#f19483;text-align:center;padding:8px 16px;margin:0;font-size:12px}
.play-modes{display:flex;gap:8px;padding:14px 20px 0;flex-wrap:wrap}.play-modes button[aria-pressed=true]{background:var(--primary,#b4ea83);color:var(--primary-foreground,#172211)}
.restart:hover:enabled,.play-modes button[aria-pressed=true]:hover:enabled{background:color-mix(in srgb,var(--primary,#b4ea83) 90%,var(--panel,#131615));color:var(--primary-foreground,#172211)}
.restart:active:enabled,.play-modes button[aria-pressed=true]:active:enabled{background:color-mix(in srgb,var(--primary,#b4ea83) 82%,var(--panel,#131615));color:var(--primary-foreground,#172211)}
.restart:disabled{background:var(--surface-raised,#303330);color:var(--muted-foreground,#aaa);border-color:var(--border,#394236);opacity:1}
.score{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:18px;flex-shrink:0;width:calc(100% - 40px);max-width:400px;margin:16px auto 0;padding:12px 18px;border:1px solid var(--border-subtle,var(--border,#394236));border-radius:12px;background:var(--surface,#202420);font-variant-numeric:tabular-nums;text-align:center}
.score[hidden]{display:none}.score-side{display:flex;flex-direction:column;gap:4px;min-width:0}.score-label{font-size:12px;color:var(--muted-foreground,#aaa);line-height:1.4}.score-value{font-size:32px;font-weight:650;line-height:1.1;letter-spacing:-.02em;overflow-wrap:anywhere}.score-meta{display:flex;flex-direction:column;gap:7px;min-width:88px}.score-round{font-size:12px;color:var(--muted-foreground,#aaa);line-height:1.4}.score-phase{font-size:12px;font-weight:500;line-height:1.4}
.score[data-highlight=human] [data-side=human] .score-value,.score[data-highlight=model] [data-side=model] .score-value{color:var(--primary,#b4ea83)}
.teeth button[data-player=human]{border-color:var(--primary,#b4ea83)}.teeth button[data-player=model]{border-style:dashed}.bottom .actions{display:flex;gap:8px;margin-left:auto}.bottom{flex-wrap:wrap}
.score-label,.score-phase{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.score-meta{min-width:0;width:88px}.state{overflow-wrap:anywhere}
@container(max-width:360px){.score{gap:10px;padding:10px 12px}.score-value{font-size:28px}.score-meta{min-width:80px}}
@media(max-height:560px){.intro{padding-top:8px}.intro p{display:none}.teeth{gap:4px;padding-bottom:4px}.stage{min-height:140px}.bottom{padding-bottom:8px}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
`;

export async function mount(container, context) {
  const en = context.language.startsWith('en');
  const text = en
    ? {
        title: 'Shark bite',
        intro: 'One tooth is a trap. How far will you go?',
        start: 'Pick a tooth',
        safe: (n) => `${n} safe presses · choose another`,
        bitten: (n) => `Snap! ${n} safe presses this round`,
        again: 'New round',
        sound: 'Sound',
        muted: 'Muted',
        tooth: (n) => `Press tooth ${n}`,
        note: 'Your round is saved automatically',
        failed: 'Could not save this move. Try again.',
        unsupported: 'The 3D model could not be loaded. Try opening the game again.',
        loading: 'Opening the shark…',
      }
    : {
        title: '鲨鱼咬牙',
        intro: '藏着一颗坏牙，看看你能按下几颗。',
        start: '选一颗牙齿试试',
        safe: (n) => `安全按下 ${n} 颗 · 再选一颗`,
        bitten: (n) => `咬住啦！本局安全按下 ${n} 颗`,
        again: '再来一局',
        sound: '声音开',
        muted: '声音关',
        tooth: (n) => `按下第 ${n} 颗牙齿`,
        note: '当前对局自动保存',
        failed: '这一步未能保存，请重试。',
        unsupported: '三维模型加载失败，请重新打开游戏。',
        loading: '正在唤醒鲨鱼…',
      };
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('section');
  root.className = 'shark';
  root.setAttribute('aria-label', text.title);
  // 静态模板只插入插件内置文本；对局与宿主数据通过 textContent 写入。
  root.innerHTML = `<div class="intro"><div><h2>${text.title}</h2><p>${text.intro}</p></div><button class="sound" type="button">${text.sound}</button></div><div class="play-modes"><button class="solo-mode" type="button">${en ? 'Solo' : '单人游玩'}</button><button class="duo-mode" type="button">${en ? 'Play with character' : '角色陪玩'}</button></div><div class="score" hidden></div><div class="stage"></div><p class="state" role="status">${text.loading}</p><div class="teeth" role="group" aria-label="${text.start}"></div><p class="error" role="alert" hidden></p><div class="bottom"><small>${text.note}</small><div class="actions"><button type="button" class="quit" hidden>${en ? 'End game' : '结束游戏'}</button><button type="button" class="restart">${text.again}</button></div></div>`;
  const score = root.querySelector('.score');
  score.setAttribute('role', 'group');
  score.setAttribute('aria-label', en ? 'Match score' : '对局比分');
  score.innerHTML = `<div class="score-side" data-side="human"><span class="score-label">${en ? 'You' : '你'}</span><strong class="score-value">0</strong></div><div class="score-meta"><span class="score-round"></span><span class="score-phase"></span></div><div class="score-side" data-side="model"><span class="score-label">${en ? 'Character' : '角色'}</span><strong class="score-value">0</strong></div>`;
  container.append(style, root);
  const stage = root.querySelector('.stage'),
    label = root.querySelector('.state'),
    errorLabel = root.querySelector('.error'),
    restart = root.querySelector('.restart'),
    sound = root.querySelector('.sound');
  const scope = { mode: context.mode, sessionId: context.sessionId };
  const buttons = [];
  const soloMode = root.querySelector('.solo-mode'),
    duoMode = root.querySelector('.duo-mode'),
    scoreboard = root.querySelector('.score'),
    quit = root.querySelector('.quit');
  let match = null,
    duo = false,
    hostBusy = false,
    pollTimer,
    cancelRunState,
    refreshing = false;
  let disposed = false,
    busy = true,
    visible = false,
    muted = false,
    round,
    audio,
    model,
    jaw;
  let renderer, environment, observer, cancelVisibility;
  const teeth = [],
    allMeshes = [],
    tweens = new Map(),
    waits = new Set();
  const clickController = new AbortController();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 100);
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let pointerStart = null;
  function disposeModel(object) {
    object.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    clickController.abort();
    clearTimeout(pollTimer);
    cancelRunState?.();
    cancelVisibility?.();
    observer?.disconnect();
    for (const wait of waits) {
      clearTimeout(wait.timer);
      wait.resolve();
    }
    waits.clear();
    renderer?.setAnimationLoop(null);
    if (model) disposeModel(model);
    environment?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    void audio?.close().catch(() => {});
    tweens.clear();
    root.remove();
    style.remove();
  }
  context.signal.addEventListener('abort', cleanup, { once: true });
  function wait(ms) {
    return new Promise((resolve) => {
      const item = { resolve, timer: 0 };
      item.timer = setTimeout(() => {
        waits.delete(item);
        resolve();
      }, ms);
      waits.add(item);
    });
  }
  function tween(key, object, property, to, duration) {
    tweens.set(key, {
      object,
      property,
      from: object[property],
      to,
      duration,
      start: performance.now(),
    });
  }
  function frame() {
    if (disposed || !renderer) return;
    const now = performance.now();
    for (const [key, t] of tweens) {
      const p = Math.min(1, (now - t.start) / t.duration);
      t.object[t.property] = THREE.MathUtils.lerp(t.from, t.to, 1 - (1 - p) ** 3);
      if (p === 1) tweens.delete(key);
    }
    renderer.render(scene, camera);
  }
  function tone(bite = false) {
    if (!visible || muted || disposed) return;
    try {
      audio ??= new AudioContext();
      void audio.resume().catch(() => {});
      const oscillator = audio.createOscillator(),
        gain = audio.createGain(),
        now = audio.currentTime;
      oscillator.type = bite ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(bite ? 180 : 640, now);
      oscillator.frequency.exponentialRampToValueAtTime(bite ? 45 : 320, now + 0.12);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.18);
    } catch {
      /* 声音不可用时仍可继续游戏。 */
    }
  }
  function canPress() {
    return (
      !busy &&
      round?.status === 'playing' &&
      (duo ? hostBusy && match?.status === 'active' && match.turn === 'human' : !hostBusy)
    );
  }
  function update() {
    const companionName = context.characterName?.trim() || (en ? 'Character' : '角色');
    const companionLabel = scoreboard.querySelector('[data-side=model] .score-label');
    companionLabel.textContent = companionName;
    companionLabel.title = companionName;
    const ended = round?.status === 'bitten';
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !canPress() || round?.pressed.includes(i + 1);
      buttons[i].dataset.player = duo
        ? (match?.pressed.find((move) => move.tooth === i + 1)?.player ?? '')
        : '';
    }
    soloMode.disabled = busy || hostBusy;
    duoMode.disabled = busy || (hostBusy && !duo);
    soloMode.setAttribute('aria-pressed', String(!duo));
    duoMode.setAttribute('aria-pressed', String(duo));
    scoreboard.hidden = !duo || !match;
    quit.hidden = !duo || !match || match.status === 'ended';
    quit.disabled = busy;
    restart.disabled = busy || (duo ? hostBusy && match?.status !== 'waiting-replay' : hostBusy);
    restart.hidden =
      duo && hostBusy && match && !['waiting-replay', 'ended', 'paused'].includes(match.status);
    restart.textContent = duo
      ? match?.status === 'paused'
        ? en
          ? 'Continue game'
          : '继续陪玩'
        : text.again
      : text.again;
    quit.textContent =
      match?.status === 'waiting-replay'
        ? en
          ? 'Play later'
          : '下次再玩'
        : en
          ? 'End game'
          : '结束游戏';
    if (!round) return;
    if (duo && match) {
      const won =
        match.winner === 'human'
          ? en
            ? 'You win!'
            : '你赢啦！'
          : en
            ? `${companionName} wins!`
            : `${companionName}赢啦！`;
      scoreboard.querySelector('[data-side=human] .score-value').textContent = String(
        match.scores.human,
      );
      scoreboard.querySelector('[data-side=model] .score-value').textContent = String(
        match.scores.model,
      );
      scoreboard.querySelector('.score-round').textContent = en
        ? `Round ${match.roundNumber}`
        : `第 ${match.roundNumber} 局`;
      scoreboard.querySelector('.score-phase').textContent =
        match.status === 'paused'
          ? en
            ? 'Paused'
            : '已暂停'
          : match.status === 'ended'
            ? en
              ? 'Match ended'
              : '已结束'
            : ['round-over', 'waiting-replay'].includes(match.status)
              ? won
              : match.turn === 'human'
                ? en
                  ? 'Your turn'
                  : '你的回合'
                : en
                  ? `${companionName}’s turn`
                  : `${companionName}的回合`;
      scoreboard.querySelector('.score-phase').title =
        scoreboard.querySelector('.score-phase').textContent;
      scoreboard.dataset.highlight =
        match.status === 'active'
          ? match.turn
          : ['round-over', 'waiting-replay'].includes(match.status)
            ? match.winner
            : '';
      label.textContent =
        match.status === 'paused'
          ? en
            ? 'Paused · continue when ready'
            : '陪玩已暂停，点击继续可恢复当前对局'
          : match.status === 'ended'
            ? en
              ? 'Game ended · scores saved'
              : '陪玩已结束，比分已保存'
            : match.status === 'waiting-replay'
              ? `${won} ${en ? 'Another round?' : '再来一局吗？'}`
              : match.status === 'round-over'
                ? `${won} ${en ? `Waiting for ${companionName}…` : `等${companionName}说两句…`}`
                : match.turn === 'human'
                  ? en
                    ? 'Your turn · pick a tooth'
                    : '轮到你了，选一颗牙齿'
                  : en
                    ? `${companionName} is choosing…`
                    : `${companionName}正在选择牙齿…`;
      root.dataset.matchStatus = match.status;
      root.dataset.turn = match.turn ?? '';
      root.dataset.revision = String(match.revision);
    } else {
      label.textContent = hostBusy
        ? en
          ? 'Wait for the current response to finish'
          : '等当前回复结束后再玩'
        : ended
          ? text.bitten(Math.max(0, round.pressed.length - 1))
          : round.pressed.length
            ? text.safe(round.pressed.length)
            : text.start;
      delete root.dataset.matchStatus;
      delete root.dataset.turn;
    }
    label.dataset.bitten = String(ended);
    root.dataset.roundId = round.id;
    root.dataset.pressed = String(round.pressed.length);
    root.dataset.status = round.status;
  }
  async function applyMatch(next, animate = true) {
    if (!next || disposed) return;
    if (match?.matchId === next.matchId && next.revision < match.revision) return;
    const before = duo ? round : null;
    match = next;
    if (!duo) return;
    round = {
      id: next.roundId,
      pressed: next.pressed.map((move) => move.tooth),
      status: next.winner ? 'bitten' : 'playing',
    };
    if (!animate || !before || before.id !== round.id) {
      restore();
      update();
      return;
    }
    for (const number of round.pressed.filter((number) => !before.pressed.includes(number))) {
      const tooth = teeth[number - 1];
      if (tooth)
        tween(
          tooth.name,
          tooth.position,
          'y',
          tooth.userData.restY - tooth.userData.press_distance,
          140,
        );
      tone();
    }
    if (round.status === 'bitten' && before.status !== 'bitten' && jaw) {
      await wait(170);
      if (disposed) return;
      tween('jaw', jaw.rotation, 'x', 0, 170);
      tone(true);
    }
    update();
  }
  async function refreshMatch() {
    if (disposed || refreshing || busy || !visible) return;
    refreshing = true;
    try {
      const next = await context.command('load-match', scope);
      if (disposed || busy) return;
      if (next && hostBusy && !['paused', 'ended'].includes(next.status)) duo = true;
      await applyMatch(next);
    } catch {
      /* A failed refresh cannot advance the game. Explicit actions show errors. */
    } finally {
      refreshing = false;
    }
  }
  function poll() {
    void refreshMatch().finally(() => {
      if (!disposed) pollTimer = setTimeout(poll, 500);
    });
  }
  async function matchAction(action, tooth) {
    if (!match || busy || disposed) return;
    busy = true;
    errorLabel.hidden = true;
    update();
    try {
      const next = await context.command('match-action', {
        ...scope,
        matchId: match.matchId,
        roundId: match.roundId,
        revision: match.revision,
        action,
        ...(tooth ? { tooth } : {}),
      });
      await applyMatch(next);
    } catch {
      if (!disposed) {
        errorLabel.textContent = text.failed;
        errorLabel.hidden = false;
      }
      try {
        await applyMatch(await context.command('load-match', scope), false);
      } catch {
        /* Keep current state. */
      }
    } finally {
      if (!disposed) {
        busy = false;
        update();
      }
    }
  }
  async function startCompanion() {
    if (busy || hostBusy || disposed) return;
    busy = true;
    errorLabel.hidden = true;
    update();
    try {
      if (
        !(await context.startRun('start', en ? 'Play shark bite with me.' : '陪我玩鲨鱼咬牙吧。'))
      )
        throw new Error('start-failed');
    } catch {
      if (!disposed) {
        errorLabel.textContent = text.failed;
        errorLabel.hidden = false;
      }
    } finally {
      if (!disposed) {
        busy = false;
        update();
        void refreshMatch();
      }
    }
  }
  function restore() {
    if (!round || !jaw) return;
    tweens.clear();
    for (let i = 0; i < teeth.length; i++)
      teeth[i].position.y =
        teeth[i].userData.restY -
        (round.pressed.includes(i + 1) ? teeth[i].userData.press_distance : 0);
    jaw.rotation.x = round.status === 'bitten' ? 0 : THREE.MathUtils.degToRad(-33);
    frame();
  }
  async function press(number) {
    if (duo) {
      if (visible && canPress() && !round.pressed.includes(number))
        await matchAction('press', number);
      return;
    }
    if (hostBusy) return;
    if (
      disposed ||
      !visible ||
      busy ||
      !round ||
      round.status !== 'playing' ||
      round.pressed.includes(number)
    )
      return;
    busy = true;
    errorLabel.hidden = true;
    update();
    try {
      const next = await context.command('press-tooth', {
        ...scope,
        roundId: round.id,
        tooth: number,
      });
      if (disposed) return;
      round = next;
      const tooth = teeth[number - 1];
      tween(
        tooth.name,
        tooth.position,
        'y',
        tooth.userData.restY - tooth.userData.press_distance,
        140,
      );
      tone();
      await wait(170);
      if (disposed) return;
      if (round.status === 'bitten') {
        tween('jaw', jaw.rotation, 'x', 0, 170);
        tone(true);
        await wait(200);
      }
    } catch {
      if (disposed) return;
      errorLabel.textContent = text.failed;
      errorLabel.hidden = false;
      // 响应丢失时从持久记录核对结果，不重新抽牙、不重复落子。
      try {
        round = await context.command('load-round', scope);
        if (!disposed) restore();
      } catch {
        /* 保持错误提示，允许用户重试。 */
      }
    } finally {
      if (!disposed) {
        busy = false;
        update();
      }
    }
  }
  for (let i = 1; i <= 12; i++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(i);
    button.setAttribute('aria-label', text.tooth(i));
    button.dataset.tooth = String(i);
    button.disabled = true;
    button.addEventListener('click', () => void press(i), { signal: clickController.signal });
    buttons.push(button);
    root.querySelector('.teeth').append(button);
  }
  sound.addEventListener(
    'click',
    () => {
      muted = !muted;
      sound.textContent = muted ? text.muted : text.sound;
      sound.setAttribute('aria-pressed', String(!muted));
      if (muted) void audio?.suspend().catch(() => {});
    },
    { signal: clickController.signal },
  );
  restart.addEventListener(
    'click',
    async () => {
      if (duo) {
        if (match?.status === 'waiting-replay') await matchAction('replay');
        else await startCompanion();
        return;
      }
      if (hostBusy || busy || disposed || !round) return;
      busy = true;
      errorLabel.hidden = true;
      update();
      try {
        round = await context.command('new-round', { ...scope, roundId: round.id });
        if (!disposed) restore();
      } catch {
        if (!disposed) {
          errorLabel.textContent = text.failed;
          errorLabel.hidden = false;
          try {
            round = await context.command('load-round', scope);
            if (!disposed) restore();
          } catch {
            /* 下次操作继续核对。 */
          }
        }
      } finally {
        if (!disposed) {
          busy = false;
          update();
        }
      }
    },
    { signal: clickController.signal },
  );
  soloMode.addEventListener(
    'click',
    async () => {
      if (hostBusy || busy) return;
      busy = true;
      update();
      try {
        const saved = await context.command('load-round', scope);
        if (!disposed) {
          duo = false;
          round = saved;
          restore();
        }
      } catch {
        if (!disposed) {
          errorLabel.textContent = text.failed;
          errorLabel.hidden = false;
        }
      } finally {
        if (!disposed) {
          busy = false;
          update();
        }
      }
    },
    { signal: clickController.signal },
  );
  duoMode.addEventListener(
    'click',
    () => {
      if (busy || hostBusy) return;
      if (match) {
        duo = true;
        void applyMatch(match, false);
      } else void startCompanion();
    },
    { signal: clickController.signal },
  );
  quit.addEventListener('click', () => void matchAction('quit'), {
    signal: clickController.signal,
  });
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute('aria-label', text.title);
    stage.append(renderer.domElement);
    const generator = new THREE.PMREMGenerator(renderer),
      room = new RoomEnvironment();
    environment = generator.fromScene(room);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.8;
    room.dispose();
    generator.dispose();
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x364135, 0.6));
    const light = new THREE.DirectionalLight(0xfff3df, 1.8);
    light.position.set(-3, 5, 6);
    scene.add(light);
    const loaded = await new GLTFLoader().loadAsync(
      new URL('assets/game-shark.glb', context.resourceBase).href,
    );
    if (disposed) {
      disposeModel(loaded.scene);
      return cleanup;
    }
    model = loaded.scene;
    scene.add(model);
    jaw = model.getObjectByName('UpperJawPivot');
    model.traverse((o) => {
      if (o.isMesh) {
        allMeshes.push(o);
        if (/^Tooth_\d+$/.test(o.name)) {
          o.userData.restY = o.position.y;
          o.material = o.material.clone();
          teeth.push(o);
        }
      }
    });
    teeth.sort((a, b) => a.name.localeCompare(b.name));
    if (!jaw || teeth.length !== 12) throw new Error('invalid-shark-model');
    function resize() {
      const width = stage.clientWidth,
        height = stage.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const distance = Math.max(
        5.9,
        2.2 / (Math.tan(THREE.MathUtils.degToRad(37 / 2)) * camera.aspect),
      );
      camera.position.set(distance * 0.32, 1.1 + distance * 0.48, distance * 0.86);
      camera.lookAt(0, 1.2, 0.35);
      camera.updateProjectionMatrix();
      frame();
    }
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    function pick(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(allMeshes, false)[0]?.object;
      return hit && teeth.includes(hit) ? teeth.indexOf(hit) + 1 : null;
    }
    renderer.domElement.addEventListener(
      'pointerdown',
      (event) => {
        pointerStart = { x: event.clientX, y: event.clientY };
      },
      { signal: clickController.signal },
    );
    renderer.domElement.addEventListener(
      'pointerup',
      (event) => {
        if (
          !pointerStart ||
          Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8
        )
          return;
        pointerStart = null;
        const selected = pick(event);
        if (selected) void press(selected);
      },
      { signal: clickController.signal },
    );
    renderer.domElement.addEventListener(
      'pointermove',
      (event) => {
        const selected = pick(event);
        renderer.domElement.style.cursor =
          selected && canPress() && !round.pressed.includes(selected) ? 'pointer' : 'default';
        for (let i = 0; i < teeth.length; i++)
          teeth[i].material.emissive.setHex(
            selected === i + 1 && canPress() && !round.pressed.includes(i + 1) ? 0x293b11 : 0,
          );
      },
      { signal: clickController.signal },
    );
    round = await context.command('load-round', scope);
    const savedMatch = await context.command('load-match', scope);
    if (savedMatch) {
      duo = true;
      await applyMatch(savedMatch, false);
    }
    if (disposed) return cleanup;
    restore();
    busy = false;
    update();
    cancelRunState = context.onRunStateChange((value) => {
      hostBusy = value;
      update();
      void refreshMatch();
    });
    poll();
    cancelVisibility = context.onVisibilityChange((value) => {
      visible = value;
      root.dataset.visible = String(value);
      if (value) {
        void refreshMatch();
        resize();
        renderer.setAnimationLoop(frame);
        if (!muted && audio?.state === 'suspended') void audio.resume().catch(() => {});
      } else {
        renderer.setAnimationLoop(null);
        void audio?.suspend().catch(() => {});
      }
    });
    return cleanup;
  } catch (error) {
    cleanup();
    if (!context.signal.aborted) throw new Error(text.unsupported, { cause: error });
    return cleanup;
  }
}
