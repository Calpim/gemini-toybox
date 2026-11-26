import fs from 'node:fs';
import path from 'node:path';
import { resolveDecisionAddendums } from './parser.mjs';

export function validateExtendedSpecs(graph, extendedSpecs) {
  const validIds = new Set();
  for (const b of graph?.bizScenarios || []) {
    if (b.id && b.id !== '(NO-ID)') validIds.add(b.id);
  }
  for (const a of graph?.appScenarios || []) {
    if (a.id && a.id !== '(NO-ID)') validIds.add(a.id);
  }

  const sections = [
    extendedSpecs?.glossary,
    extendedSpecs?.parameters,
    extendedSpecs?.formulas,
    extendedSpecs?.stateTransitions,
    extendedSpecs?.invariants,
    extendedSpecs?.openQuestions,
    extendedSpecs?.nonGoals,
    extendedSpecs?.decisions,
  ].filter(Boolean);

  const allDocItems = [];
  for (const sec of sections) {
    for (const item of sec.items || []) {
      if (item.id) validIds.add(item.id);
      allDocItems.push(item);
    }
  }

  const brokenDocRefs = [];
  for (const item of allDocItems) {
    for (const refId of item.refs || []) {
      if (!validIds.has(refId)) {
        brokenDocRefs.push({
          sourceId: item.id || '(NO-ID)',
          sourceFile: item.sourceFile || '',
          missingRef: refId,
        });
      }
    }
  }

  const { brokenOverrideTargets } = resolveDecisionAddendums(extendedSpecs?.decisions);
  for (const b of brokenOverrideTargets) {
    brokenDocRefs.push({
      sourceId: b.sourceId,
      sourceFile: b.sourceFile,
      missingRef: b.missingTarget,
    });
  }

  const disputedTerms = (extendedSpecs?.glossary?.items || []).filter((item) => item.status === 'Disputed');
  const undefinedTransitions = (extendedSpecs?.stateTransitions?.items || []).filter((item) => item.isUndefined);

  const allCombined = [...(graph?.bizScenarios || []), ...(graph?.appScenarios || []), ...allDocItems];

  const statusTotals = {
    Confirmed: allCombined.filter((x) => x.status === 'Confirmed').length,
    Inferred: allCombined.filter((x) => x.status === 'Inferred').length,
    Disputed: allCombined.filter((x) => x.status === 'Disputed').length,
    Unknown: allCombined.filter((x) => x.status === 'Unknown').length,
  };

  return {
    validIds,
    brokenDocRefs,
    brokenOverrideTargets,
    disputedTerms,
    undefinedTransitions,
    allDocItemsCount: allDocItems.length,
    statusTotals,
  };
}

function tokenizeTagBlock(inner) {
  return String(inner || '')
    .split(/\s*(?:&|\/|,)\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractTestTitleTagSets(fileContent) {
  const tagSets = [];
  const titleRegex = /\b(?:describe|it|test)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/g;
  for (const titleMatch of fileContent.matchAll(titleRegex)) {
    const title = titleMatch[2];
    const bracketRegex = /\[([^\]]+)\]/g;
    for (const bracketMatch of title.matchAll(bracketRegex)) {
      const tokens = tokenizeTagBlock(bracketMatch[1]);
      if (tokens.length > 0) {
        tagSets.push(new Set(tokens));
      }
    }
  }
  return tagSets;
}

export function validateInvariantTests(invariants, projectRoot) {
  const items = invariants?.items || [];
  const brokenInvariantTests = [];
  const fileCache = new Map();
  let checkedCount = 0;

  const getFileTagSets = (relPath) => {
    if (fileCache.has(relPath)) return fileCache.get(relPath);
    const fullPath = path.join(projectRoot, relPath);
    if (!fs.existsSync(fullPath)) {
      fileCache.set(relPath, null);
      return null;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    const sets = extractTestTitleTagSets(content);
    fileCache.set(relPath, sets);
    return sets;
  };

  const testRefRegex = /`([^`]+\.test\.ts)`(?:\s*\(([^)]*)\))?/g;
  for (const item of items) {
    const verification = String(item.verification || '');
    for (const refMatch of verification.matchAll(testRefRegex)) {
      const testFile = refMatch[1].trim();
      const parenContent = refMatch[2] ?? '';
      const bracketRegex = /\[([^\]]+)\]/g;
      const tags = [];
      for (const bm of parenContent.matchAll(bracketRegex)) {
        tags.push(bm[1].trim());
      }

      if (tags.length === 0) {
        brokenInvariantTests.push({
          invariantId: item.id || '(NO-ID)',
          testFile,
          tag: null,
          reason: 'missing test tag',
        });
        continue;
      }

      const fileTagSets = getFileTagSets(testFile);
      if (fileTagSets === null) {
        for (const tagInner of tags) {
          brokenInvariantTests.push({
            invariantId: item.id || '(NO-ID)',
            testFile,
            tag: `[${tagInner}]`,
            reason: 'missing test file',
          });
        }
        continue;
      }

      for (const tagInner of tags) {
        checkedCount += 1;
        const requiredTokens = tokenizeTagBlock(tagInner);
        const found =
          requiredTokens.length > 0 && fileTagSets.some((tokenSet) => requiredTokens.every((tok) => tokenSet.has(tok)));
        if (!found) {
          brokenInvariantTests.push({
            invariantId: item.id || '(NO-ID)',
            testFile,
            tag: `[${tagInner}]`,
            reason: 'missing test tag in file',
          });
        }
      }
    }
  }

  return {
    checkedCount,
    brokenInvariantTests,
  };
}

function collectSpecFilesRecursive(dirPath, result = []) {
  if (!fs.existsSync(dirPath)) return result;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSpecFilesRecursive(full, result);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.feature'))) {
      result.push(full);
    }
  }
  return result;
}

export function validateNoLineNumberRefs(projectRoot, options = {}) {
  const specsDir = options.specsDir ? path.resolve(options.specsDir) : path.join(projectRoot, 'specs');
  const files = collectSpecFilesRecursive(specsDir);
  const lineNumberRefs = [];
  const lineRefRegex = /(?:#L\d+(?:[-,]L?\d+)*|\b(?:src|scripts|specs)\/[^\s`)|]+,L\d+(?:[-,]L?\d+)*)/g;

  for (const fullPath of files) {
    const relPath = path.relative(projectRoot, fullPath).replaceAll('\\', '/');
    const lines = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const m of line.matchAll(lineRefRegex)) {
        lineNumberRefs.push({
          file: relPath,
          line: i + 1,
          match: m[0],
          text: line.trim(),
        });
      }
    }
  }

  return {
    checkedFiles: files.length,
    lineNumberRefs,
  };
}

export function validateSymbolRefs(projectRoot, options = {}) {
  const specsDir = options.specsDir ? path.resolve(options.specsDir) : path.join(projectRoot, 'specs');
  const files = collectSpecFilesRecursive(specsDir).filter((f) => f.endsWith('.md'));
  const uniqueRefs = new Map();
  const symbolRefRegex = /\b(src\/[A-Za-z0-9_./-]+\.ts)#([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const fullPath of files) {
    const specFile = path.relative(projectRoot, fullPath).replaceAll('\\', '/');
    const lines = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const m of line.matchAll(symbolRefRegex)) {
        const targetFile = m[1];
        const symbol = m[2];
        const ref = `${targetFile}#${symbol}`;
        if (!uniqueRefs.has(ref)) {
          uniqueRefs.set(ref, {
            specFile,
            line: i + 1,
            ref,
            targetFile,
            symbol,
          });
        }
      }
    }
  }

  const fileCache = new Map();
  const getTargetContent = (targetFile) => {
    if (fileCache.has(targetFile)) return fileCache.get(targetFile);
    const fullPath = path.join(projectRoot, targetFile);
    if (!fs.existsSync(fullPath)) {
      fileCache.set(targetFile, null);
      return null;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    fileCache.set(targetFile, content);
    return content;
  };

  const brokenSymbolRefs = [];
  for (const entry of uniqueRefs.values()) {
    const content = getTargetContent(entry.targetFile);
    if (content === null) {
      brokenSymbolRefs.push({
        ...entry,
        reason: 'missing target file',
      });
      continue;
    }

    const declRegex = new RegExp(`\\b(?:function|const|let|var|class|interface|type|enum)\\s+${entry.symbol}\\b`);
    const memberRegex = new RegExp(`\\b${entry.symbol}\\s*[:=(]`);
    if (!declRegex.test(content) && !memberRegex.test(content)) {
      brokenSymbolRefs.push({
        ...entry,
        reason: 'missing symbol declaration',
      });
    }
  }

  return {
    checkedCount: uniqueRefs.size,
    brokenSymbolRefs,
  };
}
