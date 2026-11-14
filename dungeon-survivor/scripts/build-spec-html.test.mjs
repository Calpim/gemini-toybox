import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFeature,
  buildTraceabilityGraph,
  renderHtml,
  loadFeaturesFromDir,
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
});
