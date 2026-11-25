import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['depcruise', 'src', '--config', '.dependency-cruiser.cjs'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}

const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
const match = combined.match(/\((\d+)\s+modules,\s+(\d+)\s+dependencies cruised\)/);
if (!match || Number(match[1]) === 0) {
  console.error(
    'ERROR: dependency-cruiser cruised 0 modules (or output format changed). Failing to prevent silent no-op.',
  );
  process.exit(1);
}
