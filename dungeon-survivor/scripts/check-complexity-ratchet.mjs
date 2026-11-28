// 複雑度ラチェット: ベースラインを超える増加を止める。
// biome の JSON レポートから「ファイル別 最大スコア / 件数 / 総件数」を比較する。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function evaluateComplexityReport(report, baseline) {
  const scanned = (report.summary?.unchanged ?? 0) + (report.summary?.changed ?? 0);
  if (!scanned) {
    return { ok: false, scanned: 0, total: 0, violations: ['biome scanned 0 files — gate did not actually run'] };
  }
  const perFile = {};
  const parseErrors = [];
  for (const d of report.diagnostics ?? []) {
    if (d.category !== 'lint/complexity/noExcessiveCognitiveComplexity') continue;
    const rawPath = d.location?.path;
    const file = String(typeof rawPath === 'string' ? rawPath : (rawPath?.file ?? '')).replace(/\\/g, '/');
    const scoreMatch = String(d.message ?? '').match(/complexity of (\d+)/);
    if (!file || !scoreMatch) {
      parseErrors.push(
        `unparseable complexity diagnostic: path=${file || '(empty)'} message=${String(d.message ?? '')}`,
      );
      continue;
    }
    const score = Number(scoreMatch[1]);
    perFile[file] ??= { max: 0, count: 0 };
    perFile[file].max = Math.max(perFile[file].max, score);
    perFile[file].count++;
  }
  const total = Object.values(perFile).reduce((a, f) => a + f.count, 0);
  if (parseErrors.length) {
    return { ok: false, scanned, total, violations: parseErrors };
  }

  const violations = [];
  for (const [file, cur] of Object.entries(perFile)) {
    const base = baseline.perFile[file];
    if (!base) violations.push(`${file}: new complexity warning (max ${cur.max}) not in baseline`);
    else {
      if (cur.max > base.max) violations.push(`${file}: max ${base.max} -> ${cur.max}`);
      if (cur.count > base.count) violations.push(`${file}: count ${base.count} -> ${cur.count}`);
    }
  }
  return { ok: violations.length === 0, scanned, total, violations };
}

function main() {
  const baseline = JSON.parse(readFileSync(new URL('./complexity-baseline.json', import.meta.url), 'utf8'));
  const biomeBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.cmd' : 'biome');
  const proc = spawnSync(biomeBin, ['check', '.', '--reporter=json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (proc.error) {
    console.error(`FAIL: failed to execute biome: ${proc.error.message}`);
    process.exit(1);
  }
  if (proc.status !== 0 && proc.status !== 1) {
    console.error(`FAIL: biome exited unexpectedly with status ${proc.status}`);
    if (proc.stderr) console.error(proc.stderr);
    process.exit(1);
  }
  if (!proc.stdout) {
    console.error('FAIL: biome produced no report — gate did not actually run');
    if (proc.stderr) console.error(proc.stderr);
    process.exit(1);
  }
  const report = JSON.parse(proc.stdout);
  const result = evaluateComplexityReport(report, baseline);
  console.log(
    `complexity warnings: ${result.total} (baseline ${baseline.totalWarnings}), files scanned: ${result.scanned}`,
  );
  if (!result.ok) {
    console.error(`FAIL: complexity gate failed:\n${result.violations.join('\n')}`);
    process.exit(1);
  }
  console.log('OK: complexity did not increase vs baseline');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
