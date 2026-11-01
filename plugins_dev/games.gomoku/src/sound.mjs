// Reuse the browser's audio API; the packaged sample needs no runtime dependency.
export function createStoneSound(resourceBase) {
  let muted = false;
  try {
    muted = localStorage.getItem('games.gomoku.muted') === '1';
  } catch {}
  let audio,
    buffer,
    loading,
    resuming,
    generation = 0,
    disposed = false,
    visible = true;
  const sources = new Set();
  const controller = new AbortController();
  const stop = () => {
    generation++;
    for (const source of sources) source.stop();
    sources.clear();
  };
  const unlock = () => {
    if (disposed || muted || !visible) return;
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') resuming = audio.resume().catch(() => {});
      if (!loading) {
        const current = audio;
        loading = fetch(new URL('assets/stone.mp3', resourceBase), { signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error('sound-unavailable');
            return response.arrayBuffer();
          })
          .then((bytes) => current.decodeAudioData(bytes))
          .then((decoded) => {
            if (!disposed) buffer = decoded;
          })
          .catch(() => {
            loading = null;
          });
      }
    } catch {
      /* Audio availability never blocks the game. */
    }
  };
  return {
    get muted() {
      return muted;
    },
    unlock,
    play() {
      if (disposed || muted || !visible || !audio) return;
      const version = generation;
      void Promise.all([loading, resuming])
        .then(() => {
          if (
            version !== generation ||
            disposed ||
            muted ||
            !visible ||
            !buffer ||
            audio.state !== 'running'
          )
            return;
          const source = audio.createBufferSource();
          const gain = audio.createGain();
          source.buffer = buffer;
          gain.gain.value = 0.65;
          source.connect(gain).connect(audio.destination);
          sources.add(source);
          source.onended = () => {
            sources.delete(source);
            source.disconnect();
            gain.disconnect();
          };
          source.start();
        })
        .catch(() => {});
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem('games.gomoku.muted', muted ? '1' : '0');
      } catch {}
      if (muted) stop();
      else unlock();
    },
    setVisible(value) {
      visible = value;
      if (!visible) {
        stop();
        void audio?.suspend().catch(() => {});
      } else if (audio) unlock();
    },
    dispose() {
      disposed = true;
      controller.abort();
      stop();
      void audio?.close().catch(() => {});
    },
  };
}
