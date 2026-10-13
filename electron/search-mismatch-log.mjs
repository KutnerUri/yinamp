import { appendFileSync, statSync, renameSync } from 'node:fs';
// Keep this separate from general diagnostics. Never log queries, response
// bodies, credentials, headers, cookies or rejected field values.
export function writeSearchMismatch(path, issue) {
  const record = { time: new Date().toISOString() };
  for (const field of ['category','source','field','expected','actual']) record[field] = String(issue[field] ?? '').slice(0, 200);
  if (Number.isInteger(issue.index)) record.index = issue.index;
  try {
    try { if (statSync(path).size > 1024 * 1024) renameSync(path, path + '.previous'); } catch {}
    appendFileSync(path, JSON.stringify(record) + '\n');
    return true;
  } catch { return false; }
}
