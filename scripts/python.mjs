// Runs a Python script with whichever interpreter this system has:
// python3 (macOS, Linux), python or the py launcher (Windows).
//
//   node scripts/python.mjs scripts/build-font.py [args...]
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
for (const [command, ...prefix] of [['python3'], ['python'], ['py', '-3']]) {
  const probe = spawnSync(command, [...prefix, '--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(command, [...prefix, ...args], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
console.error('Python 3 was not found (tried python3, python, py -3). Install it from https://www.python.org/');
process.exit(1);
