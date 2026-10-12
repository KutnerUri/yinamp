const videoPattern = /^[\w-]{11}$/;
export const YOUTUBE_PARTITION = 'persist:yinamp-youtube';
export const INTERFACE_PARTITION = 'persist:yinamp-interface';
export function isAccountURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (isYouTubeURL(value) || ['accounts.google.com', 'myaccount.google.com', 'consent.google.com'].includes(url.hostname) || url.hostname === 'www.google.com' && url.pathname.startsWith('/accounts/')); } catch { return false; }
}
export function accountURL(action) {
  if (action === 'open') return 'https://www.youtube.com/account';
  if (action === 'switch') return 'https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fwww.youtube.com%2F';
  throw new Error('Unsupported account action');
}
export function watchURL(id, start = 0) {
  if (!videoPattern.test(id ?? '')) throw new Error('Invalid YouTube video ID');
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', id);
  if (Number.isFinite(start) && start > 0) url.searchParams.set('t', String(Math.min(86400, Math.floor(start))));
  return url.href;
}
export function isYouTubeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')); } catch { return false; }
}
export function isExternalURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (isYouTubeURL(value) || ['accounts.google.com', 'consent.google.com'].includes(url.hostname)); } catch { return false; }
}
export function viewBounds(value, viewport) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('Invalid video panel bounds');
  const x = Math.max(0, Math.min(viewport.width, Math.round(value.x)));
  const y = Math.max(0, Math.min(viewport.height, Math.round(value.y)));
  return { x, y, width: Math.max(0, Math.min(viewport.width - x, Math.round(value.width))), height: Math.max(0, Math.min(viewport.height - y, Math.round(value.height))) };
}
export function validateCommand(command) {
  if (!command || !['initialize', 'load', 'play', 'pause', 'stop', 'seek', 'volume', 'fullscreen'].includes(command.type)) throw new Error('Unsupported player command');
  if (command.type === 'load' && command.id !== null) watchURL(command.id, command.start);
  if (['seek', 'volume'].includes(command.type) && (!Number.isFinite(command.value) || command.value < 0 || command.value > (command.type === 'volume' ? 100 : 604800))) throw new Error('Invalid player value');
  return command;
}
