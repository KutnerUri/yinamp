import { libraryAccountIdentity, libraryAccountChanged } from './library-account.js';
import { createLoader, createLibrarySkeleton } from './loading-ui.js';
import { PlaylistCache } from './playlist-cache.js';

export function setupMusicLibrary({ onPlay, onSignIn, onLayout = () => {}, activePlaylist = null }) {
  const $ = selector => document.querySelector(selector);
  const desktop = Boolean(window.yinampDesktop);
  let section = desktop ? 'mine' : 'discover', request = 0, opening = null, loading = false, selected = activePlaylist, signature, visibleData = null;
  const cache = new PlaylistCache();
  const captions = { mine: 'YOUR CREATED & SAVED MUSIC PLAYLISTS', mixes: 'MIXES FROM YOUR YOUTUBE MUSIC ACCOUNT', discover: desktop ? 'PLAYLISTS FROM YOUR YOUTUBE MUSIC HOME FEED' : 'COMMUNITY & FEATURED MUSIC PLAYLISTS' };
  function message(text, error = false) { $('#library-message').replaceChildren(...(loading ? [createLoader()] : []), document.createTextNode(text)); $('#library-message').hidden = !text; $('#library-message').setAttribute('role', error ? 'alert' : 'status'); }
  function updateCards() {
    for (const button of document.querySelectorAll('#library-results button.library-card')) {
      const current = selected?.id === button.dataset.playlistId;
      const busy = opening === button.dataset.playlistId;
      button.disabled = Boolean(opening);
      button.classList.toggle('selected', current);
      button.classList.toggle('opening', busy);
      button.setAttribute('aria-busy', String(busy));
      if (current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      const play = button.querySelector('.library-play');
      if (busy && !play.querySelector('.segment-loader')) play.replaceChildren(createLoader(), document.createTextNode('OPENING…'));
      else if (!busy) play.textContent = current ? '✓ IN QUEUE' : '▶ PLAY';
    }
  }
  function render() {
    const data = visibleData, filter = $('#library-filter').value.trim().toLocaleLowerCase();
    const items = (data?.items ?? []).filter(item => `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(filter));
    const root = $('#library-results'); root.replaceChildren();
    $('#library-count').textContent = data ? `${items.length} ${items.length === 1 ? 'PLAYLIST' : 'PLAYLISTS'}${data.partial ? ' · LOADED SO FAR' : ''}` : '';
    for (const item of items) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.playlistId = item.id; button.className = `library-card${selected?.id === item.id ? ' selected' : ''}`; button.disabled = Boolean(opening); button.classList.toggle('opening', opening === item.id); button.setAttribute('aria-busy', String(opening === item.id)); if (selected?.id === item.id) button.setAttribute('aria-current', 'true'); button.setAttribute('aria-label', `Play ${item.title}`);
      const art = document.createElement('span'); art.className = 'library-art'; art.textContent = '♪';
      if (item.thumbnail) { const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => { image.remove(); art.textContent = '♪'; }; art.replaceChildren(image); }
      const copy = document.createElement('span'); copy.className = 'library-card-copy';
      const title = document.createElement('span'); title.className = 'library-card-title'; title.textContent = item.title; title.title = item.title;
      const subtitle = document.createElement('span'); subtitle.className = 'library-card-subtitle'; subtitle.textContent = item.subtitle || (item.kind === 'mix' ? 'YouTube Mix' : 'Music playlist'); subtitle.title = subtitle.textContent;
      const play = document.createElement('span'); play.className = 'library-play'; play.textContent = selected?.id === item.id ? '✓ IN QUEUE' : '▶ PLAY';
      if (opening === item.id) { play.replaceChildren(createLoader(), document.createTextNode('OPENING…')); }
      copy.append(title, subtitle, play); button.append(art, copy);
      button.onclick = async () => {
        if (opening) return;
        const openingRequest = request; opening = item.id; updateCards(); message(`Opening ${item.title}…`);
        try { const result = await onPlay(item); if (openingRequest === request) message(`Playing ${item.title}.${result?.partial ? ' Loaded the available portion of this playlist.' : ''}`); }
        catch (error) { if (openingRequest === request) message(cleanError(error), true); }
        finally { if (opening === item.id) { opening = null; updateCards(); } }
      };
      root.append(button);
    }
    if (!data && loading) { for (let i = 0; i < 8; i++) root.append(createLibrarySkeleton()); }
    else if (!items.length) { const empty = document.createElement('div'); empty.className = 'library-empty'; empty.textContent = data ? filter ? 'No matching playlists.' : 'No music playlists were found in this view.' : 'Your music library will appear here.'; root.append(empty); }
    onLayout();
  }
  const cleanError = error => String(error.message || 'The music library could not load. Try refreshing.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  async function load(refresh = false) {
    if (refresh) cache.clear();
    const version = ++request, tab = section;
    loading = true; $('#library-panel').classList.add('library-loading'); $('#library-refresh').disabled = true; render();
    $('#library-results').setAttribute('aria-busy', 'true'); $('#library-sign-in').hidden = true;
    message(tab === 'mine' ? 'Loading your playlists…' : tab === 'mixes' ? 'Loading your mixes…' : 'Finding music playlists…');
    try {
      let data = !refresh && cache.get(tab);
      if (!data) {
        if (desktop) {
          if (typeof window.yinampDesktop.library !== 'function') throw new Error('Restart Yinamp to load your music library.');
          data = await window.yinampDesktop.library({ action: 'browse', section: tab, refresh });
        } else {
          const response = await fetch(`/api/library?section=discover${refresh ? '&refresh=1' : ''}`); data = await response.json();
          if (!response.ok) throw new Error(data.error);
        }
        if (version !== request) return;
        cache.set(tab, data);
      }
      if (version !== request) return;
      visibleData = data; loading = false;
      message(data.ownerFilterUnavailable ? 'Your channel identity could not be verified, so owner filtering was not applied. Refresh to retry.' : data.partial ? 'Showing the available portion of this collection. Refresh to retry loading more.' : 'Choose a playlist to replace the queue and start listening.');
    } catch (error) {
      if (version !== request) return;
      loading = false;
      if (error.code === 'LIBRARY_CANCELLED') { message(''); return; }
      const text = cleanError(error); message(text, true); $('#library-sign-in').hidden = !desktop || !/sign in/i.test(text);
    } finally {
      if (version === request) { loading = false; $('#library-panel').classList.remove('library-loading'); $('#library-refresh').disabled = false; $('#library-results').setAttribute('aria-busy', 'false'); render(); }
    }
  }
  function select(tab) {
    section = tab; visibleData = cache.get(tab) ?? null; $('#library-filter').value = '';
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
    setActivePlaylist(value) {
      if (selected?.id === value?.id && selected?.title === value?.title) return;
      selected = value; updateCards();
    },
    accountChanged(value) {
      if (value.switching) { request++; opening = null; loading = false; $('#library-panel').classList.remove('library-loading'); $('#library-refresh').disabled = false; $('#library-results').setAttribute('aria-busy', 'false'); cache.clear(); visibleData = null; render(); message('Switching channel…'); return; }
      if (!['signed-in', 'signed-out'].includes(value.status)) return;
      const next = libraryAccountIdentity(value);
      const changed = libraryAccountChanged(signature, next);
      if (changed) { request++; cache.clear(); visibleData = null; render(); void load(true); }
      signature = { ...next, avatar: next.avatar ?? (changed ? null : signature?.avatar) };
    },
  };
}
