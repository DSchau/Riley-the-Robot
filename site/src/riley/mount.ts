// Tiny loader: three.js and the model are only fetched once a Riley is about
// to scroll into view, so pages stay light until the robot is needed.
const els = [...document.querySelectorAll<HTMLElement>('[data-riley]')];

// No WebGL, no problem: show the illustration instead.
function fallBack(el: HTMLElement) {
  el.classList.remove('riley3d-loading');
  const src = el.dataset.fallback;
  if (!src || el.querySelector(':scope > .riley3d-fallback')) return;
  const img = new Image();
  img.className = 'riley3d-fallback';
  img.alt = '';
  img.decoding = 'async';
  img.src = src;
  el.append(img);
}

if (els.length) {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      // The chest light glows while the rest of Riley is on the way.
      els.forEach((el) => el.classList.add('riley3d-loading'));
      import('./stage').then(
        ({ mount }) => els.forEach((el) => mount(el) || fallBack(el)),
        () => els.forEach(fallBack),
      );
    },
    { rootMargin: '900px' },
  );
  els.forEach((el) => io.observe(el));
}
