// Shared decorative indicator; the surrounding status supplies accessible text.
export function createLoader() {
  const loader = document.createElement('span');
  loader.className = 'segment-loader';
  loader.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 5; i++) loader.append(document.createElement('i'));
  return loader;
}

export function createLibrarySkeleton() {
  const card = document.createElement('div');
  card.className = 'library-card library-skeleton';
  card.setAttribute('aria-hidden', 'true');
  for (const className of ['library-art', 'skeleton-title', 'skeleton-subtitle', 'skeleton-action']) {
    const part = document.createElement('span');
    part.className = className;
    card.append(part);
  }
  return card;
}
