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
  parseFormulas,
  parseOpenQuestions,
  parseNonGoals,
  parseStateTransitions,
  parseInvariants,
  parseDecisionLog,
  resolveDecisionAddendums,
  buildFormulaChartsData,
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

  it('parses @Confirmed @AIProposed Gherkin tags as Confirmed with ai origin', () => {
    const biz = [
      parseFeature(
        `# language: ja
機能: BIZ
  @BIZ-AI-1 @Confirmed
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
  @APP-AI-1 @ref:BIZ-AI-1 @Confirmed @AIProposed
  シナリオ: A1
    前提 A
`,
        'a.feature'
      ),
    ];
    const graph = buildTraceabilityGraph(biz, app);
    assert.equal(graph.stats.brokenCount, 0);
    assert.equal(graph.appScenarios[0].status, 'Confirmed');
    assert.equal(graph.appScenarios[0].statusOrigin, 'ai');
    const html = renderHtml(graph);
    assert.match(html, /確定 \(AI提案\)/);
  });

  it('parses glossary, parameters (with goal), formulas, open-questions, non-goals, state transitions, invariants, and decision log formats', () => {
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
| ID | カテゴリ | パラメータ名 | 現行値 | 単位・形式 | 狙い（体験目標） | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-X1 | 戦闘 | 射程 | \`180\` | \`px\` | 交戦距離の上限を保つ | Inferred | GLS-X1 | \`src/game/equipment.ts\` |
| PRM-X2 | 戦闘 | 予備 | \`10\` | \`px\` |  | Unknown | GLS-X1 | \`src/game/equipment.ts\` |
| PRM-X3 | 戦闘 | 速度 | \`210\` | \`px/s\` | 快適テンポ | Confirmed (AI提案) | GLS-X1 | \`src/game/engine.ts\` |
`,
      '/tmp/specs/parameters.md'
    );
    assert.equal(params.items[0].id, 'PRM-X1');
    assert.equal(params.items[0].status, 'Inferred');
    assert.equal(params.items[0].value, '`180`');
    assert.equal(params.items[0].goal, '交戦距離の上限を保つ');
    assert.equal(params.items[1].goal, '');
    assert.equal(params.items[2].status, 'Confirmed');
    assert.equal(params.items[2].statusOrigin, 'ai');

    const formulas = parseFormulas(
      `# 計算式シート
| ID | 名称 | 式 | 入力（パラメータIDで参照） | 出力と単位 | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FML-X1 | テスト式 | \`x * PRM-X1\` | \`x\`, \`PRM-X1\` | \`値 (px)\` | Inferred | PRM-X1 | \`src/game/engine.ts\` |
`,
      '/tmp/specs/formulas.md'
    );
    assert.equal(formulas.relativePath, 'specs/formulas.md');
    assert.equal(formulas.items.length, 1);
    assert.equal(formulas.items[0].id, 'FML-X1');
    assert.equal(formulas.items[0].status, 'Inferred');
    assert.deepEqual(formulas.items[0].refs, ['PRM-X1']);

    const openQuestions = parseOpenQuestions(
      `# 未決事項リスト
| ID | 論点 | 状態 | 関連ID | 決めるタイミング・トリガー | 保留している間の影響 |
| --- | --- | --- | --- | --- | --- |
| OQ-X1 | 未決論点 | Disputed | GLS-X1 | 次回判断時 | 暫定値で動作 |
`,
      '/tmp/specs/open-questions.md'
    );
    assert.equal(openQuestions.relativePath, 'specs/open-questions.md');
    assert.equal(openQuestions.items[0].id, 'OQ-X1');
    assert.equal(openQuestions.items[0].status, 'Disputed');
    assert.equal(openQuestions.items[0].trigger, '次回判断時');

    const nonGoals = parseNonGoals(
      `# やらないことリスト

> ここに書かれたものは未定義ではなく、意図的に存在しない。AIはこれらを補完・実装・仕様追加しない

| ID | やらないこと | 理由 | 状態 | 関連ID |
| --- | --- | --- | --- | --- |
| NG-X1 | 設置タレット | 放置されるため | Confirmed | DEC-X1 |
`,
      '/tmp/specs/non-goals.md'
    );
    assert.equal(
      nonGoals.declaration,
      'ここに書かれたものは未定義ではなく、意図的に存在しない。AIはこれらを補完・実装・仕様追加しない'
    );
    assert.equal(nonGoals.items[0].id, 'NG-X1');
    assert.equal(nonGoals.items[0].status, 'Confirmed');

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

  it('dynamically updates formula chart values when parameters change', () => {
    const baseParams = parseParameters(
      `| ID | カテゴリ | パラメータ名 | 現行値 | 単位・形式 | 狙い（体験目標） | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-04 | プレイヤー | 経験値 | \`25\`（Lv毎に \`×1.22\`） | \`EXP\` |  | Inferred | BIZ-GRW-01 | engine.ts |
| PRM-17 | 戦闘 | コアショット | \`威力 12 / CD 0.62s / 射程 140px / 発射数閾値 3, 7, 12 SP (最大 4発)\` | \`DMG\` |  | Inferred | APP-CMB-06 | engine.ts |
`,
      'specs/parameters.md'
    );
    const modifiedParams = parseParameters(
      `| ID | カテゴリ | パラメータ名 | 現行値 | 単位・形式 | 狙い（体験目標） | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-04 | プレイヤー | 経験値 | \`50\`（Lv毎に \`×1.50\`） | \`EXP\` |  | Inferred | BIZ-GRW-01 | engine.ts |
| PRM-17 | 戦闘 | コアショット | \`威力 20 / CD 0.50s / 射程 150px / 発射数閾値 2, 5, 10 SP (最大 4発)\` | \`DMG\` |  | Inferred | APP-CMB-06 | engine.ts |
`,
      'specs/parameters.md'
    );

    const chartsBase = buildFormulaChartsData(baseParams);
    const chartsMod = buildFormulaChartsData(modifiedParams);
    assert.equal(chartsBase[0].rows[0].expToNext, 25);
    assert.equal(chartsBase[0].rows[1].expToNext, 31);
    assert.equal(chartsMod[0].rows[0].expToNext, 50);
    assert.equal(chartsMod[0].rows[1].expToNext, 75);
    assert.equal(chartsMod[1].rows[0].damage, 20);
    assert.equal(chartsMod[1].rows[2].shotCount, 2); // sp=2 hits threshold 2 in modifiedParams
  });

  it('validates extended spec ID references with zero broken links and renders all 10 sections, formula charts, and filters', () => {
    const biz = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'business'));
    const app = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'app'));
    const graph = buildTraceabilityGraph(biz, app);
    const extended = loadExtendedSpecs(projectRoot);
    const validation = validateExtendedSpecs(graph, extended);

    assert.ok(extended.glossary && extended.glossary.items.length >= 10);
    assert.ok(extended.parameters && extended.parameters.items.length >= 20);
    assert.ok(extended.formulas && extended.formulas.items.length >= 10);
    assert.ok(extended.stateTransitions && extended.stateTransitions.items.length >= 8);
    assert.ok(extended.invariants && extended.invariants.items.length >= 5);
    assert.ok(extended.openQuestions && extended.openQuestions.items.length >= 5);
    assert.ok(extended.nonGoals && extended.nonGoals.items.length >= 5);
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

    // Every formula row must reference at least one PRM-xx parameter
    for (const fml of extended.formulas.items) {
      assert.match(fml.formula, /PRM-\d{2}/, `Formula ${fml.id} must reference PRM-xx`);
    }

    const html = renderHtml(graph, 'Dungeon Survivor — 仕様書ビューア', extended);

    // 1. All 10 sections present in single HTML
    for (const secId of [
      'sec-overview',
      'sec-gherkin',
      'sec-glossary',
      'sec-parameters',
      'sec-formulas',
      'sec-state-transitions',
      'sec-invariants',
      'sec-open-questions',
      'sec-non-goals',
      'sec-decisions',
    ]) {
      assert.match(html, new RegExp(`id="${secId}"`), `Missing section #${secId}`);
    }

    // 2. Non-goals declaration appears verbatim & Confirmed (AI提案) badge renders
    assert.match(
      html,
      /ここに書かれたものは未定義ではなく、意図的に存在しない。AIはこれらを補完・実装・仕様追加しない/
    );
    assert.match(html, /確定 \(AI提案\)/);

    // 3. Disputed terms and 未定義 transitions surfaced in Overview dashboard with counts & links
    assert.match(html, new RegExp(`Disputed（要調整）用語.*${validation.disputedTerms.length}件`, 's'));
    assert.match(html, new RegExp(`「未定義」の状態遷移.*${validation.undefinedTransitions.length}件`, 's'));
    for (const term of validation.disputedTerms) {
      assert.match(html, new RegExp(`href="#${term.id}"`));
    }
    for (const tr of validation.undefinedTransitions) {
      assert.match(html, new RegExp(`href="#${tr.id}"`));
    }

    // 4. Status filter buttons across all 4 core review statuses + search across sections
    for (const f of ['all', 'inferred', 'confirmed', 'disputed', 'unknown']) {
      assert.match(html, new RegExp(`data-filter="${f}"`));
    }
    for (const sec of [
      'glossary',
      'parameters',
      'formulas',
      'transitions',
      'invariants',
      'open-questions',
      'non-goals',
      'decisions',
    ]) {
      assert.match(html, new RegExp(`class="spec-row[^"]*"[^>]*data-section="${sec}"`));
    }

    // 5. Formula charts + numeric fallback tables exist ONLY inside #sec-formulas
    const chartsActual = buildFormulaChartsData(extended.parameters);
    const coreChart = chartsActual.find((c) => c.id === 'chart-core-shot');
    const skillChart = chartsActual.find((c) => c.id === 'chart-skill-curve');
    assert.ok(coreChart && skillChart);
    assert.equal(coreChart.rows[0].damage, 14);
    assert.equal(coreChart.rows[0].cooldown, 0.58);
    assert.equal(coreChart.rows[0].range, 180);
    assert.equal(coreChart.rows[0].shotCount, 1);
    assert.equal(coreChart.rows[1].range, 200);
    assert.equal(coreChart.rows[1].shotCount, 3);
    assert.equal(coreChart.rows[5].damage, 51);
    assert.equal(coreChart.rows[5].shotCount, 5);
    assert.equal(coreChart.rows[5].cooldown, 0.319);
    assert.equal(coreChart.rows[5].range, 290);
    assert.equal(coreChart.rows[5].dps, 799.4);
    assert.equal(skillChart.rows[2].tier3CumSp, 5);
    assert.equal(skillChart.rows[3].tier3Cost, null);
    assert.equal(skillChart.rows[4].tier1Cost, 2);
    assert.equal(skillChart.rows[5].tier1CumSp, 7);
    assert.equal(skillChart.rows[5].tier2CumSp, 8);
    assert.match(skillChart.formulaExpr, /Lv1-3:1\/Lv4-5:2\(計7SP\)/);
    assert.equal(skillChart.rows[5].armBasePct, 170);
    assert.equal(skillChart.rows[5].armOverclockPct, 45);

    const formulasStart = html.indexOf('<section id="sec-formulas"');
    const transitionsStart = html.indexOf('<section id="sec-state-transitions"');
    assert.ok(formulasStart !== -1 && transitionsStart > formulasStart);
    const formulasSlice = html.slice(formulasStart, transitionsStart);
    const outsideBefore = html.slice(0, formulasStart);
    const outsideAfter = html.slice(transitionsStart);
    assert.match(formulasSlice, /id="formulaChartsGrid"/);
    assert.match(formulasSlice, /class="formula-fallback-wrap"/);
    assert.match(formulasSlice, /chart-exp-curve/);
    assert.match(formulasSlice, /chart-core-shot/);
    assert.match(formulasSlice, /chart-skill-curve/);
    assert.doesNotMatch(outsideBefore, /class="formula-chart-card"/);
    assert.doesNotMatch(outsideAfter, /class="formula-chart-card"/);

    // 6. Mermaid source + client render + raw source fallback included
    assert.match(html, /id="mermaidDiagram"/);
    assert.match(html, /id="mermaidSource"/);
    assert.match(html, /stateDiagram-v2/);
    assert.match(html, /フォールバック/);

    // 7. Source links for glossary, parameters, formulas, open-questions, non-goals
    assert.match(html, /href="\.\.\/specs\/glossary\.md#GLS-01"/);
    assert.match(html, /href="\.\.\/specs\/parameters\.md#PRM-01"/);
    assert.match(html, /href="\.\.\/specs\/formulas\.md#FML-01"/);
    assert.match(html, /href="\.\.\/specs\/open-questions\.md#OQ-01"/);
    assert.match(html, /href="\.\.\/specs\/non-goals\.md#NG-01"/);
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
      formulas: null,
      stateTransitions: parseStateTransitions(
        `| ID | 遷移元 | トリガー・条件 | 遷移先 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-1 | playing | ev | 未定義 | Unknown | GLS-1 | ok |
`,
        'specs/state-transitions.md'
      ),
      invariants: null,
      openQuestions: null,
      nonGoals: null,
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

  it('resolves all actual project decision addendums mechanically and renders overridden badge + grouped rows', () => {
    const biz = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'business'));
    const app = loadFeaturesFromDir(path.join(projectRoot, 'specs', 'app'));
    const graph = buildTraceabilityGraph(biz, app);
    const extended = loadExtendedSpecs(projectRoot);
    const resolved = resolveDecisionAddendums(extended.decisions);

    assert.equal(resolved.unmatchedAddendums.length, 0);
    assert.equal(resolved.matchedAddendumIds.size, 10);
    for (const baseId of [
      'DEC-03',
      'DEC-06',
      'DEC-07',
      'DEC-08',
      'DEC-10',
      'DEC-11',
      'DEC-12',
      'DEC-17',
      'DEC-18',
      'DEC-19',
    ]) {
      const list = resolved.addendumsByBaseId.get(baseId);
      assert.ok(list && list.length === 1, `Expected 1 addendum for ${baseId}`);
      assert.equal(list[0].id, `${baseId}-addendum`);
    }

    const html = renderHtml(graph, 'Dungeon Survivor — 仕様書ビューア', extended);
    const decStart = html.indexOf('<section id="sec-decisions"');
    const decSlice = html.slice(decStart);
    assert.match(decSlice, /id="DEC-10"[\s\S]*?badge-overridden">上書きあり<\/span>[\s\S]*?<\/tr>\s*<tr id="DEC-10-addendum" class="spec-row decision-addendum-row"/);
    assert.equal((decSlice.match(/<tr id="DEC-10-addendum"/g) || []).length, 1);
  });

  it('leaves addendums unmatched when baseId is missing from refs, base DEC does not exist, or naming does not match', () => {
    const decisions = parseDecisionLog(
      `| ID | 日付 | 決定者 | 決定事項 | 理由・背景 | 状態 | 状態遷移 | 関連ID | 再検討トリガー |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEC-01 | 2026-11-14 | 先輩 | 元決定1 | 理由 | Confirmed | - | GLS-01 | - |
| DEC-02 | 2026-11-14 | 先輩 | 元決定2 | 理由 | Confirmed | - | GLS-02 | - |
| DEC-01-addendum | 2026-11-25 | 先輩 | 正しく紐付く追記 | 理由 | Confirmed | 補足 | DEC-01, DEC-02 | - |
| DEC-02-addendum | 2026-11-25 | 先輩 | refsにDEC-02なし | 理由 | Confirmed | 補足 | DEC-01 | - |
| DEC-99-addendum | 2026-11-25 | 先輩 | 元DEC不在 | 理由 | Confirmed | 補足 | DEC-99 | - |
| CUSTOM-addendum | 2026-11-25 | 先輩 | 命名規則外 | 理由 | Confirmed | 補足 | DEC-01 | - |
`,
      'specs/decisions.md'
    );

    const resolved = resolveDecisionAddendums(decisions);
    assert.equal(resolved.matchedAddendumIds.size, 1);
    assert.ok(resolved.matchedAddendumIds.has('DEC-01-addendum'));
    assert.deepEqual(
      resolved.unmatchedAddendums.map((x) => x.id),
      ['DEC-02-addendum', 'DEC-99-addendum', 'CUSTOM-addendum']
    );

    const graph = buildTraceabilityGraph([], []);
    const html = renderHtml(graph, 'Test', { decisions });
    const decSlice = html.slice(html.indexOf('<section id="sec-decisions"'));
    // DEC-01-addendum is grouped right below DEC-01 (before DEC-02) with no duplicate
    assert.match(decSlice, /id="DEC-01"[\s\S]*?上書きあり[\s\S]*?<\/tr>\s*<tr id="DEC-01-addendum" class="spec-row decision-addendum-row"[\s\S]*?<tr id="DEC-02"/);
    assert.equal((decSlice.match(/<tr id="DEC-01-addendum"/g) || []).length, 1);
    // DEC-02 has no matched addendum, so no overridden badge
    assert.doesNotMatch(decSlice, /id="DEC-02"[\s\S]*?上書きあり[\s\S]*?<\/tr>/);
    // Unmatched addendums remain as normal rows without decision-addendum-row class
    assert.match(decSlice, /<tr id="DEC-02-addendum" class="spec-row"/);
    assert.match(decSlice, /<tr id="DEC-99-addendum" class="spec-row"/);
    assert.match(decSlice, /<tr id="CUSTOM-addendum" class="spec-row"/);
  });
});
