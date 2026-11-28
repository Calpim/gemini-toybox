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
    return '<span class="badge badge-confirmed-ai">確定 (AI提案)</span>';
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
    <div class="bg-title">${escapeHtml(title)}</div>
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
    .map((ref) => `<a class="ref-link" href="#${escapeHtml(ref)}">${escapeHtml(ref)}</a>`)
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-term"><strong>${escapeHtml(item.term)}</strong>${item.alias ? `<div class="sub-code">${renderInlineCodeText(item.alias)}</div>` : ''}</td>
        <td class="col-prose">${renderInlineCodeText(item.definition)}</td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.sourceNote ? `<div class="note-text">${renderInlineCodeText(item.sourceNote)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-glossary" class="doc-section" data-section-name="glossary">
    <div class="section-head">
      <h2>用語集 <span class="section-count" data-section-count="glossary">(${glossary.items.length}件)</span></h2>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-cat"><span class="cat-label">${escapeHtml(item.category)}</span></td>
        <td class="col-term"><strong>${renderInlineCodeText(item.name)}</strong></td>
        <td class="col-num"><span class="param-val">${renderInlineCodeText(item.value)}</span></td>
        <td class="col-unit">${renderInlineCodeText(item.unit)}</td>
        <td class="col-prose">${item.goal ? `<div class="note-text">${renderInlineCodeText(item.goal)}</div>` : '<span class="muted-text empty-goal">（空欄・人間確認待ち）</span>'}</td>
        <td class="col-status">${renderStatusBadge(item.status, item.statusOrigin)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.codeRef ? `<div class="sub-code">${renderInlineCodeText(item.codeRef)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-parameters" class="doc-section" data-section-name="parameters">
    <div class="section-head">
      <h2>パラメータ表 <span class="section-count" data-section-count="parameters">(${parameters.items.length}件)</span></h2>
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
          <div class="formula-chart-meta">
            <h3>${escapeHtml(chart.title)}</h3>
            <div class="sub-code">${renderInlineCodeText(chart.formulaExpr)}</div>
            <div class="ref-list formula-chart-refs">
              ${chart.formulaIds.map((id) => `<a class="id-anchor" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join('')}
              ${chart.paramRefs.map((id) => `<a class="ref-link" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join('')}
            </div>
          </div>
          <button type="button" class="mini-btn toggle-formula-table-btn" data-target-chart="${escapeHtml(chart.id)}">数表を表示</button>
        </div>
        <div class="formula-chart-status muted-text" data-chart-status-for="${escapeHtml(chart.id)}">描画未実行のため式と数表を表示しています（フォールバック）</div>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-term"><strong>${renderInlineCodeText(item.name)}</strong></td>
        <td class="col-formula"><div class="formula-expr">${renderInlineCodeText(item.formula)}</div></td>
        <td>${renderInlineCodeText(item.inputs)}</td>
        <td>${renderInlineCodeText(item.output)}</td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.codeRef ? `<div class="sub-code">${renderInlineCodeText(item.codeRef)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-formulas" class="doc-section" data-section-name="formulas">
    <div class="section-head">
      <h2>計算式シート <span class="section-count" data-section-count="formulas">(${formulas.items.length}件)</span></h2>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-term"><strong>${renderInlineCodeText(item.topic)}</strong></td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-prose"><div class="note-text">${renderInlineCodeText(item.trigger)}</div></td>
        <td class="col-source"><div class="note-text">${renderInlineCodeText(item.impact)}</div>${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-open-questions" class="doc-section" data-section-name="open-questions">
    <div class="section-head">
      <h2>未決事項リスト <span class="section-count" data-section-count="open-questions">(${openQuestions.items.length}件)</span></h2>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-term"><strong>${renderInlineCodeText(item.item)}</strong></td>
        <td class="col-prose"><div class="note-text">${renderInlineCodeText(item.reason)}</div></td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-source">${renderRefLinks(item.refs)}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-non-goals" class="doc-section" data-section-name="non-goals">
    <div class="section-head">
      <h2>やらないことリスト <span class="section-count" data-section-count="non-goals">(${nonGoals.items.length}件)</span></h2>
      ${renderSourceLink(nonGoals.relativePath, '')}
    </div>
    <div class="nongoal-banner"><strong>宣言:</strong> ${escapeHtml(nonGoals.declaration)}</div>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td>${renderInlineCodeText(item.from)}</td>
        <td>${renderInlineCodeText(item.trigger)}</td>
        <td>${item.isUndefined ? `<span class="undef-label">${escapeHtml(item.to)}</span>` : renderInlineCodeText(item.to)}</td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.note ? `<div class="note-text">${renderInlineCodeText(item.note)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-state-transitions" class="doc-section" data-section-name="transitions">
    <div class="section-head">
      <h2>状態遷移図 <span class="section-count" data-section-count="transitions">(${stateTransitions.items.length}件)</span></h2>
      ${renderSourceLink(stateTransitions.relativePath, '')}
    </div>

    ${
      mermaidSrc
        ? `<div class="mermaid-block">
            <div class="mermaid-toolbar">
              <span id="mermaidStatus" class="mermaid-status">Mermaid 図を描画中（失敗時はソース表示に自動切替）</span>
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
        <td class="col-id"><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a></td>
        <td class="col-cat"><span class="cat-label">${escapeHtml(item.category)}</span></td>
        <td class="col-prose">${renderInlineCodeText(item.condition)}</td>
        <td><div class="sub-code">${renderInlineCodeText(item.verification)}</div></td>
        <td class="col-status">${renderStatusBadge(item.status)}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.note ? `<div class="note-text">${renderInlineCodeText(item.note)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
      </tr>`,
    )
    .join('');

  return `
  <section id="sec-invariants" class="doc-section" data-section-name="invariants">
    <div class="section-head">
      <h2>不変条件 <span class="section-count" data-section-count="invariants">(${invariants.items.length}件)</span></h2>
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
                    `<a class="ref-link override-addendum-link" href="#${escapeHtml(ad.id)}">↳ ${escapeHtml(ad.id)}</a>`,
                )
                .join('')}</div>`
            : ''
        }`
      : '';
    const idCell = isAddendum
      ? `<span class="addendum-indent">↳</span><a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a>`
      : `<a class="id-anchor" href="#${escapeHtml(item.id)}">${escapeHtml(item.id)}</a>${overrideHtml}`;

    return `
      <tr id="${escapeHtml(item.id)}" class="${rowClasses}" data-section="decisions" data-status="${escapeHtml(item.status)}" data-item-id="${escapeHtml(item.id)}" data-source-file="${escapeHtml(item.sourceFile)}"${parentAttr}>
        <td class="col-id">${idCell}</td>
        <td class="col-date"><span class="date-text">${escapeHtml(item.date)}</span><div class="sub-code">${escapeHtml(item.decider)}</div></td>
        <td class="col-prose"><strong>${renderInlineCodeText(item.decision)}</strong><div class="note-text">${renderInlineCodeText(item.reason)}</div></td>
        <td class="col-status">${renderStatusBadge(item.status)}${item.transition ? `<div class="sub-code">${escapeHtml(item.transition)}</div>` : ''}</td>
        <td class="col-refs">${renderRefLinks(item.refs)}</td>
        <td class="col-source">${item.revisitTrigger ? `<div class="note-text">${renderInlineCodeText(item.revisitTrigger)}</div>` : ''}${renderSourceLink(item.sourceFile, item.id)}</td>
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
      <h2>決定ログ <span class="section-count" data-section-count="decisions">(${decisions.items.length}件)</span></h2>
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

function renderTraceCards(bizScenarios) {
  return bizScenarios
    .map((biz) => {
      const appCards =
        biz.linkedApps.length > 0
          ? biz.linkedApps
              .map(
                (app) => `
              <div class="app-card" id="${escapeHtml(app.id)}" data-status="${escapeHtml(app.status)}" data-layer="app">
                <div class="card-head">
                  <div class="id-group">
                    <span class="id-tag id-app">${escapeHtml(app.id)}</span>
                    <span class="meta-ref">ref: ${escapeHtml(biz.id)}</span>
                    <span class="meta-file">${escapeHtml(app.fileName)}</span>
                  </div>
                  ${renderStatusBadge(app.status, app.statusOrigin)}
                </div>
                ${app.isFirstInFeature ? renderBackgroundBox(app.featureBackground) : ''}
                <h4>${escapeHtml(app.name)}</h4>
                ${renderSteps(app.steps)}
              </div>`,
              )
              .join('')
          : `<div class="empty-link">紐づくアプリGherkin（@ref:${escapeHtml(biz.id)}）がまだありません</div>`;

      const statusesInGroup = new Set([biz.status, ...biz.linkedApps.map((a) => a.status)]);
      return `
      <article class="trace-group" data-biz-status="${escapeHtml(biz.status)}" data-has-inferred="${statusesInGroup.has(
        'Inferred',
      )}" data-has-disputed="${statusesInGroup.has('Disputed')}" data-has-unknown="${statusesInGroup.has('Unknown')}">
        <div class="biz-card" id="${escapeHtml(biz.id)}">
          <div class="card-head">
            <div class="id-group">
              <span class="id-tag id-biz">${escapeHtml(biz.id)}</span>
              <span class="meta-file">${escapeHtml(biz.fileName)}</span>
              <span class="meta-feature">${escapeHtml(biz.featureName)}</span>
            </div>
            ${renderStatusBadge(biz.status, biz.statusOrigin)}
          </div>
          ${biz.isFirstInFeature ? renderBackgroundBox(biz.featureBackground) : ''}
          <h3>${escapeHtml(biz.name)}</h3>
          ${renderSteps(biz.steps)}
        </div>
        <details class="app-accordion">
          <summary class="app-accordion-summary">
            <span class="app-accordion-title">アプリ仕様（開発・テスト目線）</span>
            <span class="app-accordion-meta">${biz.linkedApps.map((a) => escapeHtml(a.id)).join(', ') || '未紐付け'} (${biz.linkedApps.length}件)</span>
            <span class="app-accordion-hint"></span>
          </summary>
          <div class="app-branch">
            ${appCards}
          </div>
        </details>
      </article>`;
    })
    .join('');
}

function renderOverviewPanels(disputedTerms, undefinedTransitions) {
  const disputedHtml = `
    <div class="dash-panel dash-disputed">
      <div class="dash-panel-head">
        <h3>Disputed（要調整）用語 <span class="dash-count dash-count-red">${disputedTerms.length}件</span></h3>
        <span class="dash-sub">仕様と現行実装に齟齬がある用語</span>
      </div>
      ${
        disputedTerms.length > 0
          ? `<ul class="dash-list">
              ${disputedTerms
                .map(
                  (t) => `<li class="dash-item" data-status="${escapeHtml(t.status)}">
                    <div class="dash-item-head">
                      <a class="id-anchor" href="#${escapeHtml(t.id)}">${escapeHtml(t.id)}</a>
                      <strong>${escapeHtml(t.term)}</strong>
                      ${renderStatusBadge(t.status)}
                    </div>
                    <div class="dash-item-desc">${renderInlineCodeText(t.definition)}</div>
                    ${renderSourceLink(t.sourceFile, t.id)}
                  </li>`,
                )
                .join('')}
            </ul>`
          : '<div class="dash-empty">Disputed な用語はありません。</div>'
      }
    </div>`;

  const undefinedHtml = `
    <div class="dash-panel dash-undefined">
      <div class="dash-panel-head">
        <h3>「未定義」の状態遷移 <span class="dash-count dash-count-amber">${undefinedTransitions.length}件</span></h3>
        <span class="dash-sub">遷移先が未定義・未実装の遷移</span>
      </div>
      ${
        undefinedTransitions.length > 0
          ? `<ul class="dash-list">
              ${undefinedTransitions
                .map(
                  (tr) => `<li class="dash-item" data-status="${escapeHtml(tr.status)}">
                    <div class="dash-item-head">
                      <a class="id-anchor" href="#${escapeHtml(tr.id)}">${escapeHtml(tr.id)}</a>
                      <span class="trans-chain">${renderInlineCodeText(tr.from)} → ${renderInlineCodeText(tr.trigger)} → <span class="undef-label">${escapeHtml(tr.to)}</span></span>
                      ${renderStatusBadge(tr.status)}
                    </div>
                    ${tr.note ? `<div class="dash-item-desc">${renderInlineCodeText(tr.note)}</div>` : ''}
                    ${renderSourceLink(tr.sourceFile, tr.id)}
                  </li>`,
                )
                .join('')}
            </ul>`
          : '<div class="dash-empty">未定義の状態遷移はありません。</div>'
      }
    </div>`;

  return `<div class="dash-grid">${disputedHtml}${undefinedHtml}</div>`;
}

function renderNavItems(stats, extendedSpecs) {
  const items = [
    { href: '#sec-overview', label: '概要', count: '' },
    { href: '#sec-gherkin', label: 'ビジネス仕様', count: `${stats.bizCount}/${stats.appCount}` },
  ];
  if (extendedSpecs?.glossary) {
    items.push({ href: '#sec-glossary', label: '用語集', count: String(extendedSpecs.glossary.items.length) });
  }
  if (extendedSpecs?.parameters) {
    items.push({
      href: '#sec-parameters',
      label: 'パラメータ表',
      count: String(extendedSpecs.parameters.items.length),
    });
  }
  if (extendedSpecs?.formulas) {
    items.push({ href: '#sec-formulas', label: '計算式', count: String(extendedSpecs.formulas.items.length) });
  }
  if (extendedSpecs?.stateTransitions) {
    items.push({
      href: '#sec-state-transitions',
      label: '状態遷移図',
      count: String(extendedSpecs.stateTransitions.items.length),
    });
  }
  if (extendedSpecs?.invariants) {
    items.push({ href: '#sec-invariants', label: '不変条件', count: String(extendedSpecs.invariants.items.length) });
  }
  if (extendedSpecs?.openQuestions) {
    items.push({
      href: '#sec-open-questions',
      label: '未決事項',
      count: String(extendedSpecs.openQuestions.items.length),
    });
  }
  if (extendedSpecs?.nonGoals) {
    items.push({ href: '#sec-non-goals', label: 'やらないこと', count: String(extendedSpecs.nonGoals.items.length) });
  }
  if (extendedSpecs?.decisions) {
    items.push({ href: '#sec-decisions', label: '決定ログ', count: String(extendedSpecs.decisions.items.length) });
  }
  return items
    .map(
      (it) =>
        `<a class="nav-link" href="${it.href}" data-nav-target="${it.href.slice(1)}"><span class="nav-label">${escapeHtml(it.label)}</span>${it.count ? `<span class="nav-count">${escapeHtml(it.count)}</span>` : ''}</a>`,
    )
    .join('');
}

function renderStyles() {
  return `
    :root {
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-subtle: #f1f3f6;
      --border: #dde2e8;
      --border-strong: #c5cdd6;
      --text: #161b22;
      --text-secondary: #3c444d;
      --muted: #59636e;
      --accent: #1d4ed8;
      --accent-soft: #eff4ff;
      --biz: #0369a1;
      --app: #6d28d9;
      --confirmed: #15803d;
      --confirmed-bg: #f0fdf4;
      --confirmed-border: #bbf7d0;
      --confirmed-ai: #0f766e;
      --confirmed-ai-bg: #f0fdfa;
      --confirmed-ai-border: #99f6e4;
      --inferred: #b45309;
      --inferred-bg: #fffbeb;
      --inferred-border: #fde68a;
      --disputed: #b91c1c;
      --disputed-bg: #fef2f2;
      --disputed-border: #fecaca;
      --unknown: #475569;
      --unknown-bg: #f1f5f9;
      --unknown-border: #cbd5e1;
      --font-sans: "Inter", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --text-heading: 1.25rem;
      --text-body: 0.9375rem;
      --text-sm: 0.8125rem;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --sidebar-w: 244px;
    }

    *, *::before, *::after { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      line-height: 1.65;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--accent); }
    code, pre { font-family: var(--font-mono); }

    /* Layout shell */
    .layout-shell {
      display: flex;
      min-height: 100vh;
      max-width: 1440px;
      margin: 0 auto;
    }

    .sidebar {
      width: var(--sidebar-w);
      flex: 0 0 var(--sidebar-w);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 20px 14px 28px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .sidebar-brand {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      padding: 0 8px 12px;
      border-bottom: 1px solid var(--border);
      line-height: 1.35;
    }
    .sidebar-brand span {
      display: block;
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--muted);
      margin-top: 2px;
    }

    .section-nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 6px;
      text-decoration: none;
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--text-secondary);
      border-left: 2px solid transparent;
      transition: background-color 180ms var(--ease-out), color 180ms var(--ease-out), border-color 180ms var(--ease-out);
    }
    .nav-link:hover {
      background: var(--surface-subtle);
      color: var(--text);
    }
    .nav-link.active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
      border-left-color: var(--accent);
    }
    .nav-count {
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--muted);
    }
    .nav-link.active .nav-count {
      color: var(--accent);
    }

    .main-column {
      flex: 1 1 auto;
      min-width: 0;
      padding: 28px 36px 72px;
    }

    /* Mobile top bar (hidden on desktop) */
    .mobile-nav-bar {
      display: none;
    }

    /* Page header */
    .doc-header {
      padding-bottom: 18px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1.25;
      color: var(--text);
    }
    .subtitle {
      margin: 0;
      max-width: 65ch;
      font-size: var(--text-body);
      color: var(--text-secondary);
    }

    h2 {
      margin: 0;
      font-size: var(--text-heading);
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--text);
      line-height: 1.35;
    }
    h3 {
      margin: 0 0 8px;
      font-size: var(--text-body);
      font-weight: 700;
      color: var(--text);
      line-height: 1.4;
    }
    h4 {
      margin: 0 0 8px;
      font-size: var(--text-body);
      font-weight: 600;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    /* Overview stats strip */
    .stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .stat-card {
      background: var(--surface);
      padding: 12px 14px;
    }
    .stat-label {
      font-size: var(--text-sm);
      color: var(--muted);
      line-height: 1.35;
    }
    .stat-val {
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      margin-top: 2px;
      line-height: 1.2;
    }

    .ok-banner, .warn-banner {
      padding: 10px 14px;
      border-radius: 6px;
      font-size: var(--text-sm);
      margin-bottom: 10px;
      border-left: 3px solid transparent;
    }
    .ok-banner {
      background: var(--confirmed-bg);
      border: 1px solid var(--confirmed-border);
      border-left-color: var(--confirmed);
      color: #14532d;
    }
    .warn-banner {
      background: var(--disputed-bg);
      border: 1px solid var(--disputed-border);
      border-left-color: var(--disputed);
      color: #7f1d1d;
    }

    /* Overview attention panels (no nested cards) */
    .dash-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .dash-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .dash-disputed { border-top: 3px solid var(--disputed); }
    .dash-undefined { border-top: 3px solid var(--inferred); }
    .dash-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 6px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
    }
    .dash-panel-head h3 { margin: 0; }
    .dash-sub { font-size: var(--text-sm); color: var(--muted); }
    .dash-count {
      font-size: var(--text-sm);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      margin-left: 4px;
    }
    .dash-count-red { color: var(--disputed); }
    .dash-count-amber { color: var(--inferred); }
    .dash-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .dash-item {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .dash-item:last-child { border-bottom: none; padding-bottom: 2px; }
    .dash-item-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .dash-item-desc {
      font-size: var(--text-sm);
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .dash-empty {
      font-size: var(--text-sm);
      color: var(--muted);
      padding: 10px 0 2px;
    }

    /* Sticky filter & search toolbar */
    .controls {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 0 -8px 24px;
      padding: 10px 8px;
      background: rgba(246, 247, 249, 0.94);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
    }
    .filter-segmented {
      display: inline-flex;
      flex-wrap: wrap;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 2px;
      gap: 2px;
    }
    .tab-btn {
      background: transparent;
      color: var(--text-secondary);
      border: none;
      padding: 6px 11px;
      border-radius: 6px;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      transition: background-color 160ms var(--ease-out), color 160ms var(--ease-out);
    }
    .tab-btn:hover {
      background: var(--surface-subtle);
      color: var(--text);
    }
    .tab-btn.active {
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
    }
    .action-btn {
      background: var(--surface);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 6px;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      transition: border-color 160ms var(--ease-out), color 160ms var(--ease-out), background-color 160ms var(--ease-out);
    }
    .action-btn:hover {
      border-color: var(--border-strong);
      background: var(--surface-subtle);
      color: var(--text);
    }
    .search-input {
      margin-left: auto;
      min-width: 220px;
      flex: 1 1 240px;
      max-width: 340px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 8px;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      transition: border-color 160ms var(--ease-out);
    }
    .search-input:focus {
      outline: 2px solid var(--accent);
      outline-offset: -1px;
      border-color: var(--accent);
    }

    /* Sections */
    .doc-section {
      margin-bottom: 40px;
      scroll-margin-top: 68px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 10px;
      padding-bottom: 10px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border-strong);
    }
    .section-count {
      font-size: var(--text-sm);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
      margin-left: 6px;
    }

    /* Gherkin traceability groups (flat surface + dividers, no nested cards) */
    .trace-group {
      margin-bottom: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      overflow: hidden;
    }
    .biz-card {
      padding: 16px 20px;
      border-left: 3px solid var(--biz);
      scroll-margin-top: 76px;
    }
    .app-accordion {
      border-top: 1px solid var(--border);
      background: var(--surface-subtle);
    }
    .app-accordion-summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 20px;
      font-size: var(--text-sm);
      color: var(--text-secondary);
      user-select: none;
      transition: background-color 160ms var(--ease-out), color 160ms var(--ease-out);
    }
    .app-accordion-summary::-webkit-details-marker { display: none; }
    .app-accordion-summary:hover {
      background: #e8ecf1;
      color: var(--text);
    }
    .app-accordion-title {
      font-weight: 600;
      color: var(--app);
    }
    .app-accordion-meta {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .app-accordion-hint {
      margin-left: auto;
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .app-accordion-hint::before { content: '展開する'; }
    .app-accordion[open] > .app-accordion-summary .app-accordion-hint::before { content: '折りたたむ'; }

    .app-branch {
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .app-card {
      padding: 14px 20px 14px 24px;
      border-left: 3px solid var(--app);
      border-bottom: 1px solid var(--border);
      scroll-margin-top: 76px;
    }
    .app-card:last-child { border-bottom: none; }

    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .id-group, .ref-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    /* Plain typographic metadata & semantic IDs */
    .id-tag, .id-anchor {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }
    .id-biz { color: var(--biz); }
    .id-app { color: var(--app); }
    .id-anchor {
      color: var(--accent);
    }
    .id-anchor:hover { text-decoration: underline; }
    .meta-ref, .meta-file {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--muted);
    }
    .meta-feature {
      font-size: var(--text-sm);
      color: var(--text-secondary);
      font-weight: 500;
    }
    .cat-label {
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .date-text {
      font-size: var(--text-sm);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text);
      white-space: nowrap;
    }
    .ref-link {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--accent);
      text-decoration: none;
      white-space: nowrap;
    }
    .ref-link:hover { text-decoration: underline; }

    /* Semantic status indicators */
    .badge {
      display: inline-block;
      font-size: var(--text-sm);
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      line-height: 1.4;
    }
    .badge-confirmed { background: var(--confirmed-bg); color: var(--confirmed); border: 1px solid var(--confirmed-border); }
    .badge-confirmed-ai { background: var(--confirmed-ai-bg); color: var(--confirmed-ai); border: 1px dashed var(--confirmed-ai-border); }
    .badge-inferred { background: var(--inferred-bg); color: var(--inferred); border: 1px solid var(--inferred-border); }
    .badge-implemented { background: var(--accent-soft); color: var(--accent); border: 1px solid #bfdbfe; }
    .badge-disputed { background: var(--disputed-bg); color: var(--disputed); border: 1px solid var(--disputed-border); }
    .badge-unknown { background: var(--unknown-bg); color: var(--unknown); border: 1px solid var(--unknown-border); }
    .badge-overridden { background: var(--inferred-bg); color: var(--inferred); border: 1px solid var(--inferred-border); }

    .undef-label {
      display: inline-block;
      font-size: var(--text-sm);
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--inferred-bg);
      color: var(--inferred);
      border: 1px solid var(--inferred-border);
    }

    /* Gherkin steps */
    .steps {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .steps li {
      font-size: var(--text-body);
      max-width: 65ch;
    }
    .kw {
      display: inline-block;
      min-width: 56px;
      font-weight: 600;
      color: var(--accent);
      margin-right: 6px;
    }

    /* Tables */
    .table-wrap {
      overflow-x: auto;
      max-width: 100%;
      margin: 8px 0 4px 0;
    }
    .doc-table-wrap {
      overflow-x: auto;
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      background: var(--surface);
    }
    .doc-table {
      font-size: var(--text-sm);
      line-height: 1.55;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    .doc-table thead th {
      background: var(--surface-subtle);
      color: var(--text-secondary);
      font-weight: 600;
      white-space: nowrap;
      border-bottom: 1px solid var(--border-strong);
    }
    .doc-table tbody tr:nth-child(even) {
      background: #fafbfc;
    }
    .doc-table tbody tr:hover {
      background: #f1f5fb;
    }
    .doc-table tbody tr:last-child td {
      border-bottom: none;
    }
    .doc-table tr.spec-row:target,
    .biz-card:target,
    .app-card:target {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      background: var(--accent-soft);
    }
    .doc-table tr.row-undefined {
      background: var(--inferred-bg);
    }
    .decision-addendum-row {
      background: #f8fafc !important;
    }
    .decision-addendum-row td:first-child {
      padding-left: 22px;
      border-left: 3px solid var(--accent);
    }
    .addendum-indent {
      color: var(--accent);
      font-weight: 700;
      margin-right: 4px;
    }
    .override-link-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }

    .col-id { white-space: nowrap; }
    .col-num { font-variant-numeric: tabular-nums; }
    .col-prose { min-width: 200px; }
    .col-source { min-width: 170px; }

    .param-val {
      font-family: var(--font-mono);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }
    .sub-code {
      font-size: var(--text-sm);
      color: var(--muted);
      margin-top: 3px;
      word-break: break-word;
    }
    .note-text {
      font-size: var(--text-sm);
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .muted-text { color: var(--muted); }
    .inline-code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--text);
      word-break: break-word;
    }

    .source-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 4px;
    }
    .source-link {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--muted);
      text-decoration: none;
      word-break: break-all;
    }
    .source-link:hover { color: var(--accent); text-decoration: underline; }
    .gh-link {
      font-size: var(--text-sm);
      color: var(--muted);
      text-decoration: none;
      white-space: nowrap;
    }
    .gh-link:hover { color: var(--accent); text-decoration: underline; }

    .trans-chain { font-size: var(--text-sm); }

    /* Mermaid block */
    .mermaid-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .mermaid-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .mermaid-status { font-size: var(--text-sm); color: var(--muted); }
    .mini-btn {
      background: var(--surface);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 160ms var(--ease-out), border-color 160ms var(--ease-out);
    }
    .mini-btn:hover {
      background: var(--surface-subtle);
      border-color: var(--border-strong);
      color: var(--text);
    }
    .mermaid-diagram {
      overflow-x: auto;
      max-width: 100%;
      padding: 12px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      text-align: center;
    }
    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid-source {
      margin: 0;
      padding: 14px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      font-size: var(--text-sm);
      overflow-x: auto;
      max-width: 100%;
      color: var(--text-secondary);
      white-space: pre;
    }

    .bg-box {
      margin: 8px 0 12px;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--surface-subtle);
      border-left: 3px solid var(--border-strong);
      font-size: var(--text-sm);
      color: var(--text-secondary);
    }
    .bg-title {
      font-weight: 600;
      color: var(--text);
      margin-bottom: 4px;
    }
    .bg-steps {
      margin: 0;
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .empty-link { color: var(--disputed); font-size: var(--text-sm); padding: 12px 20px; }
    .section-empty { padding: 16px; font-size: var(--text-sm); color: var(--muted); text-align: center; }
    .empty-goal { font-style: italic; }
    .formula-expr {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--text);
      word-break: break-word;
    }
    .nongoal-banner {
      padding: 12px 16px;
      border-radius: 6px;
      background: var(--disputed-bg);
      border: 1px solid var(--disputed-border);
      border-left: 3px solid var(--disputed);
      color: #7f1d1d;
      font-size: var(--text-sm);
      margin-bottom: 14px;
    }

    /* Formula charts */
    .formula-charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }
    .formula-chart-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .formula-chart-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .formula-chart-meta { min-width: 0; flex: 1; }
    .formula-chart-refs { margin-top: 6px; }
    .formula-chart-status { font-size: var(--text-sm); }
    .formula-chart-canvas {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      overflow-x: auto;
      max-width: 100%;
    }
    .formula-chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: var(--text-sm);
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .legend-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
    }
    .formula-fallback-wrap {
      overflow-x: auto;
      max-width: 100%;
    }
    .formula-fallback-table th,
    .formula-fallback-table td {
      padding: 6px 8px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .formula-fallback-table th:first-child,
    .formula-fallback-table td:first-child {
      text-align: left;
    }

    .hidden { display: none !important; }

    /* Responsive: tablet & mobile */
    @media (max-width: 1024px) {
      .layout-shell { display: block; }
      .sidebar { display: none; }
      .mobile-nav-bar {
        display: block;
        position: sticky;
        top: 0;
        z-index: 30;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 8px 12px;
      }
      .mobile-nav-scroll {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .mobile-nav-scroll::-webkit-scrollbar { display: none; }
      .mobile-nav-scroll .nav-link {
        flex: 0 0 auto;
        white-space: nowrap;
        border-left: none;
        border-bottom: 2px solid transparent;
        border-radius: 6px 6px 0 0;
        padding: 6px 10px;
      }
      .mobile-nav-scroll .nav-link.active {
        border-left-color: transparent;
        border-bottom-color: var(--accent);
      }
      .main-column {
        padding: 20px 16px 56px;
      }
      .controls {
        top: 49px;
        margin: 0 -16px 20px;
        padding: 10px 16px;
      }
      .doc-section {
        scroll-margin-top: 112px;
      }
      .stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .dash-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      h1 { font-size: 1.4rem; }
      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .formula-charts-grid {
        grid-template-columns: 1fr;
      }
      .biz-card { padding: 14px; }
      .app-accordion-summary { padding: 10px 14px; }
      .app-card { padding: 12px 14px 12px 16px; }
      .search-input {
        margin-left: 0;
        max-width: none;
        width: 100%;
      }
      .filter-segmented {
        width: 100%;
      }
      .tab-btn {
        flex: 1 1 auto;
        text-align: center;
        padding: 6px 8px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }
  `;
}

function renderClientScript() {
  return `
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

      for (const item of dashItems) {
        const text = (item.textContent || '').toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const matchesStatus = matchesStatusFilter(item.dataset.status, activeFilter);
        item.classList.toggle('hidden', !(matchesSearch && matchesStatus));
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
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
          ? 'アプリ仕様をすべて折りたたむ'
          : 'アプリ仕様をすべて開く';
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

    // ScrollSpy: highlight current section in sidebar & mobile nav
    (function initScrollSpy() {
      const sections = Array.from(document.querySelectorAll('section.doc-section[id]'));
      const navLinks = Array.from(document.querySelectorAll('.nav-link[data-nav-target]'));
      if (sections.length === 0 || navLinks.length === 0) return;

      function setActive(id) {
        navLinks.forEach((link) => {
          const isMatch = link.dataset.navTarget === id;
          link.classList.toggle('active', isMatch);
          if (isMatch) {
            link.setAttribute('aria-current', 'location');
          } else {
            link.removeAttribute('aria-current');
          }
        });
      }

      setActive(sections[0].id);

      if ('IntersectionObserver' in window) {
        const visibleIds = new Set();
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                visibleIds.add(entry.target.id);
              } else {
                visibleIds.delete(entry.target.id);
              }
            });
            for (const sec of sections) {
              if (visibleIds.has(sec.id)) {
                setActive(sec.id);
                break;
              }
            }
          },
          { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
        );
        sections.forEach((sec) => observer.observe(sec));
      }
    })();

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

        for (let g = 0; g <= 4; g++) {
          const gy = padT + (plotH * g) / 4;
          const line = document.createElementNS(svgNs, 'line');
          line.setAttribute('x1', String(padL));
          line.setAttribute('x2', String(W - padR));
          line.setAttribute('y1', gy.toFixed(1));
          line.setAttribute('y2', gy.toFixed(1));
          line.setAttribute('stroke', '#dde2e8');
          line.setAttribute('stroke-width', '1');
          svg.appendChild(line);
        }

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
            maxLabel.setAttribute('x', String(padL - 6));
            maxLabel.setAttribute('y', String(padT + 8));
            maxLabel.setAttribute('text-anchor', 'end');
            maxLabel.setAttribute('fill', '#59636e');
            maxLabel.setAttribute('font-size', '10');
            maxLabel.textContent = String(maxV);
            svg.appendChild(maxLabel);

            const zeroLabel = document.createElementNS(svgNs, 'text');
            zeroLabel.setAttribute('x', String(padL - 6));
            zeroLabel.setAttribute('y', String(padT + plotH));
            zeroLabel.setAttribute('text-anchor', 'end');
            zeroLabel.setAttribute('fill', '#59636e');
            zeroLabel.setAttribute('font-size', '10');
            zeroLabel.textContent = '0';
            svg.appendChild(zeroLabel);
          }
        });

        const labelIdxs = [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
        for (const idx of new Set(labelIdxs)) {
          const lx = padL + (plotW * idx) / (rows.length - 1);
          const tx = document.createElementNS(svgNs, 'text');
          tx.setAttribute('x', lx.toFixed(1));
          tx.setAttribute('y', String(H - 8));
          tx.setAttribute('text-anchor', 'middle');
          tx.setAttribute('fill', '#59636e');
          tx.setAttribute('font-size', '10');
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
            if (statusEl) statusEl.textContent = '計算式グラフを描画済み（パラメータ表と連動）';
            chartRendered = true;
          }
        } catch (err) {
          if (canvasEl) canvasEl.classList.add('hidden');
          if (fallbackEl) fallbackEl.classList.remove('hidden');
          if (statusEl) {
            statusEl.textContent = 'グラフ描画に失敗したため式と数表を表示しています（フォールバック）';
          }
        }

        if (toggleBtn && fallbackEl) {
          toggleBtn.addEventListener('click', () => {
            if (!chartRendered) {
              fallbackEl.classList.remove('hidden');
              return;
            }
            const isHidden = fallbackEl.classList.toggle('hidden');
            toggleBtn.textContent = isHidden ? '数表を表示' : '数表を隠す';
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
          theme: 'neutral',
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
          statusEl.textContent = 'Mermaid 状態遷移図を描画済み';
        }
      } catch (err) {
        diagramEl.classList.add('hidden');
        sourceEl.classList.remove('hidden');
        if (statusEl) {
          statusEl.textContent = 'Mermaid 描画に失敗したためソースを表示しています（フォールバック）';
        }
      }
    })();
  `;
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

  const traceCards = renderTraceCards(bizScenarios);

  const orphanBanner =
    unlinkedBiz.length > 0 || orphanApps.length > 0
      ? `<div class="warn-banner">
          <strong>トレーサビリティ不整合検知:</strong>
          ${unlinkedBiz.length ? `未紐付けBIZ: ${escapeHtml(unlinkedBiz.join(', '))} ` : ''}
          ${orphanApps.length ? `孤立APP: ${escapeHtml(orphanApps.map((o) => `${o.appId}(${o.reason})`).join(', '))}` : ''}
        </div>`
      : `<div class="ok-banner">トレーサビリティチェック OK：全 ${stats.bizCount} 件のビジネス仕様と ${stats.appCount} 件のアプリ仕様が ID 紐付けされています</div>`;

  const extRefBanner = extValidation
    ? extValidation.brokenDocRefs.length > 0
      ? `<div class="warn-banner">
          <strong>拡張仕様ID参照リンク切れ検知 (${extValidation.brokenDocRefs.length}件):</strong>
          ${escapeHtml(
            extValidation.brokenDocRefs.map((b) => `${b.sourceId}(${b.sourceFile}) -> ${b.missingRef}`).join(', '),
          )}
        </div>`
      : `<div class="ok-banner">拡張ドキュメントID参照チェック OK：全 ${extValidation.allDocItemsCount} 件の関連IDにリンク切れはありません</div>`
    : '';

  const disputedTerms = extValidation ? extValidation.disputedTerms : [];
  const undefinedTransitions = extValidation ? extValidation.undefinedTransitions : [];
  const statusTotals = extValidation
    ? extValidation.statusTotals
    : {
        Confirmed: stats.confirmedCount,
        Inferred: stats.inferredCount,
        Disputed: 0,
        Unknown: 0,
      };

  const navItemsHtml = renderNavItems(stats, extendedSpecs);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${renderStyles()}</style>
</head>
<body>
  <nav class="mobile-nav-bar" aria-label="仕様セクション移動">
    <div class="mobile-nav-scroll">
      ${navItemsHtml}
    </div>
  </nav>

  <div class="layout-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        Dungeon Survivor
        <span>仕様書ビューア</span>
      </div>
      <nav class="section-nav" aria-label="仕様セクション目次">
        ${navItemsHtml}
      </nav>
    </aside>

    <div class="main-column">
      <header class="doc-header">
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">
          ビジネス仕様（@BIZ-*）・アプリ仕様（@APP-*）の自動紐付けと、用語集・パラメータ表・計算式・状態遷移図・不変条件・未決事項・やらないこと・決定ログを横断確認できるレビュー用ドキュメントです。
        </p>
      </header>

      <section id="sec-overview" class="doc-section">
        <div class="section-head">
          <h2>概要</h2>
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

        ${hasExtended ? renderOverviewPanels(disputedTerms, undefinedTransitions) : ''}
      </section>

      <div class="controls">
        <div class="filter-segmented" role="group" aria-label="状態フィルタ">
          <button type="button" class="tab-btn active" data-filter="all" aria-pressed="true">すべて表示</button>
          <button type="button" class="tab-btn" data-filter="inferred" aria-pressed="false">Inferred</button>
          <button type="button" class="tab-btn" data-filter="confirmed" aria-pressed="false">Confirmed</button>
          <button type="button" class="tab-btn" data-filter="disputed" aria-pressed="false">Disputed</button>
          <button type="button" class="tab-btn" data-filter="unknown" aria-pressed="false">Unknown</button>
        </div>
        <input type="search" class="search-input" id="searchBox" placeholder="ID・キーワードで全セクション検索（例: 泉, PRM-06, FML-01）" />
      </div>

      <section id="sec-gherkin" class="doc-section" data-section-name="gherkin">
        <div class="section-head">
          <h2>ビジネス仕様・アプリ仕様トレーサビリティ <span class="section-count" data-section-count="gherkin">(${stats.bizCount}件)</span></h2>
          <button type="button" class="action-btn" id="toggleAllAppsBtn">アプリ仕様をすべて開く</button>
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
  </div>

  <script>${renderClientScript()}</script>
</body>
</html>
`;
}
