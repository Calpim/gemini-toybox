export function extractFormulaParamValues(parameters) {
  const byId = new Map((parameters?.items || []).map((p) => [p.id, String(p.value || '')]));
  const getVal = (id) => byId.get(id) || '';

  const prm04 = getVal('PRM-04');
  const expInitMatch = prm04.match(/(\d+(?:\.\d+)?)/);
  const expMultMatch = prm04.match(/×\s*(\d+(?:\.\d+)?)/);
  const expInit = expInitMatch ? Number(expInitMatch[1]) : 25;
  const expMult = expMultMatch ? Number(expMultMatch[1]) : 1.22;

  const prm06 = getVal('PRM-06');
  const maxTargetMatch = prm06.match(/(\d+(?:\.\d+)?)/);
  const maxTargetRange = maxTargetMatch ? Number(maxTargetMatch[1]) : 180;

  const prm09 = getVal('PRM-09');
  const prm09Tier1Block = prm09.match(/Tier1[^｜]*/)?.[0] || '';
  const tier1Matches = [...prm09Tier1Block.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
  const tier1LowCost = tier1Matches[0] ?? 1;
  const tier1HighCost = tier1Matches[1] ?? 2;
  const isLegacyTier1_4 = /Lv1-4/.test(prm09Tier1Block);
  const tier1Costs = isLegacyTier1_4
    ? [0, tier1LowCost, tier1LowCost, tier1LowCost, tier1LowCost, tier1HighCost]
    : [0, tier1LowCost, tier1LowCost, tier1LowCost, tier1HighCost, tier1HighCost];
  const tier1CostLabel = isLegacyTier1_4
    ? `Lv1-4:${tier1LowCost}/Lv5:${tier1HighCost}`
    : `Lv1-3:${tier1LowCost}/Lv4-5:${tier1HighCost}`;

  const prm09Tier2Block = prm09.match(/Tier2[^｜]*/)?.[0] || prm09;
  const spCostMatches = [...prm09Tier2Block.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
  const spCostLv1_3 = spCostMatches[0] ?? 1;
  const spCostLv4 = spCostMatches[1] ?? 2;
  const spCostLv5 = spCostMatches[2] ?? 3;
  const tier2Costs = [0, spCostLv1_3, spCostLv1_3, spCostLv1_3, spCostLv4, spCostLv5];

  const prm09Tier3Block = prm09.match(/Tier3[^｜]*/)?.[0] || '';
  const tier3Matches = [...prm09Tier3Block.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
  const tier3CostLv1 = tier3Matches[0] ?? 2;
  const tier3CostLv2 = tier3Matches[1] ?? 3;
  const tier3Costs = [0, tier3CostLv1, tier3CostLv2];

  const prm10 = getVal('PRM-10');
  const maxSkillLvMatch = prm10.match(/最大\s*Lv(\d+)/);
  const maxSkillLv = maxSkillLvMatch ? Number(maxSkillLvMatch[1]) : 5;
  const tier3MaxLvMatch = prm10.match(/Tier3[^｜]*最大\s*Lv(\d+)/);
  const tier3MaxLv = tier3MaxLvMatch ? Number(tier3MaxLvMatch[1]) : 2;

  const prm17 = getVal('PRM-17');
  const coreDmgMatch = prm17.match(/威力\s*(\d+(?:\.\d+)?)/);
  const coreCdMatch = prm17.match(/CD\s*(\d+(?:\.\d+)?)/);
  const coreRangeMatch = prm17.match(/射程\s*(\d+(?:\.\d+)?)/);
  const coreThreshMatch = prm17.match(/閾値\s*([\d,\s]+)\s*SP/);
  const coreMaxShotsMatch = prm17.match(/最大\s*(\d+)発/);
  const coreBaseDmg = coreDmgMatch ? Number(coreDmgMatch[1]) : 14;
  const coreBaseCd = coreCdMatch ? Number(coreCdMatch[1]) : 0.58;
  const coreBaseRange = coreRangeMatch ? Number(coreRangeMatch[1]) : 180;
  const hasLegacySpScaling = Boolean(coreThreshMatch);
  const coreShotThresholds = coreThreshMatch
    ? coreThreshMatch[1]
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n))
    : [];
  const coreMaxShots = coreMaxShotsMatch ? Number(coreMaxShotsMatch[1]) : 4;

  const prm18 = getVal('PRM-18');
  const coreSpDmgMatch = prm18.match(/威力\+(\d+(?:\.\d+)?)/);
  const coreSpCdStepMatch = prm18.match(/CD短縮(\d+(?:\.\d+)?)/);
  const coreSpCdCapMatch = prm18.match(/上限(\d+(?:\.\d+)?)/);
  const coreMinCdMatch = prm18.match(/最小CD\s*(\d+(?:\.\d+)?)/);
  const coreMinCdMultMatch = prm18.match(/最小CD倍率\s*(\d+(?:\.\d+)?)/);
  const coreSpRangeMatch = prm18.match(/射程\+(\d+(?:\.\d+)?)/);
  const coreSpDmg = coreSpDmgMatch ? Number(coreSpDmgMatch[1]) : hasLegacySpScaling ? 1.8 : 0;
  const coreSpCdStep = coreSpCdStepMatch ? Number(coreSpCdStepMatch[1]) : hasLegacySpScaling ? 0.015 : 0;
  const coreSpCdCap = coreSpCdCapMatch ? Number(coreSpCdCapMatch[1]) : 0.24;
  const coreMinCd = coreMinCdMatch ? Number(coreMinCdMatch[1]) : 0.24;
  const coreMinCdMult = coreMinCdMultMatch ? Number(coreMinCdMultMatch[1]) : 0.6;
  const coreSpRange = coreSpRangeMatch ? Number(coreSpRangeMatch[1]) : hasLegacySpScaling ? 3 : 0;

  const parsePlusCurve = (str, fallback) => {
    const nums = str?.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 5) return fallback;
    return [0, ...nums.slice(0, 5).map((n) => Math.abs(Number(n)))];
  };
  const armParallelExtraShots = parsePlusCurve(
    prm18.match(/arm_parallel(?:平行)?追加弾数\(([^)]+)\)/)?.[1],
    [0, 0, 0, 0, 0, 0],
  );
  const armParallelDmgPct = parsePlusCurve(prm18.match(/威力補正\(([^)]+)\)/)?.[1], [0, 0, 6, 6, 14, 20]);

  const prm23 = getVal('PRM-23');
  const parsePctCurve = (label, fallback) => {
    const re = new RegExp(`${label}\\(([^)]+)\\)`);
    const block = prm23.match(re)?.[1] || '';
    const pctPart = block.includes('%') ? block.split('%')[0] : block;
    const nums = pctPart.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!nums || nums.length === 0) return fallback;
    const vals = nums.map((n) => Math.abs(Number(n)));
    if (vals.length === 2) {
      return [0, vals[0], vals[1], vals[1], vals[1], vals[1]];
    }
    if (vals.length < 5) return fallback;
    return [0, ...vals.slice(0, 5)];
  };
  const armBasePct = parsePctCurve('arm_base', [0, 10, 20, 30, 45, 65]);
  const armOverclockPct = parsePctCurve('arm_overclock', [0, 6, 12, 18, 26, 35]);
  const defSensorPct = parsePctCurve('def_sensor', [0, 8, 16, 24, 38, 55]);
  const mobLootBlock = prm23.match(/mob_loot\(([^)]+)\)/)?.[1] || '';
  const expPart = mobLootBlock.match(/EXP([+\-\d/]+)/)?.[1] || '';
  const expNums = expPart.match(/\d+(?:\.\d+)?/g);
  const mobLootExpPct =
    expNums && expNums.length >= 5 ? [0, ...expNums.slice(0, 5).map(Number)] : [0, 8, 16, 24, 42, 68];
  const armBaseRangeBonus = parsePlusCurve(
    prm18.match(/arm_base主兵装射程加算\(([^)]+)\)/)?.[1] || prm23.match(/arm_base\([^)]*射程([^),]+)/)?.[1],
    [0, 20, 40, 60, 85, 110],
  );
  const ocLv1Match =
    prm18.match(/発射本数[^)\n]*Lv1:\s*(?:最低\s*)?(\d+)本/) ||
    prm23.match(/発射本数[^),\n]*Lv1:\s*(?:最低\s*)?(\d+)本/);
  const ocLv2Match =
    prm18.match(/発射本数[^)\n]*Lv2:\s*(?:最低\s*)?(\d+)本/) ||
    prm23.match(/発射本数[^),\n]*Lv2:\s*(?:最低\s*)?(\d+)本/);
  const ocLv1MinShots = ocLv1Match ? Number(ocLv1Match[1]) : 3;
  const ocLv2MinShots = ocLv2Match ? Number(ocLv2Match[1]) : 5;

  return {
    expInit,
    expMult,
    maxTargetRange,
    spCostLv1_3,
    spCostLv4,
    spCostLv5,
    tier1CostLv1_4: tier1LowCost,
    tier1CostLv5: tier1HighCost,
    tier1CostLabel,
    tier1Costs,
    tier2Costs,
    tier3CostLv1,
    tier3CostLv2,
    tier3Costs,
    maxSkillLv,
    tier3MaxLv,
    hasLegacySpScaling,
    coreBaseDmg,
    coreBaseCd,
    coreBaseRange,
    coreShotThresholds,
    coreMaxShots,
    coreSpDmg,
    coreSpCdStep,
    coreSpCdCap,
    coreMinCd,
    coreMinCdMult,
    coreSpRange,
    armParallelExtraShots,
    armParallelDmgPct,
    armBaseRangeBonus,
    ocLv1MinShots,
    ocLv2MinShots,
    armBasePct,
    armOverclockPct,
    defSensorPct,
    mobLootExpPct,
  };
}

export function buildFormulaChartsData(parameters) {
  const p = extractFormulaParamValues(parameters);

  // 1. EXP curve (Lv 1..15)
  const expRows = [];
  let nextExp = p.expInit;
  let cumExp = 0;
  for (let lv = 1; lv <= 15; lv++) {
    expRows.push({
      lv,
      expToNext: nextExp,
      cumExp,
    });
    cumExp += nextExp;
    nextExp = Math.round(nextExp * p.expMult);
  }

  // 2. Main Weapon (Core Shot) growth
  const coreShotRows = [];
  let coreShotChart;
  if (p.hasLegacySpScaling) {
    for (const sp of [0, 1, 2, 3, 5, 7, 9, 12, 14, 16]) {
      const damage = Math.round(p.coreBaseDmg + sp * p.coreSpDmg);
      const cooldown = Number(
        Math.max(p.coreMinCd, p.coreBaseCd - Math.min(p.coreSpCdCap, sp * p.coreSpCdStep)).toFixed(3),
      );
      const range = Math.min(p.maxTargetRange, Math.round(p.coreBaseRange + sp * p.coreSpRange));
      const bonusShots = p.coreShotThresholds.filter((t) => sp >= t).length;
      const shotCount = Math.min(p.coreMaxShots, 1 + bonusShots);
      const dps = Number(((damage * shotCount) / cooldown).toFixed(1));
      coreShotRows.push({ sp, damage, cooldown, range, shotCount, dps });
    }
    coreShotChart = {
      id: 'chart-core-shot',
      formulaIds: ['FML-03', 'FML-04', 'FML-05'],
      paramRefs: ['PRM-06', 'PRM-17', 'PRM-18'],
      title: '基本攻撃（コアショット）SP連動成長（FML-03〜05・スキル補正なし基礎値）',
      formulaExpr: `威力=round(PRM-17[${p.coreBaseDmg}] + SP×PRM-18[${p.coreSpDmg}]), CD=max(PRM-18[${p.coreMinCd}], PRM-17[${p.coreBaseCd}] - min(PRM-18[${p.coreSpCdCap}], SP×PRM-18[${p.coreSpCdStep}])), 射程=min(PRM-06[${p.maxTargetRange}], PRM-17[${p.coreBaseRange}] + SP×PRM-18[${p.coreSpRange}]), 発射数=閾値[${p.coreShotThresholds.join(',')}]`,
      xLabel: 'sp',
      series: [
        { key: 'dps', label: '理論総DPS (DMG/s)', color: '#34d399', unit: 'DMG/s' },
        { key: 'range', label: '射程 (px)', color: '#fbbf24', unit: 'px' },
      ],
      columns: [
        { key: 'sp', label: '使用SP' },
        { key: 'damage', label: '1発威力' },
        { key: 'shotCount', label: '発射数' },
        { key: 'cooldown', label: 'CD(秒)' },
        { key: 'range', label: '射程(px)' },
        { key: 'dps', label: '理論DPS' },
      ],
      rows: coreShotRows,
    };
  } else {
    for (let lv = 0; lv <= p.maxSkillLv; lv++) {
      const ocLv = Math.min(p.tier3MaxLv, lv);
      const baseMult = 1 + (p.armBasePct[lv] ?? 0) / 100;
      const parallelMult = 1 + (p.armParallelDmgPct[lv] ?? 0) / 100;
      const ocReduction = (p.armOverclockPct[lv] ?? 0) / 100;
      const damage = Math.round(p.coreBaseDmg * baseMult * parallelMult);
      const cooldown = Number(
        Math.max(p.coreMinCd, p.coreBaseCd * Math.max(p.coreMinCdMult, 1 - ocReduction)).toFixed(3),
      );
      const range = Math.min(p.maxTargetRange, p.coreBaseRange) + (p.armBaseRangeBonus[lv] ?? 0);
      const baseShots = 1 + (p.armParallelExtraShots[lv] ?? 0);
      const shotCount =
        ocLv >= 2
          ? Math.max(p.ocLv2MinShots, baseShots)
          : ocLv === 1
            ? Math.max(p.ocLv1MinShots, baseShots)
            : baseShots;
      const dps = Number(((damage * shotCount) / cooldown).toFixed(1));
      coreShotRows.push({ lv, damage, cooldown, range, shotCount, dps });
    }
    coreShotChart = {
      id: 'chart-core-shot',
      formulaIds: ['FML-03', 'FML-04', 'FML-05'],
      paramRefs: ['PRM-06', 'PRM-17', 'PRM-18', 'PRM-23'],
      title: 'メイン武器（コアショット）兵装スキル連動成長（FML-03〜05・総SP連動廃止）',
      formulaExpr: `威力=round(PRM-17[${p.coreBaseDmg}]×(1+PRM-23[arm_base])×(1+PRM-18[parallel])), CD=max(PRM-18[${p.coreMinCd}], PRM-17[${p.coreBaseCd}]×max(${p.coreMinCdMult}, 1-PRM-23[arm_overclock])), 発射数=max(1+parallel, OC Lv1:最低${p.ocLv1MinShots}本 / Lv2:${p.ocLv2MinShots}本), 射程=min(PRM-06[${p.maxTargetRange}], PRM-17[${p.coreBaseRange}])+PRM-23[arm_base射程]`,
      xLabel: 'lv',
      series: [
        { key: 'dps', label: '理論総DPS (DMG/s)', color: '#34d399', unit: 'DMG/s' },
        { key: 'damage', label: '1発威力 (DMG)', color: '#fbbf24', unit: 'DMG' },
      ],
      columns: [
        { key: 'lv', label: '兵装Lv' },
        { key: 'damage', label: '1発威力' },
        { key: 'shotCount', label: '発射数' },
        { key: 'cooldown', label: 'CD(秒)' },
        { key: 'range', label: '射程(px)' },
        { key: 'dps', label: '理論DPS' },
      ],
      rows: coreShotRows,
    };
  }

  // 3. Skill Lv0..Lv5 growth curve & cumulative SP cost per Tier
  const skillRows = [];
  let tier1Cum = 0;
  let tier2Cum = 0;
  let tier3Cum = 0;
  for (let lv = 0; lv <= p.maxSkillLv; lv++) {
    const tier1Cost = p.tier1Costs[lv] ?? (lv === 0 ? 0 : lv <= 3 ? p.tier1CostLv1_4 : p.tier1CostLv5);
    const tier2Cost =
      p.tier2Costs[lv] ?? (lv === 0 ? 0 : lv <= 3 ? p.spCostLv1_3 : lv === 4 ? p.spCostLv4 : p.spCostLv5);
    const tier3Cost = lv <= p.tier3MaxLv ? (p.tier3Costs[lv] ?? 0) : null;
    tier1Cum += tier1Cost;
    tier2Cum += tier2Cost;
    if (tier3Cost !== null) {
      tier3Cum += tier3Cost;
    }
    const tier3CumSp = tier3Cost !== null ? tier3Cum : null;
    skillRows.push({
      lv,
      stepCost: tier2Cost,
      cumSp: tier2Cum,
      tier1Cost,
      tier1CumSp: tier1Cum,
      tier2Cost,
      tier2CumSp: tier2Cum,
      tier3Cost,
      tier3CumSp,
      tier1Label: lv === 0 ? '0' : `${tier1Cost} (計${tier1Cum})`,
      tier2Label: lv === 0 ? '0' : `${tier2Cost} (計${tier2Cum})`,
      tier3Label: tier3Cost === null ? '-' : lv === 0 ? '0' : `${tier3Cost} (計${tier3Cum})`,
      armBasePct: p.armBasePct[lv] ?? 0,
      armOverclockPct: p.armOverclockPct[lv] ?? 0,
      defSensorPct: p.defSensorPct[lv] ?? 0,
      mobLootExpPct: p.mobLootExpPct[lv] ?? 0,
    });
  }
  const tier1TotalSp = p.tier1Costs.reduce((sum, v) => sum + v, 0);
  const tier2TotalSp = p.tier2Costs.reduce((sum, v) => sum + v, 0);
  const tier3TotalSp = p.tier3Costs.reduce((sum, v) => sum + v, 0);

  return [
    {
      id: 'chart-exp-curve',
      formulaIds: ['FML-01'],
      paramRefs: ['PRM-04'],
      title: '必要経験値カーブ（FML-01）',
      formulaExpr: `expToNext(1) = PRM-04[初期=${p.expInit}], expToNext(Lv) = round(expToNext(Lv-1) × PRM-04[倍率=${p.expMult}])`,
      xLabel: 'lv',
      series: [
        { key: 'expToNext', label: '次Lv必要EXP', color: '#38bdf8', unit: 'EXP' },
        { key: 'cumExp', label: '累積EXP', color: '#a78bfa', unit: 'EXP' },
      ],
      columns: [
        { key: 'lv', label: 'Lv' },
        { key: 'expToNext', label: '次Lv必要EXP' },
        { key: 'cumExp', label: '累積EXP' },
      ],
      rows: expRows,
    },
    coreShotChart,
    {
      id: 'chart-skill-curve',
      formulaIds: ['FML-02', 'FML-12'],
      paramRefs: ['PRM-09', 'PRM-10', 'PRM-23'],
      title: 'スキル成長カーブとTier別必要SP・累積SP（FML-02 / FML-12）',
      formulaExpr: `Tier1=PRM-09[${p.tier1CostLabel}(計${tier1TotalSp}SP)], Tier2=PRM-09[Lv1-3:${p.spCostLv1_3}/Lv4:${p.spCostLv4}/Lv5:${p.spCostLv5}(計${tier2TotalSp}SP)], Tier3=PRM-09[Lv1:${p.tier3CostLv1}/Lv2:${p.tier3CostLv2}(最大Lv${p.tier3MaxLv}・計${tier3TotalSp}SP)], 最大Lv=PRM-10[${p.maxSkillLv}], 成長率=PRM-23`,
      xLabel: 'lv',
      series: [
        { key: 'armBasePct', label: '出力強化 威力+%', color: '#f87171', unit: '%' },
        { key: 'defSensorPct', label: '広域索敵 射程+%', color: '#38bdf8', unit: '%' },
        { key: 'armOverclockPct', label: 'OC CD短縮%', color: '#fbbf24', unit: '%' },
      ],
      columns: [
        { key: 'lv', label: 'Lv' },
        { key: 'tier1Label', label: 'Tier1 SP(累計)' },
        { key: 'tier2Label', label: 'Tier2 SP(累計)' },
        { key: 'tier3Label', label: 'Tier3 SP(累計)' },
        { key: 'armBasePct', label: '威力+%' },
        { key: 'defSensorPct', label: '射程+%' },
        { key: 'armOverclockPct', label: 'CD短縮%' },
        { key: 'mobLootExpPct', label: 'EXP+%' },
      ],
      rows: skillRows,
    },
  ];
}
