import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.resolve('electron-builder'))('js-yaml');
const workflow = async name => yaml.load(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('demo deployment only accepts successful tests of this repository’s default branch', async () => {
  const pages = await workflow('pages');
  // This guard uses only property access and boolean comparisons, shared by
  // the GitHub expression language and JavaScript. Exercise the actual guard.
  const allowed = new Function('github', `return Boolean(${pages.jobs.build.if});`);
  const event = (overrides = {}, repository = {}) => ({ repository: 'owner/yinamp', event: {
    repository: { default_branch: 'main', ...repository },
    workflow_run: { conclusion: 'success', event: 'push', head_repository: { full_name: 'owner/yinamp' }, head_branch: 'main', ...overrides },
  } });
  assert.equal(allowed(event()), true);
  assert.equal(allowed(event({ event: 'workflow_dispatch' })), true);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) assert.equal(allowed(event({ conclusion })), false);
  assert.equal(allowed(event({ event: 'pull_request' })), false);
  assert.equal(allowed(event({ head_branch: 'feature' })), false);
  assert.equal(allowed(event({ head_repository: { full_name: 'fork/yinamp' } })), false);
  assert.equal(allowed(event({ head_branch: 'master' }, { default_branch: 'master' })), true);
  assert.equal(pages.jobs.build.steps[0].with.ref, '${{ github.event.workflow_run.head_sha }}');
  assert.deepEqual(pages.on.workflow_run.workflows, ['Tests']);
  assert.equal(pages.jobs.deploy.needs, 'build');
});

test('tests run independently on branches and PRs and are reused by desktop builds', async () => {
  const checks = await workflow('tests');
  for (const trigger of ['push', 'pull_request', 'workflow_call', 'workflow_dispatch']) assert.ok(Object.hasOwn(checks.on, trigger));
  assert.equal(checks.permissions.contents, 'read');
  assert.ok(checks.jobs.app.steps.some(step => step.run === 'npm test'));
  assert.ok(checks.jobs.bootstrap.steps.some(step => step.run === 'go test ./...'));
  const desktop = await workflow('latest-build');
  assert.equal(desktop.jobs.test.uses, './.github/workflows/tests.yml');
  const installer = desktop.jobs.build.steps.find(step => step.name === 'macOS installer and uninstall integration');
  assert.equal(installer.if, "runner.os == 'macOS'");
  assert.match(installer.run, /install-uninstall\.mjs/);
});
