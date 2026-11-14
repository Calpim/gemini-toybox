import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse a single Japanese/English Gherkin .feature file into structured data.
 * Supports: # language, @tags, Feature/機能, Background/背景, Scenario/シナリオ,
 * Given/When/Then/And/But (前提/もし/ならば/かつ/しかし), and Data Tables (| ... |).
 */
export function parseFeature(content, filePath = '') {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let pendingTags = [];
  const feature = {
    filePath,
    fileName: path.basename(filePath),
    tags: [],
    name: '',
    description: [],
    background: null,
    scenarios: [],
  };

  let currentSection = null; // 'feature' | 'background' | 'scenario'
  let currentScenario = null;
  let lastStep = null;

  const extractTags = (line) =>
    line
      .trim()
      .split(/\s+/)
      .filter((t) => t.startsWith('@'));

  const stepRegex = /^(前提|もし|ならば|かつ|しかし|Given|When|Then|And|But)\s+(.*)$/;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('@')) {
      pendingTags.push(...extractTags(trimmed));
      continue;
    }

    const featureMatch = trimmed.match(/^(?:機能|Feature):\s*(.*)$/);
    if (featureMatch) {
      feature.name = featureMatch[1].trim();
      feature.tags = [...pendingTags];
      pendingTags = [];
      currentSection = 'feature';
      continue;
    }

    const bgMatch = trimmed.match(/^(?:背景|Background):\s*(.*)$/);
    if (bgMatch) {
      feature.background = {
        name: bgMatch[1].trim(),
        steps: [],
      };
      currentSection = 'background';
      lastStep = null;
      continue;
    }

    const scenarioMatch = trimmed.match(/^(?:シナリオ|シナリオアウトライン|Scenario|Scenario Outline):\s*(.*)$/);
    if (scenarioMatch) {
      currentScenario = {
        name: scenarioMatch[1].trim(),
        tags: [...feature.tags, ...pendingTags],
        ownTags: [...pendingTags],
        steps: [],
      };
      pendingTags = [];
      feature.scenarios.push(currentScenario);
      currentSection = 'scenario';
      lastStep = null;
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && lastStep) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (!lastStep.table) lastStep.table = [];
      lastStep.table.push(cells);
      continue;
    }

    const stepMatch = trimmed.match(stepRegex);
    if (stepMatch && (currentSection === 'scenario' || currentSection === 'background')) {
      const step = {
        keyword: stepMatch[1],
        text: stepMatch[2].trim(),
        table: null,
      };
      if (currentSection === 'scenario' && currentScenario) {
        currentScenario.steps.push(step);
      } else if (currentSection === 'background' && feature.background) {
        feature.background.steps.push(step);
      }
      lastStep = step;
      continue;
    }

    if (currentSection === 'feature') {
      feature.description.push(trimmed);
    }
  }

  return feature;
}

export function classifyScenarioMeta(scenario, layer) {
  const tags = scenario.ownTags;
  const idTag = tags.find((t) => (layer === 'business' ? /^@BIZ-/.test(t) : /^@APP-/.test(t))) || null;
  const refs = tags.filter((t) => t.startsWith('@ref:')).map((t) => t.replace(/^@ref:/, ''));

  let status = 'Unknown';
  if (tags.includes('@Confirmed')) status = 'Confirmed';
  else if (tags.includes('@Disputed')) status = 'Disputed';
  else if (tags.includes('@Inferred')) status = 'Inferred';
  else if (tags.includes('@Implemented')) status = 'Implemented';

  return {
    id: idTag ? idTag.slice(1) : '(NO-ID)',
    refs,
    status,
  };
}

export function buildTraceabilityGraph(businessFeatures, appFeatures) {
  const bizScenarios = [];
  const appScenarios = [];

  for (const feat of businessFeatures) {
    for (const sc of feat.scenarios) {
      const meta = classifyScenarioMeta(sc, 'business');
      bizScenarios.push({
        ...sc,
        ...meta,
        layer: 'business',
        featureName: feat.name,
        fileName: feat.fileName,
        linkedApps: [],
      });
    }
  }

  const bizMap = new Map(bizScenarios.map((b) => [b.id, b]));
  const orphanApps = [];

  for (const feat of appFeatures) {
    for (const sc of feat.scenarios) {
      const meta = classifyScenarioMeta(sc, 'app');
      const enriched = {
        ...sc,
        ...meta,
        layer: 'app',
        featureName: feat.name,
        fileName: feat.fileName,
        brokenRefs: [],
      };
      appScenarios.push(enriched);

      if (meta.refs.length === 0) {
        orphanApps.push({ appId: meta.id, reason: 'missing @ref tag' });
      } else {
        for (const refId of meta.refs) {
          const target = bizMap.get(refId);
          if (target) {
            target.linkedApps.push(enriched);
          } else {
            enriched.brokenRefs.push(refId);
            orphanApps.push({ appId: meta.id, reason: `unknown ref: ${refId}` });
          }
        }
      }
    }
  }

  const unlinkedBiz = bizScenarios.filter((b) => b.linkedApps.length === 0).map((b) => b.id);

  return {
    businessFeatures,
    appFeatures,
    bizScenarios,
    appScenarios,
    unlinkedBiz,
    orphanApps,
    stats: {
      bizCount: bizScenarios.length,
      appCount: appScenarios.length,
      confirmedCount: [...bizScenarios, ...appScenarios].filter((s) => s.status === 'Confirmed').length,
      inferredCount: [...bizScenarios, ...appScenarios].filter((s) => s.status === 'Inferred').length,
      brokenCount: unlinkedBiz.length + orphanApps.length,
    },
  };
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStatusBadge(status) {
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

export function renderHtml(graph, title = 'Dungeon Survivor — Gherkin 仕様書ビューア') {
  const { stats, bizScenarios, appScenarios, unlinkedBiz, orphanApps } = graph;

  const traceCards = bizScenarios
    .map((biz) => {
      const appCards =
        biz.linkedApps.length > 0
          ? biz.linkedApps
              .map(
                (app) => `
              <div class="app-card" data-status="${escapeHtml(app.status)}" data-layer="app">
                <div class="card-head">
                  <div class="id-group">
                    <span class="id-pill id-app">${escapeHtml(app.id)}</span>
                    <span class="ref-pill">↳ ref: ${escapeHtml(biz.id)}</span>
                    <span class="file-pill">${escapeHtml(app.fileName)}</span>
                  </div>
                  ${renderStatusBadge(app.status)}
                </div>
                <h4>${escapeHtml(app.name)}</h4>
                ${renderSteps(app.steps)}
              </div>`
              )
              .join('')
          : `<div class="empty-link">⚠️ 紐づくアプリGherkin（@ref:${escapeHtml(biz.id)}）がまだありません</div>`;

      return `
      <section class="trace-group" data-biz-status="${escapeHtml(biz.status)}" data-has-inferred="${
        biz.status === 'Inferred' || biz.linkedApps.some((a) => a.status === 'Inferred')
      }">
        <div class="biz-card">
          <div class="card-head">
            <div class="id-group">
              <span class="id-pill id-biz">${escapeHtml(biz.id)}</span>
              <span class="file-pill">${escapeHtml(biz.fileName)}</span>
              <span class="feature-pill">${escapeHtml(biz.featureName)}</span>
            </div>
            ${renderStatusBadge(biz.status)}
          </div>
          <h3>${escapeHtml(biz.name)}</h3>
          ${renderSteps(biz.steps)}
        </div>
        <div class="app-branch">
          ${appCards}
        </div>
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
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
      background: radial-gradient(circle at top right, #111b33, var(--bg) 55%);
      color: var(--text);
      line-height: 1.6;
      padding: 24px 16px 64px;
    }
    .container { max-width: 1080px; margin: 0 auto; }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 18px;
      margin-bottom: 20px;
    }
    .eyebrow {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--biz);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 { margin: 6px 0 8px; font-size: 26px; }
    .subtitle { margin: 0; color: var(--muted); font-size: 14px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin: 20px 0;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .stat-label { font-size: 12px; color: var(--muted); }
    .stat-val { font-size: 24px; font-weight: 800; margin-top: 2px; }
    .ok-banner, .warn-banner {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 18px;
    }
    .ok-banner { background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.35); color: #6ee7b7; }
    .warn-banner { background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.4); color: #fca5a5; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 20px;
      background: var(--surface);
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .tab-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 7px 13px;
      border-radius: 8px;
      font-size: 13px;
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
      min-width: 220px;
      flex: 1;
      max-width: 320px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
    }
    .trace-group {
      margin-bottom: 24px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(15, 22, 38, 0.72);
      overflow: hidden;
    }
    .biz-card {
      padding: 16px 18px;
      border-left: 4px solid var(--biz);
      background: var(--surface);
    }
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
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .id-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .id-pill, .ref-pill, .file-pill, .feature-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
    }
    .id-biz { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700; }
    .id-app { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.4); font-weight: 700; }
    .ref-pill { background: rgba(148, 163, 184, 0.12); color: #cbd5e1; }
    .file-pill { color: var(--muted); background: rgba(15, 23, 42, 0.8); }
    .feature-pill { color: #93c5fd; font-family: inherit; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 999px;
    }
    .badge-confirmed { background: rgba(52, 211, 153, 0.16); color: var(--confirmed); border: 1px solid rgba(52, 211, 153, 0.4); }
    .badge-inferred { background: rgba(251, 191, 36, 0.16); color: var(--inferred); border: 1px solid rgba(251, 191, 36, 0.45); }
    .badge-implemented { background: rgba(56, 189, 248, 0.16); color: var(--biz); border: 1px solid rgba(56, 189, 248, 0.4); }
    .badge-disputed { background: rgba(248, 113, 113, 0.16); color: var(--disputed); border: 1px solid rgba(248, 113, 113, 0.4); }
    .badge-unknown { background: rgba(148, 163, 184, 0.16); color: var(--muted); border: 1px solid rgba(148, 163, 184, 0.35); }
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
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
    }
    th { background: rgba(30, 41, 59, 0.8); color: #cbd5e1; }
    .empty-link { color: #fca5a5; font-size: 13px; padding: 8px; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="eyebrow">BDD / Gherkin Living Specification</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">
        ビジネス仕様（@BIZ-*：体験とルール）とアプリ仕様（@APP-*：実装・パラメータ）を @ref ID で自動紐付けした人間レビュー用HTMLです。
        黄色バッジ（Inferred）は AI が補完した仮仕様なので、「これあってる？」の観点でチェックできます。
      </p>
    </header>

    <div class="stats">
      <div class="stat-card"><div class="stat-label">ビジネス仕様 (@BIZ)</div><div class="stat-val" style="color:var(--biz)">${stats.bizCount}</div></div>
      <div class="stat-card"><div class="stat-label">アプリ仕様 (@APP)</div><div class="stat-val" style="color:var(--app)">${stats.appCount}</div></div>
      <div class="stat-card"><div class="stat-label">確定済み (Confirmed)</div><div class="stat-val" style="color:var(--confirmed)">${stats.confirmedCount}</div></div>
      <div class="stat-card"><div class="stat-label">AI仮提案・要確認 (Inferred)</div><div class="stat-val" style="color:var(--inferred)">${stats.inferredCount}</div></div>
    </div>

    ${orphanBanner}

    <div class="controls">
      <button class="tab-btn active" data-filter="all">🔗 すべて表示 (紐付けツリー)</button>
      <button class="tab-btn" data-filter="inferred">⚠️ AI仮仕様（要確認）のみ</button>
      <button class="tab-btn" data-filter="confirmed">✅ 確定済みのみ</button>
      <input type="search" class="search-input" id="searchBox" placeholder="ID・キーワードで検索（例: 泉, BIZ-CMB, タレット）" />
    </div>

    <main id="specList">
      ${traceCards}
    </main>
  </div>

  <script>
    const buttons = document.querySelectorAll('.tab-btn');
    const searchBox = document.getElementById('searchBox');
    const groups = document.querySelectorAll('.trace-group');
    let activeFilter = 'all';

    function applyFilters() {
      const q = searchBox.value.trim().toLowerCase();
      for (const group of groups) {
        const text = (group.textContent || '').toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const hasInferred = group.dataset.hasInferred === 'true';
        const isConfirmedBiz = group.dataset.bizStatus === 'Confirmed';

        let matchesTab = true;
        if (activeFilter === 'inferred') matchesTab = hasInferred;
        if (activeFilter === 'confirmed') matchesTab = isConfirmedBiz;

        group.classList.toggle('hidden', !(matchesSearch && matchesTab));

        const appCards = group.querySelectorAll('.app-card');
        for (const card of appCards) {
          if (activeFilter === 'inferred') {
            card.classList.toggle('hidden', card.dataset.status !== 'Inferred' && group.dataset.bizStatus !== 'Inferred');
          } else {
            card.classList.remove('hidden');
          }
        }
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

    searchBox.addEventListener('input', applyFilters);
  </script>
</body>
</html>`;
}

export function loadFeaturesFromDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.feature'))
    .sort();
  return files.map((file) => {
    const fullPath = path.join(dirPath, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    return parseFeature(content, fullPath);
  });
}

export function generateSpecHtml({ projectRoot, outPath }) {
  const bizDir = path.join(projectRoot, 'specs', 'business');
  const appDir = path.join(projectRoot, 'specs', 'app');

  const businessFeatures = loadFeaturesFromDir(bizDir);
  const appFeatures = loadFeaturesFromDir(appDir);
  const graph = buildTraceabilityGraph(businessFeatures, appFeatures);
  const html = renderHtml(graph);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  return { graph, outPath };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const projectRoot = path.resolve(__dirname, '..');
  const outArgIndex = process.argv.indexOf('--out');
  const outPath =
    outArgIndex !== -1 && process.argv[outArgIndex + 1]
      ? path.resolve(process.argv[outArgIndex + 1])
      : path.join(projectRoot, 'docs', 'specs.html');

  const { graph } = generateSpecHtml({ projectRoot, outPath });
  console.log(
    `Generated ${outPath} (BIZ=${graph.stats.bizCount}, APP=${graph.stats.appCount}, Confirmed=${graph.stats.confirmedCount}, Inferred=${graph.stats.inferredCount}, Broken=${graph.stats.brokenCount})`
  );
  if (graph.stats.brokenCount > 0) {
    console.error('Traceability issues found:', { unlinkedBiz: graph.unlinkedBiz, orphanApps: graph.orphanApps });
    process.exitCode = 1;
  }
}
