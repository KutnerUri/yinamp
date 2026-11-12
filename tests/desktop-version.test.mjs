import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { versionFromHistory, branchVersion, gitVersion } from '../scripts/desktop-version.mjs';
import { parseVersion, compareVersions, groupBuilds, pageMenu, versionMenu } from '../electron/versions.mjs';

test('package.json sets major.minor and each later commit adds a patch', () => {
  assert.equal(versionFromHistory('1.2.0', 0), '1.2.0');
  assert.equal(versionFromHistory('1.2.0', 13), '1.2.13');
  assert.equal(versionFromHistory('1.2.5', 2), '1.2.7');
  assert.throws(() => versionFromHistory('1.2.0-alpha', 1), /stable/);
  assert.throws(() => versionFromHistory('1.2.0', -1), /count/);
});

test('branch names produce valid, distinct prerelease versions', () => {
  assert.equal(branchVersion('1.2.11', 'codex/Compact installer', 123, 1), '1.2.11-codex-compact-installer.123.1');
  for (const branch of ['001', '###', 'feat/é', 'long/'.repeat(30)]) assert.ok(parseVersion(branchVersion('1.2.11', branch, 123, 1)));
  assert.notEqual(branchVersion('1.2.11', 'feature', 123, 1), branchVersion('1.2.11', 'feature', 123, 2));
});

test('versions follow first-parent git history: merges count once, bumps restart the patch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-git-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = async (message, version) => {
    if (version) await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version }));
    else await writeFile(join(root, 'notes.txt'), message);
    git('add', '-A'); git('commit', '-qm', message);
  };
  const version = (options = {}) => gitVersion({ cwd: root, ...options });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  await commit('start', '1.2.0');
  assert.equal(version(), '1.2.0');
  await commit('one'); await commit('two');
  assert.equal(version(), '1.2.2');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'renamed', version: '1.2.0' }));
  git('commit', '-qam', 'unrelated package.json edit');
  assert.equal(version(), '1.2.3', 'only version changes restart the count');
  git('checkout', '-qb', 'feature'); await commit('f1'); await commit('f2'); await commit('f3');
  assert.equal(version({ branch: 'feature', number: 7 }), '1.2.6-feature.7.1');
  git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', 'feature', '-m', 'merge feature');
  assert.equal(version(), '1.2.4', 'a merge is one patch');
  await commit('minor bump', '1.3.0');
  assert.equal(version(), '1.3.0');
  await commit('after bump');
  assert.equal(version(), '1.3.1');
  assert.equal(version({ commit: 'HEAD~2' }), '1.2.4', 'any past commit keeps its version');
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
