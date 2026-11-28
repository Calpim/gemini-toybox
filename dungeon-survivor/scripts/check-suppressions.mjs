// 抑制コメントの新規追加を止めるゲート。
// 許可はこの ALLOWLIST への追記（= PR差分に必ず出る）でのみ行う。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src', 'scripts'];
const SELF = 'scripts/check-suppressions.mjs';
const ALLOWLIST = [
  // 既存の唯一の抑制（2026-11-28 main実測）。noExcessiveCognitiveComplexity の抑制は許可しない。
  { file: 'src/styles/theme.css', rule: 'noImportantStyles' },
];
const MARKER = ['biome', 'ignore'].join('-');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|mjs|css)$/.test(name)) yield p;
  }
}

let found = 0;
const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel === SELF) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(MARKER)) return;
      found++;
      const m = line.match(/lint\/[a-z]+\/([A-Za-z]+)/);
      if (!m) {
        violations.push(`${rel}:${i + 1}  (unscoped or unrecognized suppression) ${line.trim()}`);
        return;
      }
      const ok = ALLOWLIST.some((a) => a.file === rel && a.rule === m[1]);
      if (!ok) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
}
console.log(`suppressions scanned: ${found} (allowlisted: ${ALLOWLIST.length})`);
if (violations.length) {
  console.error(`FAIL: unapproved suppression found:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('OK: no unapproved suppression');
