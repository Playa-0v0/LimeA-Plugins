import { createScene, httpSource } from 'webwallgl';
const stage = document.getElementById('wallpaper');
let engine,
  media,
  identity,
  settings,
  visible = true,
  owner;
const send = (type, extra = {}) => parent.postMessage({ wallpaper: true, type, ...extra }, '*');
const dispose = () => {
  engine?.destroy();
  engine = null;
  if (media?.tagName === 'VIDEO') {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  media = null;
  stage.replaceChildren();
};
function controls() {
  if (!settings) return;
  const paused = settings.paused || !visible;
  if (engine) {
    engine.setFps(settings.fps);
    engine.setFit(settings.fit);
    paused ? engine.pause() : engine.resume();
  }
  if (media) {
    media.style.objectFit = settings.fit === 'stretch' ? 'fill' : settings.fit;
    if (media.tagName === 'VIDEO') {
      if (paused) media.pause();
      else void media.play().catch((e) => send('error', { message: e.message }));
    }
  }
}
window.addEventListener('message', async (event) => {
  if (event.source !== parent || event.data?.wallpaper !== true) return;
  if (owner && owner !== event.origin) return;
  owner = event.origin;
  const data = event.data;
  if (data.type !== 'configure') return;
  settings = data.settings;
  visible = data.visible;
  const { item } = data;
  if (identity === item.id) {
    controls();
    return;
  }
  identity = item.id;
  dispose();
  const id = identity;
  try {
    const source = new URL(item.file.split('/').map(encodeURIComponent).join('/'), item.base).href;
    if (item.type === 'image' || item.type === 'video') {
      media = document.createElement(item.type === 'image' ? 'img' : 'video');
      const element = media;
      element.style.cssText = 'width:100%;height:100%;display:block';
      if (item.type === 'video') {
        element.muted = true;
        element.loop = true;
        element.playsInline = true;
      }
      element.addEventListener(
        item.type === 'image' ? 'load' : 'loadeddata',
        () => {
          if (id === identity) {
            controls();
            send('ready');
          }
        },
        { once: true },
      );
      element.onerror = () =>
        send('error', { message: '媒体无法解码或文件已移动 / Media unavailable' });
      element.src = source;
      stage.append(element);
      controls();
    } else {
      engine = createScene(stage, {
        fit: settings.fit,
        fps: settings.fps,
        volume: 0,
        audio: null,
        media: null,
        autoplay: visible && !settings.paused,
      });
      engine.on('error', (e) => send('error', { message: e.message }));
      await engine.load(httpSource(item.base.replace(/\/$/, '')));
      if (identity === id) {
        controls();
        send('ready');
      }
    }
  } catch (error) {
    send('error', { message: error.message });
  }
});
window.addEventListener('pagehide', dispose);
send('boot');
