import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { evaluateComplexityReport } from './check-complexity-ratchet.mjs';
import { scanSuppressions } from './check-suppressions.mjs';

const MARKER = ['biome', 'ignore'].join('-');

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-gates-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-suppressions gate', () => {
  it('detects unapproved suppressions in .tsx, .js, and root-level .ts files', () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'vite.config.ts'), `// ${MARKER} lint/complexity/noExcessiveCognitiveComplexity: root\n`);
      writeFileSync(join(dir, 'src', 'App.tsx'), `// ${MARKER} lint/suspicious/noExplicitAny: tsx\n`);
      writeFileSync(join(dir, 'src', 'helper.js'), `// ${MARKER} lint/style/useConst: js\n`);

      const { found, violations } = scanSuppressions(dir, []);
      assert.equal(found, 3);
      assert.equal(violations.length, 3);
      assert.ok(violations.some((v) => v.startsWith('vite.config.ts:1')));
      assert.ok(violations.some((v) => v.startsWith('src/App.tsx:1')));
      assert.ok(violations.some((v) => v.startsWith('src/helper.js:1')));
    });
  });

  it('checks every rule when multiple rules appear on a single suppression line', () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, 'src', 'styles'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'styles', 'theme.css'),
        `/* ${MARKER} lint/complexity/noImportantStyles lint/complexity/noExcessiveCognitiveComplexity: sneaky */\n`,
      );

      const { found, violations } = scanSuppressions(dir, [
        { file: 'src/styles/theme.css', rule: 'noImportantStyles' },
      ]);
      assert.equal(found, 2);
      assert.equal(violations.length, 1);
      assert.match(violations[0], /noExcessiveCognitiveComplexity/);
    });
  });

  it('fails closed on unscoped or unrecognized suppression syntax', () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'main.ts'), `// ${MARKER} lint: broad ignore\n`);

      const { found, violations } = scanSuppressions(dir, []);
      assert.equal(found, 1);
      assert.equal(violations.length, 1);
      assert.match(violations[0], /unscoped or unrecognized/);
    });
  });
});

describe('check-complexity-ratchet gate', () => {
  const baseline = {
    totalWarnings: 1,
    perFile: {
      'src/a.ts': { max: 52, count: 1 },
    },
  };

  it('fails closed when complexity score cannot be parsed from diagnostic message', () => {
    const report = {
      summary: { unchanged: 10, changed: 0 },
      diagnostics: [
        {
          category: 'lint/complexity/noExcessiveCognitiveComplexity',
          location: { path: { file: 'src/a.ts' } },
          message: 'Unexpected biome message format without numeric score',
        },
      ],
    };

    const result = evaluateComplexityReport(report, baseline);
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /unparseable complexity diagnostic/);
  });

  it('detects score increase and passes when within baseline', () => {
    const okReport = {
      summary: { unchanged: 10, changed: 0 },
      diagnostics: [
        {
          category: 'lint/complexity/noExcessiveCognitiveComplexity',
          location: { path: 'src/a.ts' },
          message: 'Excessive complexity of 52 detected (max: 50).',
        },
      ],
    };
    assert.equal(evaluateComplexityReport(okReport, baseline).ok, true);

    const worseReport = {
      summary: { unchanged: 10, changed: 0 },
      diagnostics: [
        {
          category: 'lint/complexity/noExcessiveCognitiveComplexity',
          location: { path: { file: 'src\\a.ts' } },
          message: 'Excessive complexity of 60 detected (max: 50).',
        },
      ],
    };
    const res = evaluateComplexityReport(worseReport, baseline);
    assert.equal(res.ok, false);
    assert.match(res.violations[0], /max 52 -> 60/);
  });
});
