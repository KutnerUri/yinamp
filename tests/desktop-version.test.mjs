import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDesktopVersion, branchVersion, reserveDesktopVersion } from '../scripts/desktop-version.mjs';
import { parseVersion, compareVersions, groupBuilds, pageMenu, versionMenu } from '../electron/versions.mjs';

test('main versions advance patches while package.json is a floor for minor/major bumps', () => {
  assert.equal(nextDesktopVersion('1.2.0', []), '1.2.0');
  assert.equal(nextDesktopVersion('1.2.0', ['1.2.8', '1.2.10', '1.3.0-feature.12.1']), '1.2.11');
  assert.equal(nextDesktopVersion('1.3.0', ['1.2.10']), '1.3.0');
  assert.equal(nextDesktopVersion('2.0.0', ['1.9.99']), '2.0.0');
  assert.equal(nextDesktopVersion('1.2.0', ['1.3.10']), '1.3.11');
  assert.throws(() => nextDesktopVersion('1.2.0-alpha', []), /stable/);
});

test('branch names produce valid, distinct prerelease versions', () => {
  assert.equal(branchVersion('1.2.11', 'codex/Compact installer', 123, 1), '1.2.11-codex-compact-installer.123.1');
  for (const branch of ['001', '###', 'feat/é', 'long/'.repeat(30)]) assert.ok(parseVersion(branchVersion('1.2.11', branch, 123, 1)));
  assert.notEqual(branchVersion('1.2.11', 'feature', 123, 1), branchVersion('1.2.11', 'feature', 123, 2));
});

test('overlapping main builds cannot reserve the same version', async () => {
  const used = ['1.2.0'];
  let collision = false;
  const version = await reserveDesktopVersion({ base: '1.2.0', branch: 'main', number: 12, attempt: 1,
    listUsed: async () => [...used], reserve: async candidate => {
      if (!collision) { collision = true; used.push(candidate); return false; }
      assert.ok(!used.includes(candidate)); used.push(candidate); return true;
    } });
  assert.equal(version, '1.2.2');
  assert.deepEqual(used, ['1.2.0', '1.2.1', '1.2.2']);
});

test('a failed reservation fails the build rather than returning a duplicate', async () => {
  await assert.rejects(reserveDesktopVersion({ base: '1.2.0', branch: 'main', number: 12, attempt: 1, listUsed: async () => [], reserve: async () => false }), /unique/);
});

test('version ordering handles numeric patches and semver prerelease precedence', () => {
  const versions = ['1.2.10', '1.2.2', '1.2.10-alpha.10', '1.2.10-alpha.2', '1.2.10-alpha'];
  assert.deepEqual(versions.sort(compareVersions), ['1.2.2', '1.2.10-alpha', '1.2.10-alpha.2', '1.2.10-alpha.10', '1.2.10']);
  for (const value of ['01.2.3', '1.2', '1.2.3-alpha.01', 'oops']) assert.equal(parseVersion(value), null);
  assert.equal(compareVersions('1.2.3+build.1', '1.2.3+build.2'), 0);
});

test('history groups legacy builds by semver, keeps every build, and separates previews', () => {
  const builds = Array.from({ length: 40 }, (_, index) => ({ id: `build-${index + 1}-1`, label: `${index < 20 ? '1.2.0' : '1.2.1'} · Build ${index + 1}.1` }));
  builds.push({ id: 'build-99-1', version: '1.2.2-feature.99.1', label: '1.2.2-feature.99.1 · Build 99.1' });
  const groups = groupBuilds([...builds, builds[0]]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].prerelease, true);
  assert.equal(groups.flatMap(group => group.builds).length, 41);
  assert.equal(groups.find(group => group.version === '1.2.0').builds[0].id, 'build-20-1');
});

test('short native menu pages still reach every historical item', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ label: String(index) }));
  const menu = pageMenu(items);
  const flatten = page => page.flatMap(item => item.submenu ? flatten(item.submenu) : item);
  assert.deepEqual(flatten(menu), items);
  assert.equal(menu.length, 16);
});


test('the actual picker keeps previews separate and can select a version beyond the old limit', () => {
  const builds = Array.from({ length: 60 }, (_, index) => ({ id: `build-${index + 1}-1`, label: `1.2.${index} · Build ${index + 1}.1` }));
  builds.push({ id: 'build-100-1', label: '1.3.0-feature.100.1 · Build 100.1' });
  const selected = [];
  const menu = versionMenu(builds, 'build-60-1', id => selected.push(id));
  assert.equal(menu[0].label, '1.2.59');
  assert.equal(menu[0].checked, true);
  const previews = menu.find(item => item.label === 'Branch previews');
  assert.equal(previews.submenu[0].label, '1.3.0-feature.100.1');
  const flatten = items => items.flatMap(item => item.submenu ? flatten(item.submenu) : item);
  const all = flatten(menu);
  assert.equal(all.length, 61);
  all.find(item => item.label === '1.2.0').click();
  assert.deepEqual(selected, ['build-1-1']);
  assert.ok(flatten(versionMenu(builds, 'build-60-1', () => {}, false)).every(item => !item.enabled));
});
