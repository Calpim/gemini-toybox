// 複雑度ラチェット: ベースラインを超える増加を止める。
// biome の JSON レポートから「ファイル別 最大スコア / 件数 / 総件数」を比較する。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('./complexity-baseline.json', import.meta.url), 'utf8'));
const biomeBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.cmd' : 'biome');
const proc = spawnSync(biomeBin, ['check', '.', '--reporter=json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
});
if (!proc.stdout) {
  console.error('FAIL: biome produced no report — gate did not actually run');
  if (proc.stderr) console.error(proc.stderr);
  process.exit(1);
}
const report = JSON.parse(proc.stdout);
const scanned = (report.summary?.unchanged ?? 0) + (report.summary?.changed ?? 0);
if (!scanned) {
  console.error('FAIL: biome scanned 0 files — gate did not actually run');
  process.exit(1);
}
const perFile = {};
for (const d of report.diagnostics ?? []) {
  if (d.category !== 'lint/complexity/noExcessiveCognitiveComplexity') continue;
  const score = Number(d.message.match(/complexity of (\d+)/)?.[1] ?? 0);
  // biome の JSON 診断では location.path が { file } 形式の場合があるため両対応にする
  const rawPath = d.location?.path;
  const file = String(typeof rawPath === 'string' ? rawPath : (rawPath?.file ?? '')).replace(/\\/g, '/');
  perFile[file] ??= { max: 0, count: 0 };
  perFile[file].max = Math.max(perFile[file].max, score);
  perFile[file].count++;
}
const total = Object.values(perFile).reduce((a, f) => a + f.count, 0);
console.log(`complexity warnings: ${total} (baseline ${baseline.totalWarnings}), files scanned: ${scanned}`);

const violations = [];
for (const [file, cur] of Object.entries(perFile)) {
  const base = baseline.perFile[file];
  if (!base) violations.push(`${file}: new complexity warning (max ${cur.max}) not in baseline`);
  else {
    if (cur.max > base.max) violations.push(`${file}: max ${base.max} -> ${cur.max}`);
    if (cur.count > base.count) violations.push(`${file}: count ${base.count} -> ${cur.count}`);
  }
}
if (violations.length) {
  console.error(`FAIL: complexity increased:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('OK: complexity did not increase vs baseline');
