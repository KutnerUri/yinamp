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
test('changed files select desktop and demo independently', () => {
  for (const file of ['src/app.js', 'skins/default.json', 'index.html', 'package.json', '.github/workflows/package-desktop.yml', 'scripts/desktop-version.mjs']) {
    assert.deepEqual(selectTargets([file]), { desktop: true, demo: true }, file);
  }
  for (const file of ['launcher/main.go', 'electron/main.mjs', 'scripts/build-universal-mac.mjs', 'tests/desktop/lifecycle.mjs', 'electron-builder.yml']) {
    assert.deepEqual(selectTargets([file]), { desktop: true, demo: false }, file);
  }
  for (const file of ['src/pages-demo.js', 'scripts/build-pages.mjs']) assert.deepEqual(selectTargets([file]), { desktop: false, demo: true });
  assert.deepEqual(selectTargets(['docs/ci.md']), { desktop: false, demo: false });
});

test('change selector diffs against the last published commit, including deletions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-ci-changes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  await writeFile(join(root, 'index.html'), 'fixture'); git('add', '.'); git('commit', '-qm', 'first');
  const first = git('rev-parse', 'HEAD');
  await rm(join(root, 'index.html')); git('add', '-A'); git('commit', '-qm', 'delete shipped file');
  const deleted = git('rev-parse', 'HEAD');
  await writeFile(join(root, 'README.md'), 'docs'); git('add', '-A'); git('commit', '-qm', 'docs only');
  const docs = git('rev-parse', 'HEAD');
  const output = join(root, 'output');
  const run = async (target, base, head) => {
    await writeFile(output, '');
    execFileSync(process.execPath, [resolve('scripts/ci-changes.mjs'), target, base, head], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    return readFile(output, 'utf8');
  };
  assert.equal(await run('desktop', first, docs), 'changed=true\n', 'changes in skipped commits since the last publish still count');
  assert.equal(await run('demo', deleted, docs), 'changed=false\n');
  assert.equal(await run('desktop', '', first), 'changed=true\n', 'nothing published yet');
  assert.equal(await run('desktop', 'f'.repeat(40), first), 'changed=true\n', 'unknown base');
});

const fromTests = `github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository)`;

test('tests run on every push; publish and demo follow successful main tests or manual runs', async () => {
  const tests = await workflow('tests');
  assert.deepEqual(Object.keys(tests.on), ['push', 'workflow_dispatch']);
  assert.equal(tests.on.push, null, 'every branch');
  assert.equal(tests.jobs.app.steps.filter(step => step.run === 'npm test').length, 1);
  assert.ok(tests.jobs.bootstrap.steps.some(step => step.run === 'go test ./...'));
  for (const name of ['latest-build', 'pages']) {
    const flow = await workflow(name);
    assert.deepEqual(flow.on.workflow_run, { workflows: [tests.name], types: ['completed'], branches: ['main'] }, name);
    assert.ok(Object.hasOwn(flow.on, 'workflow_dispatch'), name);
    assert.equal(flow.concurrency['cancel-in-progress'], false, name);
    assert.equal(flow.env.YINAMP_COMMIT, '${{ github.event.workflow_run.head_sha || github.sha }}', `${name} must build the tested commit`);
  }
});

test('publish desktop keeps its run counter, versions from git, and builds the tested commit', async () => {
  const publish = await workflow('latest-build');
  assert.equal(publish.name, 'Publish desktop');
  assert.equal(publish.jobs.changes.if, fromTests);
  assert.ok(publish.jobs.changes.steps.some(step => step.run === 'node scripts/desktop-version.mjs'));
  assert.equal(publish.jobs.changes.steps[0].with['fetch-depth'], 0, 'versioning needs full history');
  assert.equal(publish.jobs.build.if, "needs.changes.outputs.changed == 'true'");
  assert.equal(publish.jobs.build.uses, './.github/workflows/package-desktop.yml');
  assert.equal(publish.jobs.build.with.version, '${{ needs.changes.outputs.version }}');
  assert.equal(publish.jobs.build.with.commit, '${{ github.event.workflow_run.head_sha || github.sha }}');
  for (const job of ['universal-mac', 'test-universal-mac', 'publish']) assert.equal(publish.jobs[job].steps[0].with.ref, '${{ env.YINAMP_COMMIT }}', job);
  assert.deepEqual(publish.jobs.publish.needs, ['build', 'test-universal-mac']);
});

test('demo deploys only from the default branch, after successful tests or manually', async () => {
  const pages = await workflow('pages');
  const format = (pattern, value) => pattern.replace('{0}', value);
  const allowed = (event_name, ref, workflow_run) => new Function('github', 'format', `return Boolean(${pages.jobs.build.if});`)(
    { event_name, ref, repository: 'KutnerUri/yinamp', event: { repository: { default_branch: 'main' }, workflow_run } }, format);
  const passed = { conclusion: 'success', event: 'push', head_repository: { full_name: 'KutnerUri/yinamp' } };
  assert.equal(allowed('workflow_run', 'refs/heads/main', passed), true);
  assert.equal(allowed('workflow_run', 'refs/heads/main', { ...passed, conclusion: 'failure' }), false);
  assert.equal(allowed('workflow_run', 'refs/heads/main', { ...passed, event: 'pull_request' }), false);
  assert.equal(allowed('workflow_dispatch', 'refs/heads/main'), true);
  assert.equal(allowed('workflow_dispatch', 'refs/heads/feature'), false);
  assert.equal(pages.jobs.deploy.needs, 'build');
  assert.equal(pages.jobs.deploy.if, "needs.build.outputs.changed == 'true'");
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
  // Macs ship only the universal DMG; its install/uninstall test runs on both architectures.
  assert.ok(packaging.jobs.build.steps.every(step => !/install-uninstall/.test(step.run ?? '')));
  const universal = (await workflow('latest-build')).jobs['test-universal-mac'];
  assert.deepEqual(universal.strategy.matrix.os, ['macos-latest', 'macos-15-intel']);
  assert.ok(universal.steps.some(step => /check-universal-mac\.mjs/.test(step.run ?? '')));
});
