import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFeature,
  buildTraceabilityGraph,
  renderHtml,
  loadFeaturesFromDir,
  parseGlossary,
  parseParameters,
  parseStateTransitions,
  parseInvariants,
  parseDecisionLog,
  loadExtendedSpecs,
  validateExtendedSpecs,
} from './build-spec-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('build-spec-html', () => {
  it('parses Japanese Gherkin with tags and data tables', () => {
    const sample = `# language: ja
@APP-LAYER
機能: サンプル機能
  説明テキスト

  @APP-TEST-01 @ref:BIZ-TEST-01 @Inferred
  シナリオ: テーブル付きシナリオ
    前提 初期状態である
      | ID | 値 |
      | a  | 10 |
    もし 行動する
    ならば 結果になる
`;
    const parsed = parseFeature(sample, 'sample.feature');
    assert.equal(parsed.name, 'サンプル機能');
    assert.equal(parsed.scenarios.length, 1);
    assert.deepEqual(parsed.scenarios[0].ownTags, ['@APP-TEST-01', '@ref:BIZ-TEST-01', '@Inferred']);
    assert.equal(parsed.scenarios[0].steps[0].table.length, 2);
    assert.deepEqual(parsed.scenarios[0].steps[0].table[1], ['a', '10']);
  });

  it('links actual project business and app feature files with zero broken links', () => {
    const biz = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'business'));
    const app = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'app'));
    const graph = buildTraceabilityGraph(biz, app);

    assert.ok(graph.stats.bizCount >= 10, 'Expected at least 10 business scenarios');
    assert.ok(graph.stats.appCount >= 10, 'Expected at least 10 app scenarios');
    assert.equal(graph.unlinkedBiz.length, 0, `Unlinked BIZ: ${graph.unlinkedBiz.join(', ')}`);
    assert.equal(graph.orphanApps.length, 0, `Orphan APP: ${JSON.stringify(graph.orphanApps)}`);

    const html = renderHtml(graph);
    assert.match(html, /BIZ-EXP-01/);
    assert.match(html, /BIZ-CMB-04/);
    assert.match(html, /不採用/);
    assert.match(html, /APP-BOS-01/);
    assert.match(html, /回復の泉/);
  });

  it('detects broken @ref links and unlinked business scenarios', () => {
    const biz = [
      parseFeature(
        `# language: ja
機能: BIZ
  @BIZ-1 @Confirmed
  シナリオ: B1
    前提 A
`,
        'b.feature'
      ),
    ];
    const app = [
      parseFeature(
        `# language: ja
機能: APP
  @APP-1 @ref:BIZ-MISSING @Inferred
  シナリオ: A1
    前提 A
`,
        'a.feature'
      ),
    ];
    const graph = buildTraceabilityGraph(biz, app);
    assert.deepEqual(graph.unlinkedBiz, ['BIZ-1']);
    assert.equal(graph.orphanApps.length, 1);
    assert.equal(graph.stats.brokenCount, 2);
  });

  it('parses glossary, parameters, state transitions (with mermaid), invariants, and decision log formats', () => {
    const glossary = parseGlossary(
      `# 用語集
| ID | 用語 | 別名・コード表記 | 定義 | 状態 | 関連ID | 出典・備考 |
| --- | --- | --- | --- | --- | --- | --- |
| GLS-X1 | テスト用語 | \`testTerm\` | 説明 | Disputed | BIZ-X1 | note |
`,
      '/tmp/specs/glossary.md'
    );
    assert.equal(glossary.relativePath, 'specs/glossary.md');
    assert.equal(glossary.items.length, 1);
    assert.equal(glossary.items[0].status, 'Disputed');
    assert.deepEqual(glossary.items[0].refs, ['BIZ-X1']);

    const params = parseParameters(
      `# パラメータ表
| ID | カテゴリ | パラメータ名 | 現行値 | 単位・形式 | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-X1 | 戦闘 | 射程 | \`180\` | \`px\` | Inferred | GLS-X1 | \`src/game/equipment.ts\` |
`,
      '/tmp/specs/parameters.md'
    );
    assert.equal(params.items[0].id, 'PRM-X1');
    assert.equal(params.items[0].status, 'Inferred');
    assert.equal(params.items[0].value, '`180`');

    const transitions = parseStateTransitions(
      `# 状態遷移図
\`\`\`mermaid
stateDiagram-v2
  playing --> gameover : hp <= 0
\`\`\`
| ID | 遷移元 | トリガー・条件 | 遷移先 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-X1 | playing | ポーズ | 未定義 | Unknown | PRM-X1 | 保留 |
`,
      '/tmp/specs/state-transitions.md'
    );
    assert.equal(transitions.mermaidBlocks.length, 1);
    assert.match(transitions.mermaidBlocks[0], /stateDiagram-v2/);
    assert.equal(transitions.items[0].isUndefined, true);
    assert.equal(transitions.items[0].status, 'Unknown');

    const invariants = parseInvariants(
      `# 不変条件
| ID | 分類 | 不変条件 | 検証箇所 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| INV-X1 | HP | 0以上 | test | Confirmed | PRM-X1 | ok |
`,
      '/tmp/specs/invariants.md'
    );
    assert.equal(invariants.items[0].id, 'INV-X1');

    const decisions = parseDecisionLog(
      `# 決定ログ
| ID | 日付 | 決定者 | 決定事項 | 理由・背景 | 状態 | 状態遷移 | 関連ID | 再検討トリガー |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEC-X1 | 2026-11-14 | 先輩 | 決定 | 理由 | Confirmed | Inferred → Confirmed | GLS-X1 | トリガー |
`,
      '/tmp/specs/decisions.md'
    );
    assert.equal(decisions.items[0].id, 'DEC-X1');
    assert.equal(decisions.items[0].transition, 'Inferred → Confirmed');
  });

  it('validates extended spec ID references with zero broken links and renders dashboard, source links, filters, and mermaid fallback', () => {
    const biz = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'business'));
    const app = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'app'));
    const graph = buildTraceabilityGraph(biz, app);
    const extended = loadExtendedSpecs(projectRoot);
    const validation = validateExtendedSpecs(graph, extended);

    assert.ok(extended.glossary && extended.glossary.items.length >= 10);
    assert.ok(extended.parameters && extended.parameters.items.length >= 10);
    assert.ok(extended.stateTransitions && extended.stateTransitions.items.length >= 8);
    assert.ok(extended.invariants && extended.invariants.items.length >= 5);
    assert.ok(extended.decisions && extended.decisions.items.length >= 5);

    assert.equal(
      validation.brokenDocRefs.length,
      0,
      `Broken extended doc refs: ${JSON.stringify(validation.brokenDocRefs)}`
    );
    assert.ok(validation.disputedTerms.length >= 1, 'Expected at least 1 Disputed term for dashboard');
    assert.ok(
      validation.undefinedTransitions.length >= 1,
      'Expected at least 1 未定義 transition for dashboard'
    );

    const html = renderHtml(graph, 'Dungeon Survivor — 仕様書ビューア', extended);

    // 1. All 7 sections present in single HTML
    for (const secId of [
      'sec-overview',
      'sec-gherkin',
      'sec-glossary',
      'sec-parameters',
      'sec-state-transitions',
      'sec-invariants',
      'sec-decisions',
    ]) {
      assert.match(html, new RegExp(`id="${secId}"`), `Missing section #${secId}`);
    }

    // 2. Disputed terms and 未定義 transitions surfaced in Overview dashboard with counts & links
    assert.match(html, new RegExp(`Disputed（要調整）用語.*${validation.disputedTerms.length}件`, 's'));
    assert.match(html, new RegExp(`「未定義」の状態遷移.*${validation.undefinedTransitions.length}件`, 's'));
    for (const term of validation.disputedTerms) {
      assert.match(html, new RegExp(`href="#${term.id}"`));
    }
    for (const tr of validation.undefinedTransitions) {
      assert.match(html, new RegExp(`href="#${tr.id}"`));
    }

    // 3. Status filter buttons across all 4 core review statuses + search across sections
    for (const f of ['all', 'inferred', 'confirmed', 'disputed', 'unknown']) {
      assert.match(html, new RegExp(`data-filter="${f}"`));
    }
    assert.match(html, /class="spec-row[^"]*"[^>]*data-section="glossary"/);
    assert.match(html, /class="spec-row[^"]*"[^>]*data-section="parameters"/);
    assert.match(html, /class="spec-row[^"]*"[^>]*data-section="transitions"/);
    assert.match(html, /class="spec-row[^"]*"[^>]*data-section="invariants"/);
    assert.match(html, /class="spec-row[^"]*"[^>]*data-section="decisions"/);

    // 4. Mermaid source + client render + raw source fallback included
    assert.match(html, /id="mermaidDiagram"/);
    assert.match(html, /id="mermaidSource"/);
    assert.match(html, /stateDiagram-v2/);
    assert.match(html, /フォールバック/);

    // 5. Parameter & Glossary rows link to source file and item ID
    assert.match(html, /href="\.\.\/specs\/glossary\.md#GLS-01"/);
    assert.match(html, /href="\.\.\/specs\/parameters\.md#PRM-01"/);
  });

  it('detects broken ID references inside extended specification documents', () => {
    const graph = buildTraceabilityGraph([], []);
    const brokenExtended = {
      glossary: parseGlossary(
        `| ID | 用語 | 別名・コード表記 | 定義 | 状態 | 関連ID | 出典・備考 |
| --- | --- | --- | --- | --- | --- | --- |
| GLS-1 | T | a | def | Disputed | MISSING-ID-999 | note |
`,
        'specs/glossary.md'
      ),
      parameters: null,
      stateTransitions: parseStateTransitions(
        `| ID | 遷移元 | トリガー・条件 | 遷移先 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-1 | playing | ev | 未定義 | Unknown | GLS-1 | ok |
`,
        'specs/state-transitions.md'
      ),
      invariants: null,
      decisions: null,
    };
    const validation = validateExtendedSpecs(graph, brokenExtended);
    assert.equal(validation.brokenDocRefs.length, 1);
    assert.deepEqual(validation.brokenDocRefs[0], {
      sourceId: 'GLS-1',
      sourceFile: 'specs/glossary.md',
      missingRef: 'MISSING-ID-999',
    });
    assert.equal(validation.disputedTerms.length, 1);
    assert.equal(validation.undefinedTransitions.length, 1);
  });
});
