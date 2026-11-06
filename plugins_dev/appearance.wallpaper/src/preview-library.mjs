// Preview-card layout follows dsh-wallpaper-engine's picker-modal.js. Rendering
// stays native here; IntersectionObserver bounds loading to the visible library.
export function mountPreviewLibrary(library, { t, command, onSelect, signal }) {
  const cards = new Map();
  const cache = new Map();
  const queue = new Set();
  let active = 0,
    disposed = false,
    supported = true;
  const kinds = {
    image: t('图片', 'Image'),
    video: t('视频', 'Video'),
    web: t('网页', 'Web'),
    scene: t('场景', 'Scene'),
  };
  const placeholder = (card, message) => {
    card.image.hidden = true;
    card.image.removeAttribute('src');
    card.placeholder.hidden = false;
    card.placeholder.textContent = message;
  };
  function show(card, src) {
    if (!src) {
      placeholder(card, t('暂无预览', 'No preview'));
      return;
    }
    card.image.onload = () => {
      if (disposed || !card.visible) return;
      card.image.hidden = false;
      card.placeholder.hidden = true;
    };
    card.image.onerror = () => placeholder(card, t('暂无预览', 'No preview'));
    card.image.src = src;
  }
  function enqueue(card) {
    if (!supported) {
      placeholder(card, t('更新 LimeA 显示预览', 'Update LimeA for previews'));
    } else if (cache.has(card.id)) {
      const src = cache.get(card.id);
      cache.delete(card.id);
      cache.set(card.id, src);
      show(card, src);
    } else if (!card.loading) {
      queue.add(card);
      pump();
    }
  }
  function pump() {
    while (!disposed && active < 2 && queue.size) {
      const card = queue.values().next().value;
      queue.delete(card);
      if (!card.visible || !cards.has(card.id)) continue;
      active++;
      card.loading = true;
      const generation = card.generation;
      void command('preview', card.id)
        .then((result) => {
          if (disposed || generation !== card.generation || cards.get(card.id) !== card) return;
          const src =
            typeof result?.src === 'string' && result.src.startsWith('data:image/webp;base64,')
              ? result.src
              : null;
          cache.set(card.id, src);
          while (cache.size > 96) cache.delete(cache.keys().next().value);
          if (card.visible) show(card, src);
        })
        .catch(() => {
          if (!disposed && card.visible)
            placeholder(card, t('预览加载失败', 'Preview unavailable'));
        })
        .finally(() => {
          active--;
          card.loading = false;
          if (!disposed && generation !== card.generation && card.visible) enqueue(card);
          pump();
        });
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const card = cards.get(entry.target.dataset.id);
        if (!card) continue;
        card.visible = entry.isIntersecting;
        if (card.visible) enqueue(card);
        else {
          queue.delete(card);
          placeholder(card, t('正在加载预览…', 'Loading preview…'));
        }
      }
    },
    { root: library, rootMargin: '80px' },
  );
  function createCard(item) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'listitem');
    wrapper.dataset.id = item.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wallpaper-item';
    button.dataset.id = item.id;
    const cover = document.createElement('span');
    cover.className = 'wallpaper-cover';
    const image = document.createElement('img');
    image.alt = '';
    image.hidden = true;
    image.decoding = 'async';
    image.draggable = false;
    const empty = document.createElement('span');
    empty.className = 'wallpaper-placeholder';
    empty.textContent = t('正在加载预览…', 'Loading preview…');
    const kind = document.createElement('span');
    kind.className = 'wallpaper-type';
    const selected = document.createElement('span');
    selected.className = 'wallpaper-selected';
    selected.setAttribute('aria-hidden', 'true');
    selected.textContent = t('✓ 已选', '✓ Selected');
    const name = document.createElement('span');
    name.className = 'wallpaper-title';
    cover.append(image, empty, kind, selected);
    button.append(cover, name);
    button.onclick = () => onSelect(item.id);
    wrapper.append(button);
    const card = {
      id: item.id,
      wrapper,
      button,
      image,
      placeholder: empty,
      name,
      kind,
      selected,
      visible: false,
      loading: false,
      generation: 0,
    };
    cards.set(item.id, card);
    library.append(wrapper);
    observer.observe(wrapper);
    return card;
  }
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    queue.clear();
    for (const card of cards.values()) card.image.removeAttribute('src');
    cards.clear();
    cache.clear();
  };
  signal.addEventListener('abort', destroy, { once: true });
  return {
    update(items, current, previewsSupported) {
      if (disposed) return;
      supported = previewsSupported !== false;
      library.querySelector('.library-empty')?.remove();
      const ids = new Set(items.map((item) => item.id));
      for (const [id, card] of cards) {
        if (ids.has(id)) continue;
        observer.unobserve(card.wrapper);
        queue.delete(card);
        card.wrapper.remove();
        cards.delete(id);
        cache.delete(id);
      }
      for (const item of items) {
        const card = cards.get(item.id) ?? createCard(item);
        card.name.textContent = item.title;
        card.kind.textContent = kinds[item.type] ?? item.type;
        card.button.title = item.title;
        card.button.setAttribute('aria-label', `${item.title} · ${card.kind.textContent}`);
        card.button.setAttribute('aria-pressed', String(item.id === current));
        card.selected.hidden = item.id !== current;
      }
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'library-empty';
        empty.textContent = t(
          '还没有壁纸，选择文件或扫描已订阅的工坊库。',
          'No wallpapers yet. Choose a file or scan your subscribed workshop library.',
        );
        library.append(empty);
      }
    },
    refresh() {
      cache.clear();
      for (const card of cards.values()) {
        card.generation++;
        if (card.visible) enqueue(card);
      }
    },
    destroy,
  };
}
