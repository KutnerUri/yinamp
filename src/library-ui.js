export function setupMusicLibrary({ onPlay, onSignIn, onLayout = () => {} }) {
  const $ = selector => document.querySelector(selector);
  const desktop = Boolean(window.yinampDesktop);
  let section = desktop ? 'mine' : 'discover', request = 0, opening = false, selected = '', signature;
  const cache = new Map();
  const captions = { mine: 'YOUR CREATED & SAVED MUSIC PLAYLISTS', mixes: 'MIXES FROM YOUR YOUTUBE MUSIC ACCOUNT', discover: 'MUSIC PLAYLISTS SUGGESTED BY YOUTUBE' };
  function message(text, error = false) { $('#library-message').textContent = text; $('#library-message').hidden = !text; $('#library-message').setAttribute('role', error ? 'alert' : 'status'); }
  function render() {
    const data = cache.get(section), filter = $('#library-filter').value.trim().toLocaleLowerCase();
    const items = (data?.items ?? []).filter(item => `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(filter));
    const root = $('#library-results'); root.replaceChildren();
    $('#library-count').textContent = data ? `${items.length} ${items.length === 1 ? 'PLAYLIST' : 'PLAYLISTS'}${data.partial ? ' · LOADED SO FAR' : ''}` : '';
    for (const item of items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `library-card${selected === item.id ? ' selected' : ''}`; button.disabled = opening; button.setAttribute('aria-label', `Play ${item.title}`);
      const art = document.createElement('span'); art.className = 'library-art'; art.textContent = '♪';
      if (item.thumbnail) { const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => { image.remove(); art.textContent = '♪'; }; art.replaceChildren(image); }
      const copy = document.createElement('span'); copy.className = 'library-card-copy';
      const title = document.createElement('span'); title.className = 'library-card-title'; title.textContent = item.title; title.title = item.title;
      const subtitle = document.createElement('span'); subtitle.className = 'library-card-subtitle'; subtitle.textContent = item.subtitle || (item.kind === 'mix' ? 'YouTube Mix' : 'Music playlist'); subtitle.title = subtitle.textContent;
      const play = document.createElement('span'); play.className = 'library-play'; play.textContent = '▶ PLAY';
      copy.append(title, subtitle, play); button.append(art, copy);
      button.onclick = async () => {
        if (opening) return;
        opening = true; render(); message(`Opening ${item.title}…`);
        try { const result = await onPlay(item); selected = item.id; message(`Playing ${item.title}.${result?.partial ? ' Loaded the available portion of this playlist.' : ''}`); }
        catch (error) { message(cleanError(error), true); }
        finally { opening = false; render(); }
      };
      root.append(button);
    }
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'library-empty'; empty.textContent = data ? filter ? 'No matching playlists.' : 'No music playlists were found in this view.' : 'Your music library will appear here.'; root.append(empty); }
    onLayout();
  }
  const cleanError = error => String(error.message || 'The music library could not load. Try refreshing.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  async function load(refresh = false) {
    const version = ++request, tab = section;
    $('#library-results').setAttribute('aria-busy', 'true'); $('#library-sign-in').hidden = true;
    message(tab === 'mine' ? 'Loading your playlists…' : tab === 'mixes' ? 'Loading your mixes…' : 'Finding music playlists…');
    try {
      let data = !refresh && cache.get(tab);
      if (!data) {
        if (desktop) {
          if (typeof window.yinampDesktop.library !== 'function') throw new Error('Restart Yinamp to load your music library.');
          data = await window.yinampDesktop.library({ action: 'browse', section: tab, refresh });
        } else {
          const response = await fetch('/api/library?section=discover'); data = await response.json();
          if (!response.ok) throw new Error(data.error);
        }
        if (version !== request) return;
        cache.set(tab, data);
      }
      if (version !== request) return;
      message(data.partial ? 'Showing playlists loaded from YouTube Music. Refresh for updated suggestions.' : 'Choose a playlist to replace the queue and start listening.');
    } catch (error) {
      if (version !== request) return;
      const text = cleanError(error); message(text, true); $('#library-sign-in').hidden = !desktop || !/sign in/i.test(text);
    } finally {
      if (version === request) { $('#library-results').setAttribute('aria-busy', 'false'); render(); }
    }
  }
  function select(tab) {
    section = tab; $('#library-filter').value = '';
    for (const button of document.querySelectorAll('[data-library-tab]')) { const active = button.dataset.libraryTab === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; }
    $('#library-results').setAttribute('aria-labelledby', `library-tab-${tab}`); $('#library-caption').textContent = captions[tab];
    render(); void load();
  }
  for (const button of document.querySelectorAll('[data-library-tab]')) {
    button.disabled = !desktop && button.dataset.libraryTab !== 'discover';
    if (button.disabled) button.title = 'Personal playlists and mixes use your desktop account.';
    button.onclick = () => select(button.dataset.libraryTab);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('[data-library-tab]')].filter(item => !item.disabled);
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next].focus(); select(tabs[next].dataset.libraryTab);
    };
  }
  $('#library-refresh').onclick = () => void load(true);
  $('#library-filter').oninput = render;
  $('#library-sign-in').onclick = onSignIn;
  select(section);
  return {
    accountChanged(value) {
      if (!['signed-in', 'signed-out'].includes(value.status)) return;
      const next = `${value.status}:${value.avatar?.split('=')[0] ?? ''}`;
      if (signature && signature !== next) { request++; cache.clear(); selected = ''; render(); void load(true); }
      signature = next;
    },
  };
}
