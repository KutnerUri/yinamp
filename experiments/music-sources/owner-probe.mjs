const text = value => value?.simpleText ?? value?.runs?.map(r => r.text ?? '').join('') ?? '';
export function analyzeOwners(data) {
  const cards = [], seen = new WeakSet();
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || seen.has(value)) return;
    seen.add(value);
    const card = value.musicTwoRowItemRenderer ?? value.musicResponsiveListItemRenderer;
    if (card) {
      const runs = card.subtitle?.runs ?? card.flexColumns?.slice(1).flatMap(c => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) ?? [];
      cards.push({ title: text(card.title ?? card.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text),
        id: card.navigationEndpoint?.browseEndpoint?.browseId,
        byline: runs.map(r => ({ text: r.text, browseId: r.navigationEndpoint?.browseEndpoint?.browseId,
          pageType: r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType })).filter(r => r.browseId),
        ownerFieldKeys: Object.keys(card).filter(k=>/owner|author|creator|editable/i.test(k)) });
      return;
    }
    for (const [key, child] of Object.entries(value)) if (!['menu','context','responseContext','trackingParams','clickTrackingParams'].includes(key)) walk(child, depth + 1);
  }
  walk(data); return cards;
}
