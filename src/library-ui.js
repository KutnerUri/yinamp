import { musicResultURL } from './search-all-data.js';
import { libraryAccountIdentity, libraryAccountChanged } from './library-account.js';
import { createLoader, createLibrarySkeleton } from './loading-ui.js';
import { PlaylistCache } from './playlist-cache.js';

export function setupMusicLibrary({ onPlay, onSong, onSignIn, pinnedSearches = [], onPinsChanged, onLayout = () => {}, activePlaylist = null }) {
  const $ = selector => document.querySelector(selector);
  const desktop = Boolean(window.yinampDesktop);
  let section = desktop ? 'mine' : 'discover', request = 0, opening = null, loading = false, selected = activePlaylist, signature, visibleData = null;
  const cache = new PlaylistCache();
  const searchSession = crypto.randomUUID();
  let activeSearch = null;
  const searches = new Map(), views = new Map();
  let serial = 0;
  // Persist only pinned search definitions; results and view state stay in memory.
  const pinsKey = 'yinamp.search-pins.v1';
  try {
    const saved = desktop ? pinnedSearches : JSON.parse(localStorage.getItem(pinsKey) || '[]');
    if (Array.isArray(saved)) for (const value of saved) {
      if (typeof value?.query === 'string' && value.query.trim() && value.query.length <= 200 && ['all', 'playlists', 'songs'].includes(value.type)) addSearch(value.query, true, 'all');
    }
  } catch {}
  function savePins() {
    const pins = [...searches.values()].filter(tab => tab.pinned).map(({ query, type }) => ({ query, type }));
    if (desktop) onPinsChanged?.(pins);
    else try { localStorage.setItem(pinsKey, JSON.stringify(pins)); } catch {}
  }
  function addSearch(query, pinned = false, type = 'all') {
    const id = `search-${++serial}`, tab = { query, pinned, type, pages: 1 };
    searches.set(id, tab);
    const wrapper = document.createElement('span'); wrapper.className = 'search-tab';
    const button = document.createElement('button'); button.type = 'button'; button.id = `library-tab-${id}`; button.dataset.libraryTab = id; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'library-results'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
    button.className = 'search-tab-label'; button.textContent = query; button.onclick = () => select(id);
    const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'search-tab-pin';
    const updatePin = () => { pin.textContent = tab.pinned ? '◆' : '◇'; pin.setAttribute('aria-label', `${tab.pinned ? 'Unpin' : 'Pin'} search ${query}`); pin.setAttribute('aria-pressed', String(tab.pinned)); wrapper.classList.toggle('pinned', tab.pinned); };
    pin.onclick = () => { tab.pinned = !tab.pinned; updatePin(); savePins(); }; updatePin();
    const close = document.createElement('button'); close.type = 'button'; close.className = 'search-tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `Close search ${query}`);
    close.onclick = () => { const active = section === id; searches.delete(id); views.delete(id); wrapper.remove(); savePins(); if (active) select(desktop ? 'mine' : 'discover'); onLayout(); };
    wrapper.append(button, pin, close); $('.library-tabs').append(wrapper); return id;
  }
  const more = document.createElement('button'); more.type = 'button'; more.className = 'metal small-button search-more'; more.textContent = 'LOAD MORE'; more.hidden = true;
  more.onclick = () => { const tab = searches.get(section); if (tab && tab.pages < 10) { tab.pages++; void load(); } }; $('#library-results').after(more);

  const captions = { mine: 'YOUR CREATED & SAVED MUSIC PLAYLISTS', mixes: 'MIXES FROM YOUR YOUTUBE MUSIC ACCOUNT', discover: desktop ? 'PLAYLISTS FROM YOUR YOUTUBE MUSIC HOME FEED' : 'COMMUNITY & FEATURED MUSIC PLAYLISTS' };
  function message(text, error = false) { $('#library-message').replaceChildren(...(loading ? [createLoader()] : []), document.createTextNode(text)); $('#library-message').hidden = !text; $('#library-message').setAttribute('role', error ? 'alert' : 'status'); }
  function updateCards() {
    for (const button of document.querySelectorAll('.song-actions button')) button.disabled = Boolean(opening);
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
      if (!play) continue;
      if (busy && !play.querySelector('.segment-loader')) play.replaceChildren(createLoader(), document.createTextNode('OPENING…'));
      else if (!busy) play.textContent = current ? '✓ IN QUEUE' : '▶ PLAY';
    }
  }
  function render() {
    const tab = searches.get(section);
    more.hidden = !tab || !visibleData?.partial || tab.pages >= 10; more.disabled = loading;
    const clear = $('#library-filter-clear'); if (clear) clear.hidden = !$('#library-filter').value;
    const data = visibleData, filter = $('#library-filter').value.trim().toLocaleLowerCase();
    const items = (data?.items ?? []).filter(item => `${item.title} ${item.subtitle ?? ''}`.toLocaleLowerCase().includes(filter));
    const root = $('#library-results'), scroll = root.scrollTop; root.replaceChildren();
    $('#library-count').textContent = data ? `${items.length} ${tab ? items.length===1?'RESULT':'RESULTS' : items.length === 1 ? 'PLAYLIST' : 'PLAYLISTS'}${data.partial ? ' · LOADED SO FAR' : ''}` : '';
    for (const item of items) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.playlistId = item.id; button.className = `library-card${selected?.id === item.id ? ' selected' : ''}`; button.disabled = Boolean(opening); button.classList.toggle('opening', opening === item.id); button.setAttribute('aria-busy', String(opening === item.id)); if (selected?.id === item.id) button.setAttribute('aria-current', 'true'); button.setAttribute('aria-label', `Play ${item.title}`);
      if(item.topResult)button.classList.add('top-result');
      const art = document.createElement('span'); art.className = 'library-art'; art.textContent = '♪';
      if (item.thumbnail) { const image = document.createElement('img'); image.src = item.thumbnail; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => { image.remove(); art.textContent = '♪'; }; art.replaceChildren(image); }
      const copy = document.createElement('span'); copy.className = 'library-card-copy';
      const title = document.createElement('span'); title.className = 'library-card-title'; title.textContent = item.title; title.title = item.title;
      const subtitle = document.createElement('span'); subtitle.className = 'library-card-subtitle'; subtitle.textContent = item.subtitle || (['song','video','artist','album','profile'].includes(item.kind) ? '' : item.kind === 'mix' ? 'YouTube Mix' : 'Music playlist'); subtitle.title = subtitle.textContent;
      const play = document.createElement('span'); play.className = 'library-play'; play.textContent = selected?.id === item.id ? '✓ IN QUEUE' : '▶ PLAY';
      if (opening === item.id) { play.replaceChildren(createLoader(), document.createTextNode('OPENING…')); }
      if(tab){const kind=document.createElement('span');kind.className='search-result-kind';kind.textContent=`${item.topResult?'TOP RESULT · ':''}${item.kind.toUpperCase()}`;copy.append(kind);}
      copy.append(title, subtitle, play); button.append(art, copy);
      button.onclick = async () => {
        if (opening) return;
        const openingRequest = request; opening = item.id; updateCards(); message(`Opening ${item.title}…`);
        try { const result = await onPlay(item); if (openingRequest === request) message(`Playing ${item.title}.${result?.partial ? ' Loaded the available portion of this playlist.' : ''}`); }
        catch (error) { if (openingRequest === request) message(cleanError(error), true); }
        finally { if (opening === item.id) { opening = null; updateCards(); } }
      };
      if (['song','video','artist','album','profile'].includes(item.kind)) {
        const card = document.createElement('div'); card.className = `library-card song-card${item.topResult?' top-result':''}`;
        const actions = document.createElement('span'); actions.className = 'song-actions';
        for (const [label, autoplay] of (['song','video'].includes(item.kind) ? [['▶ PLAY NOW', true], ['+ QUEUE', false]] : [['OPEN IN YOUTUBE MUSIC', null]])) {
          const action = document.createElement('button'); action.type = 'button'; action.textContent = label; action.setAttribute('aria-label', `${autoplay===null?'Open in YouTube Music':autoplay ? 'Play' : 'Add to queue'} ${item.title}`);
          action.disabled = Boolean(opening); action.onclick = () => { if (opening) return; try { if(autoplay===null){const url=musicResultURL(item);if(desktop)void window.yinampDesktop.openMusicResult(item).catch(error=>message(cleanError(error),true));else window.open(url,'_blank','noopener');return;} onSong(item, autoplay); message(`${autoplay ? 'Playing' : 'Queued'} ${item.title}.`); } catch (error) { message(cleanError(error), true); } }; actions.append(action);
        }
        play.remove(); copy.append(actions); card.append(art, copy); root.append(card);
      } else root.append(button);
    }
    if (!data && loading) { for (let i = 0; i < 8; i++) root.append(createLibrarySkeleton()); }
    else if (!items.length) { const empty = document.createElement('div'); empty.className = 'library-empty'; empty.textContent = data ? filter ? 'No matching results.' : tab ? 'No search results found.' : 'No music playlists were found in this view.' : 'Your music library will appear here.'; root.append(empty); }
    root.scrollTop = scroll; onLayout();
  }
  const cleanError = error => String(error.message || 'The music library could not load. Try refreshing.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  async function load(refresh = false) {
    if (refresh) cache.clear();
    const version = ++request, tab = section, search = searches.get(tab);
    const key = search ? JSON.stringify([search.query, search.type, search.pages]) : tab;
    activeSearch = search ? { id: `${searchSession}:${version}`, version, tab, query: search.query, type: search.type, pages: search.pages } : null;
    loading = true; $('#library-panel').classList.add('library-loading'); $('#library-refresh').disabled = true; render();
    $('#library-results').setAttribute('aria-busy', 'true'); $('#library-sign-in').hidden = true;
    message(search ? `Searching YouTube Music for ${search.query}…` : tab === 'mine' ? 'Loading your playlists…' : tab === 'mixes' ? 'Loading your mixes…' : 'Finding music playlists…');
    try {
      let data = !refresh && cache.get(key);
      if (!data) {
        if (search) {
          if (desktop) data = await window.yinampDesktop.library({ action: 'search', query: search.query, type: search.type, pages: search.pages, refresh, requestId: activeSearch.id });
          else { const response = await fetch(`/api/search?q=${encodeURIComponent(search.query)}&type=${search.type}&pages=${search.pages}${refresh ? '&refresh=1' : ''}`); data = await response.json(); if (!response.ok) throw new Error(data.error); }
        } else if (desktop) {
          if (typeof window.yinampDesktop.library !== 'function') throw new Error('Restart Yinamp to load your music library.');
          data = await window.yinampDesktop.library({ action: 'browse', section: tab, refresh });
        } else {
          const response = await fetch(`/api/library?section=discover${refresh ? '&refresh=1' : ''}`); data = await response.json();
          if (!response.ok) throw new Error(data.error);
        }
        if (version !== request) return;
        if (!data.failedCategories?.length) cache.set(key, data);
      }
      if (version !== request) return;
      visibleData = data; loading = false;
      if (search) {
        const warning = data.failedCategories?.length ? 'Some playlist sources could not load. Refresh to retry.' : data.unavailableCategories?.length ? 'Showing the sources available for this search.' : '';
        message(warning || (data.partial ? search.pages >= 10 ? 'Showing the first 10 pages per source.' : 'More results are available below.' : 'Search complete.'), Boolean(data.failedCategories?.length));
      } else message(data.ownerFilterUnavailable ? 'Your channel identity could not be verified, so owner filtering was not applied. Refresh to retry.' : data.partial ? 'Showing the available portion of this collection. Refresh to retry loading more.' : 'Choose a playlist to replace the queue and start listening.');

    } catch (error) {
      if (version !== request) return;
      loading = false;
      if (error.code === 'LIBRARY_CANCELLED') { message(''); return; }
      const text = cleanError(error); message(text, true); $('#library-sign-in').hidden = !desktop || !/sign in/i.test(text);
    } finally {
      if (version === request) { activeSearch = null; loading = false; $('#library-panel').classList.remove('library-loading'); $('#library-refresh').disabled = false; $('#library-results').setAttribute('aria-busy', 'false'); render(); }
    }
  }
  function select(tab) {
    hideSuggestions();
    views.set(section, { filter: $('#library-filter').value, scroll: $('#library-results').scrollTop });
    section = tab; const search = searches.get(tab); const key = search ? JSON.stringify([search.query, search.type, search.pages]) : tab; visibleData = cache.get(key) ?? null; $('#library-filter').value = views.get(tab)?.filter ?? '';
    for (const button of document.querySelectorAll('[data-library-tab]')) { const active = button.dataset.libraryTab === tab; button.setAttribute('aria-selected', String(active)); button.closest('.search-tab')?.classList.toggle('active', active); button.tabIndex = active ? 0 : -1; }
    $('#library-results').setAttribute('aria-labelledby', `library-tab-${tab}`); $('#library-caption').textContent = search ? `SEARCH: ${search.query}` : captions[tab];
    render(); void load().then(() => { if (section === tab) $('#library-results').scrollTop = views.get(tab)?.scroll ?? 0; });
  }
  for (const button of document.querySelectorAll('[data-library-tab]')) {
    button.disabled = !desktop && button.dataset.libraryTab !== 'discover' && !searches.has(button.dataset.libraryTab);
    if (button.disabled) button.title = 'Personal playlists and mixes use your desktop account.';
    button.onclick = () => select(button.dataset.libraryTab);
    button.onkeydown = event => {
      if (searches.has(button.dataset.libraryTab) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('[data-library-tab]')].filter(item => !item.disabled);
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next].focus(); select(tabs[next].dataset.libraryTab);
    };
  }
  $('#library-refresh').onclick = () => void load(true);
  const input = $('#library-filter'), suggestions = document.createElement('div'); suggestions.id = 'library-suggestions'; suggestions.className = 'library-suggestions'; suggestions.setAttribute('role', 'listbox'); suggestions.hidden = true;
  const field = document.createElement('div'); field.className = 'library-search-field'; input.before(field); field.append(input);
  const clearButton = document.createElement('button'); clearButton.id = 'library-filter-clear'; clearButton.type = 'button'; clearButton.textContent = '×'; clearButton.setAttribute('aria-label', 'Clear search text'); clearButton.hidden = !input.value;
  clearButton.onclick = () => { input.value = ''; hideSuggestions(); render(); input.focus(); }; field.append(clearButton, suggestions);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', suggestions.id); input.setAttribute('aria-expanded', 'false');
  let suggestionTimer, suggestionVersion = 0, suggestionIndex = -1, suggestionValues = [], suggestionController;
  function hideSuggestions() { suggestionVersion++; clearTimeout(suggestionTimer); suggestionController?.abort(); suggestions.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); suggestionIndex = -1; suggestionValues = []; }
  function submitSearch(query) { hideSuggestions(); if (query.trim()) select(addSearch(query.trim())); }
  input.oninput = event => {
    render(); hideSuggestions(); const query = input.value.trim(), version = suggestionVersion;
    if (query.length < 2 || event.isComposing) return;
    suggestionTimer = setTimeout(async () => {
      suggestionController = new AbortController();
      try {
        const response = await fetch(`/api/search-suggestions?q=${encodeURIComponent(query)}`, { signal: suggestionController.signal }); const values = await response.json();
        if (version !== suggestionVersion || !Array.isArray(values) || document.activeElement !== input) return;
        suggestionValues = values.slice(0, 6); suggestions.replaceChildren();
        suggestionValues.forEach((value, index) => { const option = document.createElement('div'); option.id = `search-suggestion-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = value; option.onmousedown = event => event.preventDefault(); option.onclick = () => submitSearch(value); suggestions.append(option); });
        suggestions.hidden = !suggestionValues.length; input.setAttribute('aria-expanded', String(!suggestions.hidden));
      } catch { /* Search and local filtering remain available. */ }
    }, 250);
  };
  input.addEventListener('blur', hideSuggestions);
  input.addEventListener('compositionstart', hideSuggestions);
  input.addEventListener('compositionend', () => input.oninput({ isComposing: false }));
  $('#library-filter').placeholder = 'Filter · Enter to search…';
  $('#library-filter').setAttribute('aria-label', 'Filter this view or press Enter to search YouTube Music');
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { hideSuggestions(); return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && suggestionValues.length) {
      event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestionValues.length) % suggestionValues.length;
      [...suggestions.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === suggestionIndex))); input.setAttribute('aria-activedescendant', `search-suggestion-${suggestionIndex}`);
    }
    if (event.key === 'Enter') { event.preventDefault(); submitSearch(suggestionValues[suggestionIndex] ?? input.value); }
  };
  $('.library-tabs').addEventListener('keydown', event => {
    const button = event.target.closest('[data-library-tab]'); if (!button || !searches.has(button.dataset.libraryTab) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-library-tab]')].filter(item => !item.disabled); const i = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; event.preventDefault(); tabs[next].focus(); select(tabs[next].dataset.libraryTab);
  });
  window.yinampDesktop?.onSearchResults?.(data => {
    const current = activeSearch;
    if(!current || current.version !== request || current.tab !== section || !searches.has(current.tab) || data.requestId !== current.id || data.query !== current.query || data.type !== current.type || data.pages !== current.pages || !Array.isArray(data.items))return;
    visibleData = {items:data.items,partial:data.partial};render();
    message(`${data.items.length} results · Searching…`);
  });
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
