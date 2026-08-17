// Photo gallery (profile page) + auto-submitting filter bar (dashboard).

document.querySelectorAll('[data-autosubmit] select').forEach((select) => {
  select.addEventListener('change', () => select.form.submit());
});

document.querySelectorAll('[data-gallery]').forEach((gallery) => {
  const main = gallery.querySelector('[data-gallery-main]');
  const thumbs = [...gallery.querySelectorAll('.gallery-thumb')];
  if (!main || thumbs.length === 0) return;
  let current = 0;

  function show(index) {
    current = (index + thumbs.length) % thumbs.length;
    main.src = thumbs[current].dataset.full;
    thumbs.forEach((t, i) => t.classList.toggle('active', i === current));
  }

  thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => show(i)));
  gallery.querySelector('[data-gallery-prev]')?.addEventListener('click', () => show(current - 1));
  gallery.querySelector('[data-gallery-next]')?.addEventListener('click', () => show(current + 1));
});
