const $ = selector => document.querySelector(selector);
async function act(value) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  try { render(await window.sourceLab.action(value)); }
  catch (error) { $('#status').textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function render(report) {
  const page = report.pages.at(-1);
  $('#status').textContent = page ? `${page.stage} · ${page.signedIn ? 'Signed in' : 'Not signed in'} · ${page.catalog?.count ?? 0} raw cards · ${page.catalog?.withArtwork ?? 0} with artwork · ${page.elapsedMs} ms` : 'Waiting for Music data…';
  $('#sources').replaceChildren();
  for (const action of page?.actions ?? []) { const button = document.createElement('button'); button.textContent = action.title || 'Unnamed shelf'; button.disabled = !action.hasButton; button.onclick = () => act({ action: 'source', index: action.index }); $('#sources').append(button); }
  $('#requests').replaceChildren();
  for (const request of report.requests.slice(-30)) { const row = document.createElement('div'); row.textContent = `${request.endpoint} · ${request.browseId ?? '—'} · ${request.durationMs ?? 'pending'} ms · ${request.status ?? '…'} · ${request.catalog?.count ?? '—'} cards`; $('#requests').append(row); }
  $('#summary').textContent = JSON.stringify({ thumbnailPaths: page?.catalog?.thumbnailPaths, shelves: page?.catalog?.shelves, productionParser: page?.productionParser, experiments: report.experiments }, null, 2);
  $('#cards').replaceChildren();
  for (const card of page?.catalog?.cards.slice(0, 80) ?? []) { const row = document.createElement('div'); row.className = 'card'; if (card.thumbnail) { const image = document.createElement('img'); image.src = card.thumbnail; image.alt = ''; row.append(image); } const title = document.createElement('span'); title.textContent = card.title; row.append(title); $('#cards').append(row); }
}
window.sourceLab.onUpdate(render);
for (const button of document.querySelectorAll('[data-route]')) button.onclick = () => act({ action: 'navigate', route: button.dataset.route });
$('#snapshot').onclick = () => act({ action: 'snapshot' }); $('#run').onclick = () => act({ action: 'run' });
$('#search').onsubmit = event => { event.preventDefault(); act({ action: 'navigate', route: 'search', query: $('#query').value }); };
