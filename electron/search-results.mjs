import { mergeSearchItem } from '../src/search-schema.js';
import { libraryCancelled } from './library-errors.mjs';

// One sequential source loop and one final outcome: completed, partial, or error.
export async function collectSearchSources({ categories, load, isCurrent, onResults = () => {} }) {
  const items = new Map(), unavailable = new Set(), failed = new Set();
  let partial = false, firstError;
  const assertCurrent = () => { if (!isCurrent()) throw libraryCancelled(); };
  const snapshot = () => ({ items: [...items.values()], partial: partial || failed.size > 0, unavailableCategories: [...unavailable], failedCategories: [...failed] });
  for (const category of categories) {
    assertCurrent();
    const publish = data => {
      assertCurrent();
      if (data.unavailable) unavailable.add(category);
      for (const item of data.items) items.set(item.id, items.has(item.id) ? mergeSearchItem(item, items.get(item.id)) : item);
      onResults({ ...snapshot(), partial: partial || data.partial || failed.size > 0 });
    };
    try {
      const result = await load(category, publish);
      assertCurrent(); partial ||= result.partial;
      publish(result);
    } catch (error) {
      if (!isCurrent() || error.code === 'LIBRARY_CANCELLED') throw libraryCancelled();
      failed.add(category); firstError ??= error;
    }
  }
  assertCurrent();
  if (!items.size && firstError) throw firstError;
  return snapshot();
}
