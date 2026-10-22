// Shared by CI version allocation and the in-app history picker.
const core = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const pattern = new RegExp(`^${core}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);
export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match = pattern.exec(value);
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  const prerelease = match[4]?.split('.') ?? [];
  if (numbers.some(number => !Number.isSafeInteger(number)) || prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], prerelease };
}
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid semantic version');
  for (const key of ['major', 'minor', 'patch']) if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  if (!left.prerelease.length || !right.prerelease.length) return Number(!left.prerelease.length) - Number(!right.prerelease.length);
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const x = left.prerelease[index], y = right.prerelease[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function versionFromLabel(label) {
  const candidate = String(label ?? '').split(' · ')[0];
  return parseVersion(candidate) ? candidate : null;
}
export function groupBuilds(builds) {
  const groups = new Map(), seen = new Set();
  for (const build of builds) {
    if (seen.has(build.id)) continue;
    seen.add(build.id);
    const version = parseVersion(build.version) ? build.version : versionFromLabel(build.label);
    const key = version ?? 'Other builds';
    if (!groups.has(key)) groups.set(key, { version: key, prerelease: Boolean(version && parseVersion(version).prerelease.length), builds: [] });
    groups.get(key).builds.push(build);
  }
  const result = [...groups.values()];
  result.sort((a, b) => !parseVersion(a.version) ? 1 : !parseVersion(b.version) ? -1 : compareVersions(b.version, a.version));
  for (const group of result) group.builds.sort((a, b) => {
    const order = build => String(build.label ?? '').match(/Build (\d+)\.(\d+)$/)?.slice(1).map(Number) ?? String(build.id).match(/build-(\d+)-(\d+)$/)?.slice(1).map(Number) ?? [0, 0];
    const left = order(a), right = order(b);
    return right[0] - left[0] || right[1] - left[1];
  });
  return result;
}
// Native menus stay short while every older version/build remains reachable.
export function pageMenu(items, label = 'Older versions…', size = 15) {
  const page = items.slice(0, size);
  if (items.length > size) page.push({ label, submenu: pageMenu(items.slice(size), label, size) });
  return page;
}

export function versionMenu(builds, currentID, select, enabled = true) {
  const item = (build, label) => ({ label, type: 'checkbox', checked: build.id === currentID, enabled, click: () => select(build.id) });
  const groups = groupBuilds(builds);
  const versionItem = group => group.builds.length === 1
    ? item(group.builds[0], group.version)
    : {
      label: group.version + (group.builds.some(build => build.id === currentID) ? ' (current)' : ''),
      submenu: pageMenu(group.builds.map(build => item(build, build.label.replace(group.version + ' · ', ''))), 'Older builds…'),
    };
  const stable = groups.filter(group => !group.prerelease).map(versionItem);
  const previews = groups.filter(group => group.prerelease).map(versionItem);
  return [...pageMenu(stable), ...(previews.length ? [{ label: 'Branch previews', submenu: pageMenu(previews) }] : [])];
}
