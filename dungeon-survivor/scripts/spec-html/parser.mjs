import fs from 'node:fs';
import path from 'node:path';

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

  const statusOrigin = tags.includes('@AIProposed') ? 'ai' : 'human';

  return {
    id: idTag ? idTag.slice(1) : '(NO-ID)',
    refs,
    status,
    statusOrigin,
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
        featureBackground: feat.background,
        isFirstInFeature: feat.scenarios[0] === sc,
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
        featureBackground: feat.background,
        isFirstInFeature: feat.scenarios[0] === sc,
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

export function normalizeSpecStatus(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'confirmed' || /^confirmed\s*[（(]ai提案[）)]$/.test(s) || /^確定\s*[（(]ai提案[）)]$/.test(s)) {
    return 'Confirmed';
  }
  if (s === 'inferred') return 'Inferred';
  if (s === 'disputed') return 'Disputed';
  if (s === 'implemented') return 'Implemented';
  return 'Unknown';
}

export function parseStatusOrigin(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (/ai提案/.test(s)) return 'ai';
  return 'human';
}

export function parseRefsList(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '-' || s === 'なし' || s === 'none') return [];
  return s
    .split(/[\s,、]+/)
    .map((x) => x.replace(/^`|`$/g, '').trim())
    .filter((x) => x && x !== '-' && x !== 'なし');
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  // Preserve escaped pipes if any, though simple split handles standard GFM tables cleanly
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseMarkdownTables(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const tables = [];
  let inCodeFence = false;
  let current = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      if (current) {
        tables.push(current);
        current = null;
      }
      continue;
    }
    if (inCodeFence) continue;

    const cells = splitMarkdownRow(trimmed);
    if (cells) {
      if (!current) {
        current = { headers: cells, rows: [], hasSeparator: false };
      } else if (!current.hasSeparator && isSeparatorRow(cells)) {
        current.hasSeparator = true;
      } else {
        current.rows.push(cells);
      }
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);

  return tables.filter((t) => t.hasSeparator || t.rows.length > 0);
}

export function extractMermaidBlocks(content) {
  const blocks = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/g;
  for (const m of content.replace(/\r\n/g, '\n').matchAll(regex)) {
    const code = m[1].trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

function extractDocTitle(content, fallback) {
  const m = content.replace(/\r\n/g, '\n').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function normalizeRelativeSpecPath(filePath, fallbackName) {
  if (!filePath) return `specs/${fallbackName}`;
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/specs/');
  if (idx !== -1) return normalized.slice(idx + 1);
  if (normalized.startsWith('specs/')) return normalized;
  return `specs/${path.basename(normalized)}`;
}

function mapTableRowsByHeader(table) {
  const headers = table.headers.map((h) => h.trim());
  return table.rows.map((cells) => {
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = (cells[idx] ?? '').trim();
    });
    return record;
  });
}

export function parseGlossary(content, filePath = 'specs/glossary.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'glossary.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    term: r.用語 || '',
    alias: r['別名・コード表記'] || r.別名 || '',
    definition: r.定義 || '',
    status: normalizeSpecStatus(r.状態),
    refs: parseRefsList(r.関連ID),
    sourceNote: r['出典・備考'] || r.出典 || r.備考 || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, '用語集（Glossary）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseParameters(content, filePath = 'specs/parameters.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'parameters.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    category: r.カテゴリ || '',
    name: r.パラメータ名 || r.名前 || '',
    value: r.現行値 || r.値 || '',
    unit: r['単位・形式'] || r.単位 || '',
    goal: r['狙い（体験目標）'] || r.狙い || '',
    status: normalizeSpecStatus(r.状態),
    statusOrigin: parseStatusOrigin(r.状態),
    refs: parseRefsList(r.関連ID),
    codeRef: r.元コード参照 || r.出典 || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, 'パラメータ表（Parameters）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseFormulas(content, filePath = 'specs/formulas.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'formulas.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    name: r.名称 || '',
    formula: r.式 || '',
    inputs: r['入力（パラメータIDで参照）'] || r.入力 || '',
    output: r.出力と単位 || r.出力 || '',
    status: normalizeSpecStatus(r.状態),
    refs: parseRefsList(r.関連ID),
    codeRef: r.元コード参照 || r.出典 || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, '計算式シート（Formulas）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseOpenQuestions(content, filePath = 'specs/open-questions.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'open-questions.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    topic: r.論点 || '',
    status: normalizeSpecStatus(r['状態（Unknown｜Disputed）'] || r.状態),
    refs: parseRefsList(r.関連ID),
    trigger: r['決めるタイミング・トリガー'] || r.トリガー || '',
    impact: r.保留している間の影響 || r.影響 || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, '未決事項リスト（Open Questions）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

function extractNonGoalsDeclaration(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      return trimmed.replace(/^>\s*/, '').trim();
    }
  }
  return 'ここに書かれたものは未定義ではなく、意図的に存在しない。AIはこれらを補完・実装・仕様追加しない';
}

export function parseNonGoals(content, filePath = 'specs/non-goals.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'non-goals.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    item: r.やらないこと || '',
    reason: r.理由 || '',
    status: normalizeSpecStatus(r.状態),
    refs: parseRefsList(r.関連ID),
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, 'やらないことリスト（Non-Goals）'),
    declaration: extractNonGoalsDeclaration(content),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseStateTransitions(content, filePath = 'specs/state-transitions.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'state-transitions.md');
  const mermaidBlocks = extractMermaidBlocks(content);
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => {
    const to = r.遷移先 || '';
    return {
      id: r.ID || '',
      from: r.遷移元 || '',
      trigger: r['トリガー・条件'] || r.トリガー || '',
      to,
      isUndefined: to === '未定義' || to.includes('未定義'),
      status: normalizeSpecStatus(r.状態),
      refs: parseRefsList(r.関連ID),
      note: r.備考 || '',
      sourceFile: relPath,
    };
  });
  return {
    title: extractDocTitle(content, '状態遷移図（State Transitions）'),
    filePath,
    relativePath: relPath,
    mermaidBlocks,
    items,
  };
}

export function parseInvariants(content, filePath = 'specs/invariants.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'invariants.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    category: r.分類 || r.カテゴリ || '',
    condition: r.不変条件 || '',
    verification: r.検証箇所 || '',
    status: normalizeSpecStatus(r.状態),
    refs: parseRefsList(r.関連ID),
    note: r.備考 || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, '不変条件（Invariants）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseDecisionLog(content, filePath = 'specs/decisions.md') {
  const relPath = normalizeRelativeSpecPath(filePath, 'decisions.md');
  const tables = parseMarkdownTables(content);
  const rows = tables.flatMap(mapTableRowsByHeader);
  const items = rows.map((r) => ({
    id: r.ID || '',
    date: r.日付 || '',
    decider: r.決定者 || '',
    decision: r.決定事項 || '',
    reason: r['理由・背景'] || r.理由 || '',
    status: normalizeSpecStatus(r.状態),
    transition: r.状態遷移 || '',
    refs: parseRefsList(r.関連ID),
    revisitTrigger: r.再検討トリガー || '',
    sourceFile: relPath,
  }));
  return {
    title: extractDocTitle(content, '決定ログ（Decision Log）'),
    filePath,
    relativePath: relPath,
    items,
  };
}

export function parseOverrideTargets(text) {
  const str = String(text || '');
  const targets = [];
  const seen = new Set();
  const markerRegex = /上書き対象\s*[:：]\s*([^。；;\n）)]+)/g;
  for (const m of str.matchAll(markerRegex)) {
    const rawList = m[1].trim();
    if (!rawList) continue;
    const tokens = rawList
      .split(/[\s,、]+/)
      .map((t) => t.replace(/^`|`$/g, '').trim())
      .filter(Boolean);
    for (const tok of tokens) {
      if (!seen.has(tok)) {
        seen.add(tok);
        targets.push(tok);
      }
    }
  }
  return targets;
}

export function resolveDecisionAddendums(decisions) {
  const items = decisions?.items || [];
  const baseIds = new Set(items.filter((item) => item.id && !item.id.endsWith('-addendum')).map((item) => item.id));
  const addendumsByBaseId = new Map();
  const overrideAddendumsByTargetId = new Map();
  const brokenOverrideTargets = [];
  const unmatchedAddendums = [];
  const matchedAddendumIds = new Set();

  for (const item of items) {
    if (!item.id?.endsWith('-addendum')) continue;
    const match = item.id.match(/^(DEC-\d+)-addendum$/);
    const baseId = match ? match[1] : null;
    const hasBaseInRefs = Boolean(baseId && Array.isArray(item.refs) && item.refs.includes(baseId));
    const baseExists = Boolean(baseId && baseIds.has(baseId));

    if (baseId && hasBaseInRefs && baseExists) {
      if (!addendumsByBaseId.has(baseId)) {
        addendumsByBaseId.set(baseId, []);
      }
      addendumsByBaseId.get(baseId).push(item);
      matchedAddendumIds.add(item.id);
    } else {
      unmatchedAddendums.push(item);
    }

    const overrideTargets = parseOverrideTargets(item.decision);
    for (const targetId of overrideTargets) {
      if (!baseIds.has(targetId)) {
        brokenOverrideTargets.push({
          sourceId: item.id,
          sourceFile: item.sourceFile || '',
          missingTarget: targetId,
        });
      } else if (targetId !== baseId) {
        if (!overrideAddendumsByTargetId.has(targetId)) {
          overrideAddendumsByTargetId.set(targetId, []);
        }
        const list = overrideAddendumsByTargetId.get(targetId);
        if (!list.includes(item)) {
          list.push(item);
        }
      }
    }
  }

  return {
    addendumsByBaseId,
    overrideAddendumsByTargetId,
    brokenOverrideTargets,
    unmatchedAddendums,
    matchedAddendumIds,
  };
}

export function loadExtendedSpecs(projectRoot) {
  const specsDir = path.join(projectRoot, 'specs');
  const readIfExists = (rel, parser) => {
    const full = path.join(specsDir, rel);
    if (!fs.existsSync(full)) return null;
    return parser(fs.readFileSync(full, 'utf8'), full);
  };

  return {
    glossary: readIfExists('glossary.md', parseGlossary),
    parameters: readIfExists('parameters.md', parseParameters),
    formulas: readIfExists('formulas.md', parseFormulas),
    stateTransitions: readIfExists('state-transitions.md', parseStateTransitions),
    invariants: readIfExists('invariants.md', parseInvariants),
    openQuestions: readIfExists('open-questions.md', parseOpenQuestions),
    nonGoals: readIfExists('non-goals.md', parseNonGoals),
    decisions: readIfExists('decisions.md', parseDecisionLog),
  };
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
