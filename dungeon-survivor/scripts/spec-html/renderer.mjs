import { buildFormulaChartsData } from './charts.mjs';
import { resolveDecisionAddendums } from './parser.mjs';
import { validateExtendedSpecs } from './validator.mjs';

const REPO_SPEC_BLOB_BASE = 'https://github.com/Calpim/gemini-toybox/blob/main/dungeon-survivor/';

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStatusBadge(status, statusOrigin = 'human') {
  if (status === 'Confirmed' && statusOrigin === 'ai') {
    return `<span class="badge badge-confirmed-ai">確定 (AI提案)</span>`;
  }
  const map = {
    Confirmed: { label: 'Confirmed（決定済み）', cls: 'badge-confirmed' },
    Inferred: { label: 'Inferred（AI仮提案・要確認）', cls: 'badge-inferred' },
    Implemented: { label: 'Implemented（実装済み）', cls: 'badge-implemented' },
    Disputed: { label: 'Disputed（要調整）', cls: 'badge-disputed' },
    Unknown: { label: 'Unknown（未確定）', cls: 'badge-unknown' },
  };
  const info = map[status] || map.Unknown;
  return `<span class="badge ${info.cls}">${escapeHtml(info.label)}</span>`;
}

function renderSteps(steps) {
  return `<ul class="steps">
    ${steps
      .map((st) => {
        const tableHtml = st.table
          ? `<div class="table-wrap"><table>
              <thead><tr>${st.table[0].map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
              <tbody>${st.table
                .slice(1)
                .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
                .join('')}</tbody>
            </table></div>`
          : '';
        return `<li><span class="kw">${escapeHtml(st.keyword)}</span><span class="st-text">${escapeHtml(st.text)}</span>${tableHtml}</li>`;
      })
      .join('')}
  </ul>`;
}

function renderBackgroundBox(bg) {
  if (!bg?.steps || bg.steps.length === 0) return '';
  const title = bg.name ? `背景: ${bg.name}` : '背景・決定経緯';
  return `<div class="bg-box">
    <div class="bg-title">📋 ${escapeHtml(title)}</div>
    <ul class="bg-steps">
      ${bg.steps.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')}
    </ul>
  </div>`;
}

function renderSourceLink(sourceFile, itemId) {
  const rel = sourceFile || '';
  const idPart = itemId ? `#${itemId}` : '';
  const localHref = `../${rel}${idPart}`;
  const ghHref = `${REPO_SPEC_BLOB_BASE}${rel}`;
  return `<div class="source-cell">
    <a class="source-link" href="${escapeHtml(localHref)}" data-source-file="${escapeHtml(rel)}" data-item-id="${escapeHtml(itemId || '')}" title="元仕様ファイル ${escapeHtml(rel)} (${escapeHtml(itemId || '')})">${escapeHtml(rel)}${escapeHtml(idPart)}</a>
    <a class="gh-link" href="${escapeHtml(ghHref)}" target="_blank" rel="noopener" title="GitHubで元ファイルを開く">GitHub ↗</a>
  </div>`;
}

function renderRefLinks(refs) {
  if (!refs || refs.length === 0) return '<span class="muted-text">-</span>';
  return `<div class="ref-list">${refs
    .map((ref) => `<a class="ref-pill ref-link" href="#${escapeHtml(ref)}">${escapeHtml(ref)}</a>`)
    .join('')}</div>`;
}

function renderInlineCodeText(text) {
  const escaped = escapeHtml(text || '');
  return escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
}

function renderGlossarySection(glossary) {
  if (!glossary) return '';
  const rows = glossary.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="glossary" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><strong>${escapeHtml(item.term)}</strong>${item.alias ? `<div class="sub-code">${renderInlineCodeText(item.alias)}</div>` : ''}</td>
        <td>${renderInlineCodeText(item.definition)}</td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.sourceNote ? `<div class="note-text">${renderInlineCodeText(item.sourceNote)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-glossary" class="doc-section" data-section-name="glossary">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">GLOSSARY / 用語集</div>
        <h2>📖 用語集 <span class="count-pill" data-section-count="glossary">(${glossary.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(glossary.relativePath, '')}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>用語 / 別名</th><th>定義</th><th>状態</th><th>関連ID</th><th>出典・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="glossary">該当する用語はありません。</div>
    </div>
  </section>`;
}

function renderParametersSection(parameters) {
  if (!parameters) return '';
  const rows = parameters.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="parameters" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><span class="cat-pill">${escapeHtml(item.category)}</span></td>
        <td><strong>${renderInlineCodeText(item.name)}</strong></td>
        <td><span class="param-val">${renderInlineCodeText(item.value)}</span></td>
        <td>${renderInlineCodeText(item.unit)}</td>
        <td>${item.goal ? `<div class="note-text">${renderInlineCodeText(item.goal)}</div>` : '<span class="muted-text empty-goal">（空欄・人間確認待ち）</span>'}</td>
        <td>${renderStatusBadge(item.status, item.statusOrigin)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.codeRef ? `<div class="sub-code">${renderInlineCodeText(item.codeRef)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-parameters" class="doc-section" data-section-name="parameters">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">PARAMETERS / パラメータ表</div>
        <h2>🎛️ パラメータ表 <span class="count-pill" data-section-count="parameters">(${parameters.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(parameters.relativePath, '')}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>カテゴリ</th><th>パラメータ名</th><th>現行値</th><th>単位・形式</th><th>狙い（体験目標）</th><th>状態</th><th>関連ID</th><th>元コード・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="parameters">該当するパラメータはありません。</div>
    </div>
  </section>`;
}

function renderFormulasSection(formulas, parameters) {
  if (!formulas) return '';
  const charts = buildFormulaChartsData(parameters);
  const chartsHtml = charts
    .map((chart) => {
      const thead = chart.columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
      const tbody = chart.rows
        .map(
          (row) =>
            `<tr>${chart.columns
              .map((col) => `<td><code>${escapeHtml(String(row[col.key] ?? ''))}</code></td>`)
              .join('')}</tr>`,
        )
        .join('');
      const payloadJson = escapeHtml(JSON.stringify(chart));
      return `
      <div class="formula-chart-card" data-chart-id="${escapeHtml(chart.id)}" data-chart-payload="${payloadJson}">
        <div class="formula-chart-head">
          <div>
            <h3>📈 ${escapeHtml(chart.title)}</h3>
            <div class="sub-code">${renderInlineCodeText(chart.formulaExpr)}</div>
            <div class="ref-list" style="margin-top:6px;">
              ${chart.formulaIds.map((id) => `<a class="id-pill id-doc" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join('')}
              ${chart.paramRefs.map((id) => `<a class="ref-pill ref-link" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join('')}
            </div>
          </div>
          <button type="button" class="mini-btn toggle-formula-table-btn" data-target-chart="${escapeHtml(chart.id)}">式・数表表示切替</button>
        </div>
        <div class="formula-chart-status muted-text" data-chart-status-for="${escapeHtml(chart.id)}">📊 描画未実行のため式と数表を表示しています（フォールバック）</div>
        <div class="formula-chart-canvas hidden" data-chart-canvas-for="${escapeHtml(chart.id)}"></div>
        <div class="formula-fallback-wrap" data-chart-fallback-for="${escapeHtml(chart.id)}">
          <table class="doc-table formula-fallback-table">
            <thead><tr>${thead}</tr></thead>
            <tbody>${tbody}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join('');

  const rows = formulas.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="formulas" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><strong>${renderInlineCodeText(item.name)}</strong></td>
        <td><div class="formula-expr">${renderInlineCodeText(item.formula)}</div></td>
        <td>${renderInlineCodeText(item.inputs)}</td>
        <td>${renderInlineCodeText(item.output)}</td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.codeRef ? `<div class="sub-code">${renderInlineCodeText(item.codeRef)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-formulas" class="doc-section" data-section-name="formulas">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">FORMULAS / 計算式シート</div>
        <h2>🧮 計算式シート <span class="count-pill" data-section-count="formulas">(${formulas.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(formulas.relativePath, '')}
    </div>
    <div class="formula-charts-grid" id="formulaChartsGrid">
      ${chartsHtml}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>名称</th><th>式（PRM参照）</th><th>入力</th><th>出力と単位</th><th>状態</th><th>関連ID</th><th>元コード・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="formulas">該当する計算式はありません。</div>
    </div>
  </section>`;
}

function renderOpenQuestionsSection(openQuestions) {
  if (!openQuestions) return '';
  const rows = openQuestions.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="open-questions" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><strong>${renderInlineCodeText(item.topic)}</strong></td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td><div class="note-text">${renderInlineCodeText(item.trigger)}</div></td>
        <td><div class="note-text">${renderInlineCodeText(item.impact)}</div>${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-open-questions" class="doc-section" data-section-name="open-questions">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">OPEN QUESTIONS / 未決事項リスト</div>
        <h2>❓ 未決事項リスト <span class="count-pill" data-section-count="open-questions">(${openQuestions.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(openQuestions.relativePath, '')}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>論点</th><th>状態</th><th>関連ID（相互リンク）</th><th>決めるタイミング・トリガー</th><th>保留している間の影響・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="open-questions">該当する未決事項はありません。</div>
    </div>
  </section>`;
}

function renderNonGoalsSection(nonGoals) {
  if (!nonGoals) return '';
  const rows = nonGoals.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="non-goals" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><strong>${renderInlineCodeText(item.item)}</strong></td>
        <td><div class="note-text">${renderInlineCodeText(item.reason)}</div></td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-non-goals" class="doc-section" data-section-name="non-goals">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">NON-GOALS / やらないことリスト</div>
        <h2>🚫 やらないことリスト <span class="count-pill" data-section-count="non-goals">(${nonGoals.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(nonGoals.relativePath, '')}
    </div>
    <div class="nongoal-banner">🛑 <strong>宣言:</strong> ${escapeHtml(nonGoals.declaration)}</div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>やらないこと</th><th>理由</th><th>状態</th><th>関連ID・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="non-goals">該当する項目はありません。</div>
    </div>
  </section>`;
}

function renderStateTransitionsSection(stateTransitions) {
  if (!stateTransitions) return '';
  const mermaidSrc = stateTransitions.mermaidBlocks[0] || '';
  const rows = stateTransitions.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row ${item.isUndefined ? 'row-undefined' : ''}" data-section="transitions" data-status="${escapeHtml(item.status)}" data-undefined="${item.isUndefined ? 'true' : 'false'}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td>${renderInlineCodeText(item.from)}</td>
        <td>${renderInlineCodeText(item.trigger)}</td>
        <td>${item.isUndefined ? `<span class="undef-pill">⚠️ ${escapeHtml(item.to)}</span>` : renderInlineCodeText(item.to)}</td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.note ? `<div class="note-text">${renderInlineCodeText(item.note)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-state-transitions" class="doc-section" data-section-name="transitions">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">STATE TRANSITIONS / 状態遷移図</div>
        <h2>🔀 状態遷移図 <span class="count-pill" data-section-count="transitions">(${stateTransitions.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(stateTransitions.relativePath, '')}
    </div>

    ${
      mermaidSrc
        ? `<div class="mermaid-card">
            <div class="mermaid-toolbar">
              <span id="mermaidStatus" class="mermaid-status">⏳ Mermaid 図を描画中（失敗時はソース表示に自動切替）</span>
              <button type="button" id="toggleMermaidSourceBtn" class="mini-btn">Mermaid ソース表示切替</button>
            </div>
            <div id="mermaidDiagram" class="mermaid-diagram hidden"></div>
            <pre id="mermaidSource" class="mermaid-source"><code>${escapeHtml(mermaidSrc)}</code></pre>
          </div>`
        : ''
    }

    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>遷移元</th><th>トリガー・条件</th><th>遷移先</th><th>状態</th><th>関連ID</th><th>備考・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="transitions">該当する状態遷移はありません。</div>
    </div>
  </section>`;
}

function renderInvariantsSection(invariants) {
  if (!invariants) return '';
  const rows = invariants.items
    .map(
      (item) => `
      <tr id="${escapeHtml(item.id)}" class="spec-row" data-section="invariants" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}">
        <td><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td><span class="cat-pill">${escapeHtml(item.category)}</span></td>
        <td>${renderInlineCodeText(item.condition)}</td>
        <td><div class="sub-code">${renderInlineCodeText(item.verification)}</div></td>
        <td>${renderStatusBadge(item.status)}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.note ? `<div class="note-text">${renderInlineCodeText(item.note)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-invariants" class="doc-section" data-section-name="invariants">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">INVARIANTS / 不変条件</div>
        <h2>🛡️ 不変条件 <span class="count-pill" data-section-count="invariants">(${invariants.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(invariants.relativePath, '')}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>分類</th><th>不変条件</th><th>検証箇所</th><th>状態</th><th>関連ID</th><th>備考・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="invariants">該当する不変条件はありません。</div>
    </div>
  </section>`;
}

function renderDecisionsSection(decisions) {
  if (!decisions) return '';
  const { addendumsByBaseId, overrideAddendumsByTargetId, matchedAddendumIds } = resolveDecisionAddendums(decisions);

  const renderDecisionRow = (
    item,
    { isOverridden = false, isAddendum = false, baseId = '', overrideLinks = [] } = {},
  ) => {
    const rowClasses = [
      'spec-row',
      isOverridden ? 'decision-overridden-row' : '',
      isAddendum ? 'decision-addendum-row' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const parentAttr = isAddendum && baseId ? ` data-parent-id="${escapeHtml(baseId)}"` : '';
    const overrideHtml = isOverridden
      ? `<div class="sub-code"><span class="badge badge-overridden">上書きあり</span></div>${
          overrideLinks.length > 0
            ? `<div class="override-link-list">${overrideLinks
                .map(
                  (ad) =>
                    `<a class="ref-pill ref-link override-addendum-link" href="#${escapeHtml(ad.id)}">↳ ${escapeHtml(ad.id)}</a>`,
                )
                .join('')}</div>`
            : ''
        }`
      : '';
    const idCell = isAddendum
      ? `<span class="addendum-indent">↳</span><a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a>`
      : `<a class="id-pill id-doc" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a>${overrideHtml}`;

    return `
      <tr id="${escapeHtml(item.id)}" class="${rowClasses}" data-section="decisions" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}"${parentAttr}>
        <td>${idCell}</td>
        <td><span class="date-pill">${escapeHtml(item.date)}</span><div class="sub-code">${escapeHtml(item.decider)}</div></td>
        <td><strong>${renderInlineCodeText(item.decision)}</strong><div class="note-text">${renderInlineCodeText(item.reason)}</div></td>
        <td>${renderStatusBadge(item.status)}${item.transition ? `<div class="sub-code">${escapeHtml(item.transition)}</div>` : ''}</td>
        <td>${renderRefLinks(item.refs)}</td>
        <td>${item.revisitTrigger ? `<div class="note-text">${renderInlineCodeText(item.revisitTrigger)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`;
  };

  const renderedRows = [];
  for (const item of decisions.items) {
    if (matchedAddendumIds.has(item.id)) continue;
    const attached = addendumsByBaseId.get(item.id) || [];
    const overrideRefs = overrideAddendumsByTargetId.get(item.id) || [];
    const isOverridden = attached.length > 0 || overrideRefs.length > 0;
    renderedRows.push(renderDecisionRow(item, { isOverridden, overrideLinks: overrideRefs }));
    for (const addendum of attached) {
      renderedRows.push(renderDecisionRow(addendum, { isAddendum: true, baseId: item.id }));
    }
  }
  const rows = renderedRows.join('');

  return `
  <section id="sec-decisions" class="doc-section" data-section-name="decisions">
    <div class="section-head">
      <div>
        <div class="section-eyebrow">DECISION LOG / 決定ログ</div>
        <h2>🧭 決定ログ <span class="count-pill" data-section-count="decisions">(${decisions.items.length}件)</span></h2>
      </div>
      ${renderSourceLink(decisions.relativePath, '')}
    </div>
    <div class="doc-table-wrap">
      <table class="doc-table">
        <thead>
          <tr><th>ID</th><th>日付 / 決定者</th><th>決定事項・理由</th><th>状態 / 遷移</th><th>関連ID</th><th>再検討トリガー・元ファイル</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="section-empty hidden" data-empty-for="decisions">該当する決定ログはありません。</div>
    </div>
  </section>`;
}

export function renderHtml(graph, title = 'Dungeon Survivor — 仕様書ビューア', extendedSpecs = null) {
  const { stats, bizScenarios, unlinkedBiz, orphanApps } = graph;
  const extValidation = extendedSpecs ? validateExtendedSpecs(graph, extendedSpecs) : null;
  const hasExtended = Boolean(
    extendedSpecs &&
      (extendedSpecs.glossary ||
        extendedSpecs.parameters ||
        extendedSpecs.formulas ||
        extendedSpecs.stateTransitions ||
        extendedSpecs.invariants ||
        extendedSpecs.openQuestions ||
        extendedSpecs.nonGoals ||
        extendedSpecs.decisions),
  );

  const traceCards = bizScenarios
    .map((biz) => {
      const appCards =
        biz.linkedApps.length > 0
          ? biz.linkedApps
              .map(
                (app) => `
              <div class="app-card" id="${escapeHtml(app.id)}" data-status="${escapeHtml(app.status)}" data-layer="app">
                <div class="card-head">
                  <div class="id-group">
                    <span class="id-pill id-app">${escapeHtml(app.id)}</span>
                    <span class="ref-pill">↳ ref: ${escapeHtml(biz.id)}</span>
                    <span class="file-pill">${escapeHtml(app.fileName)}</span>
                  </div>
                  ${renderStatusBadge(app.status, app.statusOrigin)}
                </div>
                ${app.isFirstInFeature ? renderBackgroundBox(app.featureBackground) : ''}
                <h4>${escapeHtml(app.name)}</h4>
                ${renderSteps(app.steps)}
              </div>`,
              )
              .join('')
          : `<div class="empty-link">⚠️ 紐づくアプリGherkin（@ref:${escapeHtml(biz.id)}）がまだありません</div>`;

      const statusesInGroup = new Set([biz.status, ...biz.linkedApps.map((a) => a.status)]);
      return `
      <section class="trace-group" data-biz-status="${escapeHtml(biz.status)}" data-has-inferred="${statusesInGroup.has(
        'Inferred',
      )}" data-has-disputed="${statusesInGroup.has('Disputed')}" data-has-unknown="${statusesInGroup.has('Unknown')}">
        <div class="biz-card" id="${escapeHtml(biz.id)}">
          <div class="card-head">
            <div class="id-group">
              <span class="id-pill id-biz">${escapeHtml(biz.id)}</span>
              <span class="file-pill">${escapeHtml(biz.fileName)}</span>
              <span class="feature-pill">${escapeHtml(biz.featureName)}</span>
            </div>
            ${renderStatusBadge(biz.status, biz.statusOrigin)}
          </div>
          ${biz.isFirstInFeature ? renderBackgroundBox(biz.featureBackground) : ''}
          <h3>${escapeHtml(biz.name)}</h3>
          ${renderSteps(biz.steps)}
        </div>
        <details class="app-accordion">
          <summary class="app-accordion-summary">
            <span class="app-accordion-title">⚙️ アプリ仕様（開発・テスト目線）</span>
            <span class="app-accordion-meta">${biz.linkedApps.map((a) => escapeHtml(a.id)).join(', ') || '未紐付け'} (${biz.linkedApps.length}件)</span>
            <span class="app-accordion-hint"></span>
          </summary>
          <div class="app-branch">
            ${appCards}
          </div>
        </details>
      </section>`;
    })
    .join('');

  const orphanBanner =
    unlinkedBiz.length > 0 || orphanApps.length > 0
      ? `<div class="warn-banner">
          <strong>⚠️ トレーサビリティ不整合検知:</strong>
          ${unlinkedBiz.length ? `未紐付けBIZ: ${escapeHtml(unlinkedBiz.join(', '))} ` : ''}
          ${orphanApps.length ? `孤立APP: ${escapeHtml(orphanApps.map((o) => `${o.appId}(${o.reason})`).join(', '))}` : ''}
        </div>`
      : `<div class="ok-banner">✅ トレーサビリティチェック OK：全 ${stats.bizCount} 件のビジネス仕様と ${stats.appCount} 件のアプリ仕様が ID 紐付けされています</div>`;

  const extRefBanner = extValidation
    ? extValidation.brokenDocRefs.length > 0
      ? `<div class="warn-banner">
          <strong>⚠️ 拡張仕様ID参照リンク切れ検知 (${extValidation.brokenDocRefs.length}件):</strong>
          ${escapeHtml(
            extValidation.brokenDocRefs.map((b) => `${b.sourceId}(${b.sourceFile}) -> ${b.missingRef}`).join(', '),
          )}
        </div>`
      : `<div class="ok-banner">✅ 拡張ドキュメントID参照チェック OK：全 ${extValidation.allDocItemsCount} 件の関連IDにリンク切れはありません</div>`
    : '';

  const disputedTerms = extValidation ? extValidation.disputedTerms : [];
  const undefinedTransitions = extValidation ? extValidation.undefinedTransitions : [];

  const disputedDashboardHtml = `
    <div class="dash-panel dash-disputed">
      <div class="dash-panel-head">
        <h3>🚨 Disputed（要調整）用語 <span class="count-pill-red">${disputedTerms.length}件</span></h3>
        <span class="dash-sub">仕様と現行実装に齟齬がある用語</span>
      </div>
      ${
        disputedTerms.length > 0
          ? `<ul class="dash-list">
              ${disputedTerms
                .map(
                  (t) => `<li class="dash-item" data-status="${escapeHtml(t.status)}">
                    <div class="dash-item-head">
                      <a class="id-pill id-doc" href="#${escapeHtml(t.id)}">${escapeHtml(t.id)}</a>
                      <strong>${escapeHtml(t.term)}</strong>
                      ${renderStatusBadge(t.status)}
                    </div>
                    <div class="dash-item-desc">${renderInlineCodeText(t.definition)}</div>
                    ${renderSourceLink(t.sourceFile, t.id)}
                  </li>`,
                )
                .join('')}
            </ul>`
          : `<div class="dash-empty">Disputed な用語はありません。</div>`
      }
    </div>`;

  const undefinedTransitionsHtml = `
    <div class="dash-panel dash-undefined">
      <div class="dash-panel-head">
        <h3>⚠️ 「未定義」の状態遷移 <span class="count-pill-amber">${undefinedTransitions.length}件</span></h3>
        <span class="dash-sub">遷移先が未定義・未実装の遷移</span>
      </div>
      ${
        undefinedTransitions.length > 0
          ? `<ul class="dash-list">
              ${undefinedTransitions
                .map(
                  (tr) => `<li class="dash-item" data-status="${escapeHtml(tr.status)}">
                    <div class="dash-item-head">
                      <a class="id-pill id-doc" href="#${escapeHtml(tr.id)}">${escapeHtml(tr.id)}</a>
                      <span class="trans-chain">${renderInlineCodeText(tr.from)} → ${renderInlineCodeText(tr.trigger)} → <span class="undef-pill">${escapeHtml(tr.to)}</span></span>
                      ${renderStatusBadge(tr.status)}
                    </div>
                    ${tr.note ? `<div class="dash-item-desc">${renderInlineCodeText(tr.note)}</div>` : ''}
                    ${renderSourceLink(tr.sourceFile, tr.id)}
                  </li>`,
                )
                .join('')}
            </ul>`
          : `<div class="dash-empty">未定義の状態遷移はありません。</div>`
      }
    </div>`;

  const statusTotals = extValidation
    ? extValidation.statusTotals
    : {
        Confirmed: stats.confirmedCount,
        Inferred: stats.inferredCount,
        Disputed: 0,
        Unknown: 0,
      };

  const navBarHtml = `
    <nav class="section-nav" aria-label="仕様セクション移動">
      <a class="nav-pill" href="#sec-overview">📊 概要</a>
      <a class="nav-pill" href="#sec-gherkin">🔗 ビジネス仕様 (${stats.bizCount}/${stats.appCount})</a>
      ${extendedSpecs?.glossary ? `<a class="nav-pill" href="#sec-glossary">📖 用語集 (${extendedSpecs.glossary.items.length})</a>` : ''}
      ${extendedSpecs?.parameters ? `<a class="nav-pill" href="#sec-parameters">🎛️ パラメータ表 (${extendedSpecs.parameters.items.length})</a>` : ''}
      ${extendedSpecs?.formulas ? `<a class="nav-pill" href="#sec-formulas">🧮 計算式 (${extendedSpecs.formulas.items.length})</a>` : ''}
      ${extendedSpecs?.stateTransitions ? `<a class="nav-pill" href="#sec-state-transitions">🔀 状態遷移図 (${extendedSpecs.stateTransitions.items.length})</a>` : ''}
      ${extendedSpecs?.invariants ? `<a class="nav-pill" href="#sec-invariants">🛡️ 不変条件 (${extendedSpecs.invariants.items.length})</a>` : ''}
      ${extendedSpecs?.openQuestions ? `<a class="nav-pill" href="#sec-open-questions">❓ 未決事項 (${extendedSpecs.openQuestions.items.length})</a>` : ''}
      ${extendedSpecs?.nonGoals ? `<a class="nav-pill" href="#sec-non-goals">🚫 やらないこと (${extendedSpecs.nonGoals.items.length})</a>` : ''}
      ${extendedSpecs?.decisions ? `<a class="nav-pill" href="#sec-decisions">🧭 決定ログ (${extendedSpecs.decisions.items.length})</a>` : ''}
    </nav>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #070b14;
      --surface: #0f1626;
      --surface-2: #151f34;
      --border: #24324d;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --biz: #38bdf8;
      --app: #a78bfa;
      --confirmed: #34d399;
      --inferred: #fbbf24;
      --disputed: #f87171;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
      background: radial-gradient(circle at top right, #111b33, var(--bg) 55%);
      color: var(--text);
      line-height: 1.6;
      padding: 24px 16px 64px;
    }
    .container { max-width: 1140px; margin: 0 auto; }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 16px;
    }
    .eyebrow, .section-eyebrow {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--biz);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 { margin: 6px 0 8px; font-size: 26px; }
    h2 { margin: 4px 0 0; font-size: 20px; color: #f8fafc; }
    .subtitle { margin: 0; color: var(--muted); font-size: 14px; }
    .section-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .nav-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 11px;
      border-radius: 999px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: #cbd5e1;
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
    }
    .nav-pill:hover { border-color: #60a5fa; color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 14px 0 16px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .stat-label { font-size: 12px; color: var(--muted); }
    .stat-val { font-size: 23px; font-weight: 800; margin-top: 2px; }
    .ok-banner, .warn-banner {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 12px;
    }
    .ok-banner { background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.35); color: #6ee7b7; }
    .warn-banner { background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.4); color: #fca5a5; }
    .dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
      margin-top: 14px;
      margin-bottom: 18px;
    }
    .dash-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .dash-disputed { border-top: 3px solid var(--disputed); }
    .dash-undefined { border-top: 3px solid var(--inferred); }
    .dash-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .dash-panel-head h3 { margin: 0; font-size: 15px; }
    .dash-sub { font-size: 11px; color: var(--muted); }
    .dash-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dash-item {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 10px 12px;
    }
    .dash-item-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .dash-item-desc { font-size: 12px; color: #cbd5e1; margin-bottom: 4px; }
    .dash-empty { font-size: 13px; color: var(--muted); padding: 6px 0; }
    .count-pill { font-size: 13px; font-weight: 600; color: var(--muted); margin-left: 6px; }
    .count-pill-red { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(248, 113, 113, 0.2); color: #fca5a5; }
    .count-pill-amber { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(251, 191, 36, 0.2); color: #fde68a; }
    .controls {
      position: sticky;
      top: 8px;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 22px;
      background: rgba(15, 22, 38, 0.95);
      backdrop-filter: blur(8px);
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .tab-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }
    .tab-btn.active {
      background: #1d4ed8;
      border-color: #60a5fa;
      color: #fff;
    }
    .search-input {
      margin-left: auto;
      min-width: 210px;
      flex: 1;
      max-width: 300px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
    }
    .doc-section {
      margin-bottom: 34px;
      scroll-margin-top: 76px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 10px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .trace-group {
      margin-bottom: 20px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(15, 22, 38, 0.72);
      overflow: hidden;
    }
    .biz-card {
      padding: 16px 18px;
      border-left: 4px solid var(--biz);
      background: var(--surface);
      scroll-margin-top: 84px;
    }
    .app-accordion {
      border-top: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.35);
    }
    .app-accordion-summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 18px;
      font-size: 12.5px;
      color: var(--muted);
      user-select: none;
      transition: background 0.15s ease;
    }
    .app-accordion-summary::-webkit-details-marker { display: none; }
    .app-accordion-summary:hover {
      background: rgba(167, 139, 250, 0.08);
      color: var(--text);
    }
    .app-accordion-title {
      font-weight: 700;
      color: var(--app);
    }
    .app-accordion-meta {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #cbd5e1;
      background: rgba(167, 139, 250, 0.12);
      border: 1px solid rgba(167, 139, 250, 0.3);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .app-accordion-hint {
      margin-left: auto;
      font-size: 11px;
      color: var(--muted);
    }
    .app-accordion-hint::before { content: '▶ 展開する'; }
    .app-accordion[open] > .app-accordion-summary .app-accordion-hint::before { content: '▼ 折りたたむ'; }
    .app-branch {
      padding: 12px 18px 16px 28px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .app-card {
      padding: 14px 16px;
      border-radius: 10px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-left: 4px solid var(--app);
      scroll-margin-top: 84px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .id-group, .ref-list { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .id-pill, .ref-pill, .file-pill, .feature-pill, .cat-pill, .date-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      text-decoration: none;
    }
    .id-biz { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700; }
    .id-app { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.4); font-weight: 700; }
    .id-doc { background: rgba(52, 211, 153, 0.14); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.35); font-weight: 700; display: inline-block; }
    .id-doc:hover { border-color: #6ee7b7; background: rgba(52, 211, 153, 0.25); }
    .ref-pill { background: rgba(148, 163, 184, 0.12); color: #cbd5e1; }
    .ref-link:hover { background: rgba(56, 189, 248, 0.22); color: #fff; }
    .file-pill { color: var(--muted); background: rgba(15, 23, 42, 0.8); }
    .feature-pill { color: #93c5fd; font-family: inherit; }
    .cat-pill { background: rgba(99, 102, 241, 0.16); color: #c7d2fe; font-family: inherit; }
    .date-pill { background: rgba(148, 163, 184, 0.15); color: #e2e8f0; }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .badge-confirmed { background: rgba(52, 211, 153, 0.16); color: var(--confirmed); border: 1px solid rgba(52, 211, 153, 0.4); }
    .badge-confirmed-ai { background: rgba(45, 212, 191, 0.15); color: #5eead4; border: 1px dashed rgba(94, 234, 212, 0.55); }
    .badge-inferred { background: rgba(251, 191, 36, 0.16); color: var(--inferred); border: 1px solid rgba(251, 191, 36, 0.45); }
    .badge-implemented { background: rgba(56, 189, 248, 0.16); color: var(--biz); border: 1px solid rgba(56, 189, 248, 0.4); }
    .badge-disputed { background: rgba(248, 113, 113, 0.16); color: var(--disputed); border: 1px solid rgba(248, 113, 113, 0.4); }
    .badge-unknown { background: rgba(148, 163, 184, 0.16); color: var(--muted); border: 1px solid rgba(148, 163, 184, 0.35); }
    .badge-overridden { background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); }
    .decision-addendum-row { background: rgba(56, 189, 248, 0.05); }
    .decision-addendum-row td:first-child { padding-left: 22px; border-left: 3px solid rgba(56, 189, 248, 0.55); }
    .addendum-indent { color: #38bdf8; font-weight: 700; margin-right: 4px; }
    .override-link-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    h3 { margin: 4px 0 10px; font-size: 17px; color: #f8fafc; }
    h4 { margin: 4px 0 10px; font-size: 15px; color: #f1f5f9; }
    .steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .steps li { font-size: 14px; }
    .kw {
      display: inline-block;
      min-width: 58px;
      font-weight: 700;
      color: #60a5fa;
      margin-right: 6px;
    }
    .table-wrap { overflow-x: auto; margin: 8px 0 4px 64px; }
    .doc-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .doc-table {
      background: transparent;
      border: none;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .doc-table th { background: rgba(30, 41, 59, 0.9); color: #cbd5e1; white-space: nowrap; }
    .doc-table tr.spec-row:target, .biz-card:target, .app-card:target {
      outline: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.1);
    }
    .doc-table tr.row-undefined { background: rgba(251, 191, 36, 0.05); }
    .param-val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: #7dd3fc; }
    .sub-code { font-size: 11px; color: var(--muted); margin-top: 3px; }
    .note-text { font-size: 12px; color: #cbd5e1; margin-top: 2px; }
    .muted-text { color: var(--muted); }
    .inline-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.92em;
      background: rgba(30, 41, 59, 0.85);
      padding: 1px 5px;
      border-radius: 4px;
      color: #e2e8f0;
    }
    .source-cell { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 3px; }
    .source-link {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #93c5fd;
      text-decoration: none;
    }
    .source-link:hover { text-decoration: underline; }
    .gh-link {
      font-size: 10px;
      color: var(--muted);
      text-decoration: none;
      border: 1px solid var(--border);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .gh-link:hover { color: #fff; border-color: #60a5fa; }
    .undef-pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(251, 191, 36, 0.18);
      color: #fde68a;
      border: 1px solid rgba(251, 191, 36, 0.45);
    }
    .trans-chain { font-size: 13px; }
    .mermaid-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .mermaid-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .mermaid-status { font-size: 12px; color: var(--muted); }
    .mini-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .mermaid-diagram {
      overflow-x: auto;
      padding: 10px;
      border-radius: 8px;
      background: rgba(7, 11, 20, 0.7);
      text-align: center;
    }
    .mermaid-source {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      overflow-x: auto;
      color: #cbd5e1;
      white-space: pre;
    }
    .bg-box {
      margin: 8px 0 12px;
      padding: 10px 12px;
      border-radius: 9px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px dashed rgba(148, 163, 184, 0.4);
      font-size: 12px;
      color: #cbd5e1;
    }
    .bg-title {
      font-weight: 700;
      color: #93c5fd;
      margin-bottom: 4px;
    }
    .bg-steps {
      margin: 0;
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .empty-link { color: #fca5a5; font-size: 13px; padding: 8px; }
    .section-empty { padding: 14px; font-size: 13px; color: var(--muted); text-align: center; }
    .empty-goal { font-size: 11px; font-style: italic; }
    .formula-expr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #cbd5e1; word-break: break-word; }
    .nongoal-banner {
      padding: 12px 16px;
      border-radius: 10px;
      background: rgba(248, 113, 113, 0.12);
      border: 1px solid rgba(248, 113, 113, 0.45);
      color: #fecaca;
      font-size: 13px;
      margin-bottom: 14px;
    }
    .formula-charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .formula-chart-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .formula-chart-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .formula-chart-head h3 { margin: 0 0 4px; font-size: 14px; }
    .formula-chart-status { font-size: 11px; }
    .formula-chart-canvas {
      background: rgba(7, 11, 20, 0.72);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      overflow-x: auto;
    }
    .formula-chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
      color: #cbd5e1;
      margin-bottom: 4px;
    }
    .legend-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 4px;
    }
    .formula-fallback-wrap { overflow-x: auto; }
    .formula-fallback-table { font-size: 11px; }
    .formula-fallback-table th, .formula-fallback-table td { padding: 4px 7px; text-align: right; }
    .formula-fallback-table th:first-child, .formula-fallback-table td:first-child { text-align: left; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="eyebrow">BDD / Living Specification Hub</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">
        ビジネス仕様（@BIZ-*）・アプリ仕様（@APP-*）の自動紐付けと、用語集・パラメータ表・計算式シート・状態遷移図・不変条件・未決事項・やらないこと・決定ログを横断確認できるレビュー用HTMLです。
        状態フィルタで <strong>Inferred / Disputed / Unknown</strong> など要確認項目だけを全セクションから絞り込めます。
      </p>
    </header>

    ${navBarHtml}

    <section id="sec-overview" class="doc-section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">OVERVIEW DASHBOARD / 概要</div>
          <h2>📊 概要ダッシュボード</h2>
        </div>
      </div>

      <div class="stats">
        <div class="stat-card"><div class="stat-label">ビジネス仕様 (@BIZ)</div><div class="stat-val" style="color:var(--biz)">${stats.bizCount}</div></div>
        <div class="stat-card"><div class="stat-label">アプリ仕様 (@APP)</div><div class="stat-val" style="color:var(--app)">${stats.appCount}</div></div>
        <div class="stat-card"><div class="stat-label">確定済み (Confirmed)</div><div class="stat-val" style="color:var(--confirmed)">${statusTotals.Confirmed}</div></div>
        <div class="stat-card"><div class="stat-label">AI仮提案 (Inferred)</div><div class="stat-val" style="color:var(--inferred)">${statusTotals.Inferred}</div></div>
        <div class="stat-card"><div class="stat-label">要調整 (Disputed)</div><div class="stat-val" style="color:var(--disputed)">${statusTotals.Disputed}</div></div>
        <div class="stat-card"><div class="stat-label">未確定 (Unknown)</div><div class="stat-val" style="color:var(--muted)">${statusTotals.Unknown}</div></div>
      </div>

      ${orphanBanner}
      ${extRefBanner}

      ${hasExtended ? `<div class="dash-grid">${disputedDashboardHtml}${undefinedTransitionsHtml}</div>` : ''}
    </section>

    <div class="controls">
      <button class="tab-btn active" data-filter="all">🔗 すべて表示</button>
      <button class="tab-btn" data-filter="inferred">⚠️ Inferred（要確認）のみ</button>
      <button class="tab-btn" data-filter="confirmed">✅ Confirmed のみ</button>
      <button class="tab-btn" data-filter="disputed">🚨 Disputed のみ</button>
      <button class="tab-btn" data-filter="unknown">❔ Unknown のみ</button>
      <input type="search" class="search-input" id="searchBox" placeholder="ID・キーワードで全セクション検索（例: 泉, PRM-06, FML-01, OQ-01, NG-01）" />
    </div>

    <section id="sec-gherkin" class="doc-section" data-section-name="gherkin">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">BUSINESS &amp; APP GHERKIN / ビジネス仕様（既存）</div>
          <h2>🔗 ビジネス仕様・アプリ仕様トレーサビリティ <span class="count-pill" data-section-count="gherkin">(${stats.bizCount}件)</span></h2>
        </div>
        <button type="button" class="tab-btn" id="toggleAllAppsBtn">⚙️ アプリ仕様をすべて開く</button>
      </div>
      <main id="specList">
        ${traceCards}
      </main>
      <div class="section-empty hidden" data-empty-for="gherkin">該当するシナリオはありません。</div>
    </section>

    ${renderGlossarySection(extendedSpecs?.glossary)}
    ${renderParametersSection(extendedSpecs?.parameters)}
    ${renderFormulasSection(extendedSpecs?.formulas, extendedSpecs?.parameters)}
    ${renderStateTransitionsSection(extendedSpecs?.stateTransitions)}
    ${renderInvariantsSection(extendedSpecs?.invariants)}
    ${renderOpenQuestionsSection(extendedSpecs?.openQuestions)}
    ${renderNonGoalsSection(extendedSpecs?.nonGoals)}
    ${renderDecisionsSection(extendedSpecs?.decisions)}
  </div>

  <script>
    const buttons = document.querySelectorAll('.tab-btn');
    const searchBox = document.getElementById('searchBox');
    const groups = document.querySelectorAll('.trace-group');
    const specRows = document.querySelectorAll('.spec-row');
    const dashItems = document.querySelectorAll('.dash-item');
    let activeFilter = 'all';

    function matchesStatusFilter(status, filter) {
      if (filter === 'all') return true;
      return String(status || '').toLowerCase() === filter;
    }

    function applyFilters() {
      const q = searchBox.value.trim().toLowerCase();

      // 1. Existing Gherkin traceability groups (preserve exact behavior for all/inferred/confirmed + support disputed/unknown)
      let visibleGherkin = 0;
      for (const group of groups) {
        const text = (group.textContent || '').toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const hasInferred = group.dataset.hasInferred === 'true';
        const hasDisputed = group.dataset.hasDisputed === 'true';
        const hasUnknown = group.dataset.hasUnknown === 'true';
        const isConfirmedBiz = group.dataset.bizStatus === 'Confirmed';

        let matchesTab = true;
        if (activeFilter === 'inferred') matchesTab = hasInferred;
        if (activeFilter === 'confirmed') matchesTab = isConfirmedBiz;
        if (activeFilter === 'disputed') matchesTab = hasDisputed;
        if (activeFilter === 'unknown') matchesTab = hasUnknown;

        const showGroup = matchesSearch && matchesTab;
        group.classList.toggle('hidden', !showGroup);
        if (showGroup) visibleGherkin++;

        const appCards = group.querySelectorAll('.app-card');
        for (const card of appCards) {
          if (activeFilter === 'inferred') {
            card.classList.toggle('hidden', card.dataset.status !== 'Inferred' && group.dataset.bizStatus !== 'Inferred');
          } else if (activeFilter === 'disputed') {
            card.classList.toggle('hidden', card.dataset.status !== 'Disputed' && group.dataset.bizStatus !== 'Disputed');
          } else if (activeFilter === 'unknown') {
            card.classList.toggle('hidden', card.dataset.status !== 'Unknown' && group.dataset.bizStatus !== 'Unknown');
          } else {
            card.classList.remove('hidden');
          }
        }
      }

      const gherkinCount = document.querySelector('[data-section-count="gherkin"]');
      if (gherkinCount) {
        gherkinCount.textContent = '(' + visibleGherkin + ' / ' + groups.length + '件)';
      }
      const gherkinEmpty = document.querySelector('[data-empty-for="gherkin"]');
      if (gherkinEmpty) {
        gherkinEmpty.classList.toggle('hidden', visibleGherkin > 0);
      }

      // 2. Extended documentation sections (glossary, parameters, formulas, transitions, invariants, open-questions, non-goals, decisions)
      const sectionCounts = new Map();
      const sectionTotals = new Map();
      for (const row of specRows) {
        const sec = row.dataset.section || 'other';
        sectionTotals.set(sec, (sectionTotals.get(sec) || 0) + 1);
        const text = (row.textContent || '').toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const matchesStatus = matchesStatusFilter(row.dataset.status, activeFilter);
        const show = matchesSearch && matchesStatus;
        row.classList.toggle('hidden', !show);
        if (show) {
          sectionCounts.set(sec, (sectionCounts.get(sec) || 0) + 1);
        }
      }

      for (const [sec, total] of sectionTotals.entries()) {
        const vis = sectionCounts.get(sec) || 0;
        const countEl = document.querySelector('[data-section-count="' + sec + '"]');
        if (countEl) countEl.textContent = '(' + vis + ' / ' + total + '件)';
        const emptyEl = document.querySelector('[data-empty-for="' + sec + '"]');
        if (emptyEl) emptyEl.classList.toggle('hidden', vis > 0);
      }

      // 3. Overview dashboard Disputed & Undefined lists
      for (const item of dashItems) {
        const text = (item.textContent || '').toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const matchesStatus = matchesStatusFilter(item.dataset.status, activeFilter);
        item.classList.toggle('hidden', !(matchesSearch && matchesStatus));
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    searchBox.addEventListener('input', () => {
      applyFilters();
      const q = searchBox.value.trim().toLowerCase();
      if (q) {
        document.querySelectorAll('.app-accordion').forEach((acc) => {
          const appText = (acc.querySelector('.app-branch')?.textContent || '').toLowerCase();
          if (appText.includes(q)) acc.open = true;
        });
      }
    });

    const toggleAllAppsBtn = document.getElementById('toggleAllAppsBtn');
    const appAccordions = Array.from(document.querySelectorAll('.app-accordion'));
    let allAppsExpanded = false;
    if (toggleAllAppsBtn) {
      toggleAllAppsBtn.addEventListener('click', () => {
        allAppsExpanded = !allAppsExpanded;
        appAccordions.forEach((acc) => { acc.open = allAppsExpanded; });
        toggleAllAppsBtn.textContent = allAppsExpanded
          ? '⚙️ アプリ仕様をすべて折りたたむ'
          : '⚙️ アプリ仕様をすべて開く';
      });
    }

    function openAccordionForHash() {
      const id = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      const acc = target.closest('.app-accordion');
      if (acc) {
        acc.open = true;
        requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
    }
    window.addEventListener('hashchange', openAccordionForHash);
    openAccordionForHash();

    // Formula charts inside #sec-formulas only, with fallback to expression + numeric table
    (function initFormulaChartsWithFallback() {
      const formulasSection = document.getElementById('sec-formulas');
      if (!formulasSection) return;
      const cards = formulasSection.querySelectorAll('.formula-chart-card');

      function renderChartSvg(chart) {
        const rows = Array.isArray(chart.rows) ? chart.rows : [];
        const series = Array.isArray(chart.series) ? chart.series : [];
        if (rows.length < 2 || series.length === 0) {
          throw new Error('Insufficient chart series');
        }
        const W = 440;
        const H = 190;
        const padL = 44;
        const padR = 16;
        const padT = 16;
        const padB = 28;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('width', '100%');
        svg.setAttribute('style', 'max-height:200px;display:block;');

        // Grid lines
        for (let g = 0; g <= 4; g++) {
          const gy = padT + (plotH * g) / 4;
          const line = document.createElementNS(svgNs, 'line');
          line.setAttribute('x1', String(padL));
          line.setAttribute('x2', String(W - padR));
          line.setAttribute('y1', gy.toFixed(1));
          line.setAttribute('y2', gy.toFixed(1));
          line.setAttribute('stroke', 'rgba(148,163,184,0.18)');
          line.setAttribute('stroke-width', '1');
          svg.appendChild(line);
        }

        // Normalize each series independently to 0..100% height when units differ,
        // or shared scale when all series share the same unit.
        const units = new Set(series.map((s) => s.unit || ''));
        const sharedMax = units.size === 1
          ? Math.max(1, ...series.flatMap((s) => rows.map((r) => Number(r[s.key]) || 0)))
          : null;

        series.forEach((s, sIdx) => {
          const vals = rows.map((r) => Number(r[s.key]) || 0);
          const maxV = sharedMax !== null ? sharedMax : Math.max(1, ...vals);
          const pts = vals.map((v, i) => {
            const x = padL + (plotW * i) / (rows.length - 1);
            const y = padT + plotH * (1 - v / maxV);
            return [x, y, v];
          });

          const path = document.createElementNS(svgNs, 'polyline');
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', s.color);
          path.setAttribute('stroke-width', '2.2');
          path.setAttribute('points', pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
          svg.appendChild(path);

          for (let i = 0; i < pts.length; i++) {
            const [px, py, val] = pts[i];
            const dot = document.createElementNS(svgNs, 'circle');
            dot.setAttribute('cx', px.toFixed(1));
            dot.setAttribute('cy', py.toFixed(1));
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', s.color);
            const titleEl = document.createElementNS(svgNs, 'title');
            titleEl.textContent = chart.xLabel + '=' + rows[i][chart.xLabel] + ' / ' + s.label + ': ' + val;
            dot.appendChild(titleEl);
            svg.appendChild(dot);
          }

          if (sIdx === 0) {
            const maxLabel = document.createElementNS(svgNs, 'text');
            maxLabel.setAttribute('x', String(padL - 4));
            maxLabel.setAttribute('y', String(padT + 8));
            maxLabel.setAttribute('text-anchor', 'end');
            maxLabel.setAttribute('fill', '#94a3b8');
            maxLabel.setAttribute('font-size', '9');
            maxLabel.textContent = String(maxV);
            svg.appendChild(maxLabel);

            const zeroLabel = document.createElementNS(svgNs, 'text');
            zeroLabel.setAttribute('x', String(padL - 4));
            zeroLabel.setAttribute('y', String(padT + plotH));
            zeroLabel.setAttribute('text-anchor', 'end');
            zeroLabel.setAttribute('fill', '#94a3b8');
            zeroLabel.setAttribute('font-size', '9');
            zeroLabel.textContent = '0';
            svg.appendChild(zeroLabel);
          }
        });

        // X-axis labels (first, middle, last)
        const labelIdxs = [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
        for (const idx of new Set(labelIdxs)) {
          const lx = padL + (plotW * idx) / (rows.length - 1);
          const tx = document.createElementNS(svgNs, 'text');
          tx.setAttribute('x', lx.toFixed(1));
          tx.setAttribute('y', String(H - 8));
          tx.setAttribute('text-anchor', 'middle');
          tx.setAttribute('fill', '#94a3b8');
          tx.setAttribute('font-size', '9');
          tx.textContent = chart.xLabel + ' ' + rows[idx][chart.xLabel];
          svg.appendChild(tx);
        }

        const legend = document.createElement('div');
        legend.className = 'formula-chart-legend';
        for (const s of series) {
          const span = document.createElement('span');
          span.innerHTML = '<span class="legend-dot" style="background:' + s.color + '"></span>' + s.label;
          legend.appendChild(span);
        }

        const wrapper = document.createElement('div');
        wrapper.appendChild(legend);
        wrapper.appendChild(svg);
        return wrapper;
      }

      cards.forEach((card) => {
        const chartId = card.dataset.chartId;
        const canvasEl = card.querySelector('[data-chart-canvas-for="' + chartId + '"]');
        const fallbackEl = card.querySelector('[data-chart-fallback-for="' + chartId + '"]');
        const statusEl = card.querySelector('[data-chart-status-for="' + chartId + '"]');
        const toggleBtn = card.querySelector('.toggle-formula-table-btn');
        let chartRendered = false;

        try {
          const chart = JSON.parse(card.dataset.chartPayload || '{}');
          const chartNode = renderChartSvg(chart);
          if (canvasEl) {
            canvasEl.innerHTML = '';
            canvasEl.appendChild(chartNode);
            canvasEl.classList.remove('hidden');
            if (fallbackEl) fallbackEl.classList.add('hidden');
            if (statusEl) statusEl.textContent = '✅ 計算式グラフを描画済み（パラメータ表と連動）';
            chartRendered = true;
          }
        } catch (err) {
          if (canvasEl) canvasEl.classList.add('hidden');
          if (fallbackEl) fallbackEl.classList.remove('hidden');
          if (statusEl) {
            statusEl.textContent = '⚠️ グラフ描画に失敗したため式と数表を表示しています（フォールバック）';
          }
        }

        if (toggleBtn && fallbackEl) {
          toggleBtn.addEventListener('click', () => {
            if (!chartRendered) {
              fallbackEl.classList.remove('hidden');
              return;
            }
            fallbackEl.classList.toggle('hidden');
          });
        }
      });
    })();

    // Client-side Mermaid rendering with guaranteed raw-source fallback on failure
    (async function initMermaidWithFallback() {
      const diagramEl = document.getElementById('mermaidDiagram');
      const sourceEl = document.getElementById('mermaidSource');
      const statusEl = document.getElementById('mermaidStatus');
      const toggleBtn = document.getElementById('toggleMermaidSourceBtn');
      if (!diagramEl || !sourceEl) return;

      const rawSource = (sourceEl.textContent || '').trim();
      let renderedOk = false;

      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          if (!renderedOk) {
            sourceEl.classList.remove('hidden');
            return;
          }
          const sourceHidden = sourceEl.classList.toggle('hidden');
          diagramEl.classList.toggle('hidden', !sourceHidden);
        });
      }

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Mermaid load timeout')), 4500)
        );
        const mod = window.mermaid
          ? { default: window.mermaid }
          : await Promise.race([
              import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'),
              timeoutPromise,
            ]);
        const mermaid = mod.default || mod;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
        });
        const result = await mermaid.render('dungeonSurvivorStateSvg', rawSource);
        if (!result || !result.svg) {
          throw new Error('Empty Mermaid SVG output');
        }
        diagramEl.innerHTML = result.svg;
        diagramEl.classList.remove('hidden');
        sourceEl.classList.add('hidden');
        renderedOk = true;
        if (statusEl) {
          statusEl.textContent = '✅ Mermaid 状態遷移図を描画済み';
        }
      } catch (err) {
        // Fallback: keep raw Mermaid source visible cleanly
        diagramEl.classList.add('hidden');
        sourceEl.classList.remove('hidden');
        if (statusEl) {
          statusEl.textContent =
            '⚠️ Mermaid 描画に失敗したためソースをそのまま表示しています（フォールバック）';
        }
      }
    })();
  </script>
</body>
</html>`;
}
