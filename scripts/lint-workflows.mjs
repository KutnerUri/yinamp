// Lint GitHub workflows: syntax, ${{ }} expressions, runner labels, and the shell
// code in run: steps (actionlint runs shellcheck when it is installed).
import { spawnSync } from 'node:child_process';

const result = spawnSync('actionlint', process.argv.slice(2), { stdio: 'inherit' });
if (result.error?.code === 'ENOENT') {
  console.error('actionlint not found. Install: brew install actionlint shellcheck');
  process.exit(1);
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
