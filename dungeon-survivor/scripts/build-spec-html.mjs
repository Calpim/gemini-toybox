#!/usr/bin/env node
/**
 * Dungeon Survivor — 仕様書ビューア HTML ジェネレータ
 *
 * specs/business/*.feature と specs/app/*.feature、および specs/*.md を解析し、
 * トレーサビリティ検証・HTML レンダリングを行う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTraceabilityGraph, loadExtendedSpecs, loadFeaturesFromDir } from './spec-html/parser.mjs';
import { renderHtml } from './spec-html/renderer.mjs';
import {
  validateExtendedSpecs,
  validateInvariantTests,
  validateNoLineNumberRefs,
  validateSymbolRefs,
} from './spec-html/validator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { buildFormulaChartsData, extractFormulaParamValues } from './spec-html/charts.mjs';
export {
  buildTraceabilityGraph,
  classifyScenarioMeta,
  extractMermaidBlocks,
  loadExtendedSpecs,
  loadFeaturesFromDir,
  normalizeSpecStatus,
  parseDecisionLog,
  parseFeature,
  parseFormulas,
  parseGlossary,
  parseInvariants,
  parseMarkdownTables,
  parseNonGoals,
  parseOpenQuestions,
  parseOverrideTargets,
  parseParameters,
  parseRefsList,
  parseStateTransitions,
  parseStatusOrigin,
  resolveDecisionAddendums,
} from './spec-html/parser.mjs';
export { renderHtml } from './spec-html/renderer.mjs';
export {
  validateExtendedSpecs,
  validateInvariantTests,
  validateNoLineNumberRefs,
  validateSymbolRefs,
} from './spec-html/validator.mjs';

export function generateSpecHtml({ projectRoot, outPath }) {
  const bizDir = path.join(projectRoot, 'specs', 'business');
  const appDir = path.join(projectRoot, 'specs', 'app');

  const businessFeatures = loadFeaturesFromDir(bizDir);
  const appFeatures = loadFeaturesFromDir(appDir);
  const graph = buildTraceabilityGraph(businessFeatures, appFeatures);
  const extendedSpecs = loadExtendedSpecs(projectRoot);
  const extValidation = validateExtendedSpecs(graph, extendedSpecs);
  const invariantTestValidation = validateInvariantTests(extendedSpecs.invariants, projectRoot);
  const lineNumberRefValidation = validateNoLineNumberRefs(projectRoot);
  const symbolRefValidation = validateSymbolRefs(projectRoot);
  const html = renderHtml(graph, 'Dungeon Survivor — 仕様書ビューア', extendedSpecs);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  return {
    graph,
    extendedSpecs,
    extValidation,
    invariantTestValidation,
    lineNumberRefValidation,
    symbolRefValidation,
    outPath,
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const projectRoot = path.resolve(__dirname, '..');
  const outArgIndex = process.argv.indexOf('--out');
  const outPath =
    outArgIndex !== -1 && process.argv[outArgIndex + 1]
      ? path.resolve(process.argv[outArgIndex + 1])
      : path.join(projectRoot, 'docs', 'specs.html');

  const { graph, extValidation, invariantTestValidation, lineNumberRefValidation, symbolRefValidation } =
    generateSpecHtml({
      projectRoot,
      outPath,
    });
  console.log(
    `Generated ${outPath} (BIZ=${graph.stats.bizCount}, APP=${graph.stats.appCount}, Confirmed=${graph.stats.confirmedCount}, Inferred=${graph.stats.inferredCount}, Broken=${graph.stats.brokenCount}, ExtDocs=${extValidation.allDocItemsCount}, ExtBroken=${extValidation.brokenDocRefs.length}, InvTests=${invariantTestValidation.checkedCount}, InvTestBroken=${invariantTestValidation.brokenInvariantTests.length}, LineNumRefs=${lineNumberRefValidation.lineNumberRefs.length}, SymbolRefs=${symbolRefValidation.checkedCount}, SymbolRefBroken=${symbolRefValidation.brokenSymbolRefs.length}, DisputedTerms=${extValidation.disputedTerms.length}, UndefTransitions=${extValidation.undefinedTransitions.length})`,
  );
  if (
    graph.stats.brokenCount > 0 ||
    extValidation.brokenDocRefs.length > 0 ||
    invariantTestValidation.brokenInvariantTests.length > 0 ||
    lineNumberRefValidation.lineNumberRefs.length > 0 ||
    symbolRefValidation.brokenSymbolRefs.length > 0
  ) {
    console.error('Traceability issues found:', {
      unlinkedBiz: graph.unlinkedBiz,
      orphanApps: graph.orphanApps,
      brokenDocRefs: extValidation.brokenDocRefs,
      brokenInvariantTests: invariantTestValidation.brokenInvariantTests,
      lineNumberRefs: lineNumberRefValidation.lineNumberRefs,
      brokenSymbolRefs: symbolRefValidation.brokenSymbolRefs,
    });
    process.exitCode = 1;
  }
}
