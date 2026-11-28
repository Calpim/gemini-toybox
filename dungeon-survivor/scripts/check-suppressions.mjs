// 抑制コメントの新規追加を止めるゲート。
// 許可はこの ALLOWLIST への追記（= PR差分に必ず出る）でのみ行う。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src', 'scripts'];
const SELF_FILES = new Set(['scripts/check-suppressions.mjs', 'scripts/check-gates.test.mjs']);
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;
export const ALLOWLIST = [
  // 既存の唯一の抑制（2026-11-28 main実測）。noExcessiveCognitiveComplexity の抑制は許可しない。
  { file: 'src/styles/theme.css', rule: 'noImportantStyles' },
];
const MARKER = ['biome', 'ignore'].join('-');

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (SOURCE_EXT_RE.test(name)) yield p;
  }
}

function* collectTargetFiles(rootDir) {
  for (const name of readdirSync(rootDir)) {
    const p = join(rootDir, name);
    if (statSync(p).isFile() && SOURCE_EXT_RE.test(name)) yield p;
  }
  for (const dir of SCAN_DIRS) {
    yield* walk(join(rootDir, dir));
  }
}

export function scanSuppressions(rootDir, allowlist = ALLOWLIST) {
  let found = 0;
  const violations = [];
  for (const file of collectTargetFiles(rootDir)) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    if (SELF_FILES.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(MARKER)) return;
      const matches = [...line.matchAll(/lint\/[a-z]+\/([A-Za-z]+)/g)];
      if (matches.length === 0) {
        found++;
        violations.push(`${rel}:${i + 1}  (unscoped or unrecognized suppression) ${line.trim()}`);
        return;
      }
      for (const m of matches) {
        found++;
        const ok = allowlist.some((a) => a.file === rel && a.rule === m[1]);
        if (!ok) violations.push(`${rel}:${i + 1}  (${m[1]}) ${line.trim()}`);
      }
    });
  }
  return { found, violations };
}

function main() {
  const { found, violations } = scanSuppressions(ROOT, ALLOWLIST);
  console.log(`suppressions scanned: ${found} (allowlisted: ${ALLOWLIST.length})`);
  if (violations.length) {
    console.error(`FAIL: unapproved suppression found:\n${violations.join('\n')}`);
    process.exit(1);
  }
  console.log('OK: no unapproved suppression');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
