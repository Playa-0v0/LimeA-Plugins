// Small Web Audio adapter, following the existing game's unlock/cancellation pattern.
export function createDrawingSound(resourceBase) {
  const key = 'games.draw_guess.audio';
  let preferences = { enabled: true, pencil: true, volume: 0.35 };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof saved?.enabled === 'boolean') preferences.enabled = saved.enabled;
    if (typeof saved?.pencil === 'boolean') preferences.pencil = saved.pencil;
    if (Number.isFinite(saved?.volume)) preferences.volume = Math.max(0, Math.min(1, saved.volume));
  } catch {}
  let context, master, loading, loop, stopTimer;
  let disposed = false,
    visible = true,
    generation = 0,
    movingUntil = 0,
    lastErase = 0;
  const buffers = new Map(),
    active = new Set(),
    pendingShots = new Set();
  const requests = new AbortController();
  function stopLoop() {
    movingUntil = 0;
    clearTimeout(stopTimer);
    if (!loop || !context) return;
    const { source, gain } = loop;
    loop = null;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.035);
    source.stop(context.currentTime + 0.04);
  }
  function stopAll() {
    generation++;
    stopLoop();
    for (const source of active) {
      try {
        source.stop();
      } catch {}
    }
    active.clear();
    pendingShots.clear();
  }
  function unlock() {
    if (disposed || !visible || !preferences.enabled) return;
    try {
      if (!context) {
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = preferences.volume;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') void context.resume().catch(() => {});
      if (!loading)
        loading = Promise.all(
          ['pencil', 'erase', 'fill', 'undo', 'redo'].map(async (name) => {
            try {
              const response = await fetch(new URL(`assets/audio/${name}.ogg`, resourceBase), {
                signal: requests.signal,
              });
              if (!response.ok) return;
              const buffer = await context.decodeAudioData(await response.arrayBuffer());
              if (!disposed) buffers.set(name, buffer);
            } catch {
              /* Sound availability does not block drawing. */
            }
          }),
        );
    } catch {
      /* Unsupported audio remains silent. */
    }
  }
  function start(name, repeat = false) {
    if (!context || context.state !== 'running' || !buffers.has(name)) return null;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffers.get(name);
    source.loop = repeat;
    gain.gain.value = repeat ? 0 : 0.65;
    source.connect(gain).connect(master);
    active.add(source);
    source.onended = () => {
      active.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
    if (repeat) gain.gain.linearRampToValueAtTime(0.5, context.currentTime + 0.025);
    return { source, gain };
  }
  function interaction(event) {
    if (event === 'stroke-end') {
      stopLoop();
      return;
    }
    if (disposed || !visible || !preferences.enabled || preferences.volume === 0) return;
    unlock();
    if (!loading) return;
    const token = generation;
    if (event === 'stroke') {
      if (!preferences.pencil) return;
      movingUntil = performance.now() + 110;
      clearTimeout(stopTimer);
      stopTimer = setTimeout(stopLoop, 110);
      void loading.then(() => {
        if (
          disposed ||
          token !== generation ||
          !visible ||
          !preferences.enabled ||
          !preferences.pencil ||
          performance.now() >= movingUntil ||
          loop
        )
          return;
        loop = start('pencil', true);
      });
      return;
    }
    if (!['erase', 'fill', 'undo', 'redo'].includes(event)) return;
    if (event === 'erase') {
      if (performance.now() - lastErase < 100) return;
      lastErase = performance.now();
    }
    if (pendingShots.has(event)) return;
    pendingShots.add(event);
    const expires = performance.now() + 250;
    void loading.then(() => {
      pendingShots.delete(event);
      if (
        disposed ||
        token !== generation ||
        !visible ||
        !preferences.enabled ||
        performance.now() > expires ||
        active.size >= 4
      )
        return;
      start(event);
    });
  }
  return {
    get preferences() {
      return { ...preferences };
    },
    unlock,
    interaction,
    configure(patch) {
      preferences = { ...preferences, ...patch };
      preferences.volume = Math.max(0, Math.min(1, preferences.volume));
      if (!preferences.enabled || preferences.volume === 0) stopAll();
      else {
        if (!preferences.pencil) stopLoop();
        unlock();
      }
      if (master) master.gain.value = preferences.volume;
      try {
        localStorage.setItem(key, JSON.stringify(preferences));
      } catch {}
    },
    setVisible(value) {
      visible = value;
      if (!value) {
        stopAll();
        void context?.suspend().catch(() => {});
      }
      // Unlock again on a real user gesture, never restart a previous sound.
    },
    dispose() {
      disposed = true;
      requests.abort();
      stopAll();
      void context?.close().catch(() => {});
    },
  };
}
