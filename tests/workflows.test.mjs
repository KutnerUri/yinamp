import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { selectTargets } from '../scripts/ci-changes.mjs';

const yaml = createRequire(import.meta.resolve('electron-builder'))('js-yaml');
const workflow = async name => yaml.load(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const push = { eventName: 'push', branch: 'main' };

test('changed files select desktop and demo independently', () => {
  for (const file of ['src/app.js', 'skins/default.json', 'index.html', 'package.json', '.github/workflows/package-desktop.yml']) {
    assert.deepEqual(selectTargets([file], push), { desktop: true, demo: true }, file);
  }
  for (const file of ['launcher/main.go', 'electron/main.mjs', 'scripts/build-universal-mac.mjs', 'tests/desktop/lifecycle.mjs', 'electron-builder.yml']) {
    assert.deepEqual(selectTargets([file], push), { desktop: true, demo: false }, file);
  }
  for (const file of ['src/pages-demo.js', 'scripts/build-pages.mjs']) assert.deepEqual(selectTargets([file], push), { desktop: false, demo: true });
  assert.deepEqual(selectTargets(['docs/ci.md'], push), { desktop: false, demo: false });
  assert.deepEqual(selectTargets(['src/app.js'], { ...push, branch: 'feature' }), { desktop: false, demo: false });
  assert.deepEqual(selectTargets(['src/app.js'], { ...push, eventName: 'pull_request' }), { desktop: false, demo: false });
});

test('manual runs support tests only, full release, or branch preview', () => {
  const manual = { eventName: 'workflow_dispatch', branch: 'main' };
  assert.deepEqual(selectTargets([], { ...manual, inputs: { desktop: 'true', demo: 'true' } }), { desktop: true, demo: true });
  assert.deepEqual(selectTargets([], { ...manual, inputs: { desktop: false, demo: false } }), { desktop: false, demo: false });
  assert.deepEqual(selectTargets([], { ...manual, branch: 'feature', inputs: { desktop: true, demo: true } }), { desktop: true, demo: false });
});

test('change selector handles deletions and initial pushes using the actual git diff', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-ci-changes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  await writeFile(join(root, 'index.html'), 'fixture'); git('add', '.'); git('commit', '-qm', 'first');
  const first = git('rev-parse', 'HEAD');
  await rm(join(root, 'index.html')); await writeFile(join(root, 'README.md'), 'docs'); git('add', '-A'); git('commit', '-qm', 'delete shipped file');
  const head = git('rev-parse', 'HEAD');
  const event = join(root, 'event.json'), output = join(root, 'output');
  const run = async (before, sha) => {
    await writeFile(event, JSON.stringify({ before, repository: { default_branch: 'main' } }));
    await writeFile(output, '');
    execFileSync(process.execPath, [resolve('scripts/ci-changes.mjs')], { cwd: root, env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' } });
    return readFile(output, 'utf8');
  };
  assert.equal(await run(first, head), 'desktop=true\ndemo=true\n');
  assert.equal(await run('0'.repeat(40), first), 'desktop=true\ndemo=true\n');
});

test('one orchestrator runs checks once and gates both release paths', async () => {
  const ci = await workflow('latest-build');
  for (const trigger of ['push', 'pull_request', 'workflow_dispatch']) assert.ok(Object.hasOwn(ci.on, trigger));
  assert.equal(ci.jobs.checks.uses, './.github/workflows/tests.yml');
  for (const job of ['demo', 'desktop']) assert.deepEqual(ci.jobs[job].needs, ['checks', 'changes']);
  const checks = await workflow('tests');
  assert.deepEqual(Object.keys(checks.on), ['workflow_call']);
  assert.equal(checks.permissions.contents, 'read');
  assert.equal(checks.jobs.app.steps.filter(step => step.run === 'npm test').length, 1);
  assert.ok(checks.jobs.bootstrap.steps.some(step => step.run === 'go test ./...'));
  const release = await workflow('desktop-release');
  assert.deepEqual(Object.keys(release.on), ['workflow_call']);
  assert.equal(release.jobs.test, undefined);
  assert.equal(release.jobs.build.uses, './.github/workflows/package-desktop.yml');
  assert.equal(release.jobs.build.with.version, '${{ needs.version.outputs.version }}');
  assert.deepEqual(release.jobs.publish.needs, ['build', 'test-universal-mac']);
});

test('deployment guards reject PRs even if changed-file outputs request deployment', async () => {
  const ci = await workflow('latest-build');
  const format = (pattern, value) => pattern.replace('{0}', value);
  const allowed = (job, eventName, ref) => new Function('github', 'needs', 'format', `return Boolean(${ci.jobs[job].if});`)(
    { event_name: eventName, ref, event: { repository: { default_branch: 'main' } } },
    { changes: { outputs: { desktop: 'true', demo: 'true' } } }, format);
  for (const job of ['demo', 'desktop']) assert.equal(allowed(job, 'pull_request', 'refs/heads/main'), false);
  assert.equal(allowed('demo', 'push', 'refs/heads/feature'), false);
  assert.equal(allowed('desktop', 'push', 'refs/heads/feature'), false);
  assert.equal(allowed('desktop', 'workflow_dispatch', 'refs/heads/feature'), true);
  assert.equal(allowed('demo', 'workflow_dispatch', 'refs/heads/feature'), false);
  for (const job of ['demo', 'desktop']) assert.equal(allowed(job, 'push', 'refs/heads/main'), true);
  const pages = await workflow('pages');
  assert.deepEqual(Object.keys(pages.on), ['workflow_call']);
  assert.equal(pages.jobs.build.steps[0].with?.ref, undefined, 'checkout must use the exact caller commit');
  assert.equal(pages.jobs.deploy.needs, 'build');
  assert.equal(pages.concurrency['cancel-in-progress'], false, 'nested Pages work must not cancel desktop publishing');
});

test('Windows check reuses packaging but never duplicates automatic main builds', async () => {
  const windows = await workflow('windows-build');
  assert.deepEqual(windows.on.push['branches-ignore'], ['main']);
  assert.equal(windows.jobs.build.uses, './.github/workflows/package-desktop.yml');
  assert.equal(windows.jobs.build.with['full-tests'], false);
  const packaging = await workflow('package-desktop');
  assert.equal(packaging.on.workflow_call.inputs['full-tests'].default, true);
  for (const name of ['Native launcher platform tests', 'Desktop package smoke tests', 'Desktop lifecycle tests (startup, update, rollback, recovery)', 'Compact launcher lifecycle tests (cached runtime, update, rollback)']) {
    assert.equal(packaging.jobs.build.steps.find(step => step.name === name).if, 'inputs.full-tests');
  }
  const installer = packaging.jobs.build.steps.find(step => step.name === 'macOS installer and uninstall integration');
  assert.equal(installer.if, "inputs.full-tests && runner.os == 'macOS'");
  assert.match(installer.run, /install-uninstall\.mjs/);
});
