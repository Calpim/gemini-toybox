export type SkillBranch = 'arms' | 'defense' | 'mobility';

export type SkillNodeId =
  | 'arm_base'
  | 'arm_parallel'
  | 'arm_overclock'
  | 'def_sensor'
  | 'def_pulse'
  | 'def_aegis'
  | 'mob_magnet'
  | 'mob_dash'
  | 'mob_loot';

export const MAX_SKILL_LEVEL = 5;
export const TIER3_MAX_LEVEL = 2;
export const TIER3_SUPPORT_MAX_LEVEL = TIER3_MAX_LEVEL;
export const SKILL_PREREQ_LEVEL = 3;
export const BASE_HIT_INVULN_DURATION = 1.0;

export type SkillLevelMap = Partial<Record<SkillNodeId, number>>;

export interface SkillNodeDef {
  id: SkillNodeId;
  branch: SkillBranch;
  tier: 1 | 2 | 3;
  name: string;
  requires: SkillNodeId | null;
  tagline: string;
  description: string;
  detailNote: string;
}

export interface SkillLevelDetail {
  level: number;
  cost: number;
  summary: string;
}

export interface SkillPrerequisiteInfo {
  id: SkillNodeId;
  name: string;
  requiredLevel: number;
  currentLevel: number;
  met: boolean;
}

export interface SkillDetailedSpec {
  id: SkillNodeId;
  name: string;
  branch: SkillBranch;
  tier: 1 | 2 | 3;
  tagline: string;
  detailNote: string;
  currentLevel: number;
  maxLevel: number;
  currentEffect: string;
  nextCost: number;
  totalCost: number;
  requires: SkillPrerequisiteInfo | null;
  levels: SkillLevelDetail[];
}

export function getSkillMaxLevel(nodeId: SkillNodeId): number {
  if (getSkillNode(nodeId).tier === 3) {
    return TIER3_MAX_LEVEL;
  }
  return MAX_SKILL_LEVEL;
}

/**
 * Required SP to upgrade from `currentLevel` to `currentLevel + 1`:
 * - Tier 1 (max Lv5): Lv0->1: 1, Lv1->2: 1, Lv2->3: 1, Lv3->4: 2, Lv4->5: 2 (total 7 SP)
 * - Tier 2 (max Lv5): Lv0->1: 1, Lv1->2: 1, Lv2->3: 1, Lv3->4: 2, Lv4->5: 3 (total 8 SP)
 * - Tier 3 (max Lv2): Lv0->1: 2, Lv1->2: 3 (total 5 SP)
 * Total per branch: 7 + 8 + 5 = 20 SP (completable at player Lv15; 2 branches at Lv25)
 */
export function getSkillUpgradeCost(currentLevel: number, nodeId?: SkillNodeId): number {
  const tier = nodeId ? getSkillNode(nodeId).tier : 2;
  const maxLv = tier === 3 ? TIER3_MAX_LEVEL : MAX_SKILL_LEVEL;
  if (currentLevel >= maxLv) return Infinity;
  if (tier === 3) {
    return currentLevel === 0 ? 2 : 3;
  }
  if (tier === 1) {
    return currentLevel <= 2 ? 1 : 2;
  }
  if (currentLevel <= 2) return 1;
  if (currentLevel === 3) return 2;
  return 3;
}

export const SKILL_TREE_NODES: readonly SkillNodeDef[] = [
  {
    id: 'arm_base',
    branch: 'arms',
    tier: 1,
    name: '出力強化',
    requires: null,
    tagline: 'メイン威力＆射程UP・チャージ弾化',
    description: 'メイン武器ダメ大幅UP & 主兵装射程延長（Lv3+で極太チャージショット化 / 最大射程+110px）',
    detailNote:
      'メイン武器「コアショット」専用。視線が通る敵へ索敵上限(180px)を超えて攻撃でき、Lv3/Lv5で楕円プラズマチャージ弾が段階的に巨大化します。',
  },
  {
    id: 'arm_parallel',
    branch: 'arms',
    tier: 2,
    name: '追尾レーザー展開',
    requires: 'arm_base',
    tagline: '周囲周回→急加速の追尾レーザーを大量展開',
    description: 'メイン弾は極太1発のまま、周囲周回後に敵へ急加速する追尾レーザー(2〜8発)を同時射出 & 威力UP',
    detailNote:
      'Lv1から追尾レーザー(威力35%)を展開(2→3→4→6→8発)し、Lv2+でメイン威力も上昇(+8〜35%)。44pxを0.26s周回→84pxへ離脱後に高速追尾します。',
  },
  {
    id: 'arm_overclock',
    branch: 'arms',
    tier: 3,
    name: 'オーバークロック',
    requires: 'arm_parallel',
    tagline: '貫通チャージ弾＋両脇極細レーザー追加',
    description: 'メイン武器CD短縮(-22% / -45%) & 弾速UP(+100 / +200) + 貫通化＆両脇に極細レーザー(左右2本 / Lv2で4本・各60%威力)を追加',
    detailNote:
      'メイン武器CD短縮(最小0.20s)＆弾速UPに加え、中央の極太チャージ弾(100%威力・貫通)の両脇へ極細貫通レーザー(各60%威力・10px間隔)を展開します。',
  },
  {
    id: 'def_sensor',
    branch: 'defense',
    tier: 1,
    name: '広域索敵',
    requires: null,
    tagline: '迎撃・装備の索敵レンジを拡大',
    description: '迎撃・攻撃レンジ拡大（Lv1〜3: +8%/Lv → Lv4: +38% / Lv5: +55%、上限180px）',
    detailNote:
      '電磁リパルサーとサブ装備5種の攻撃・索敵レンジに倍率を適用します（通常索敵上限 180px まで）。',
  },
  {
    id: 'def_pulse',
    branch: 'defense',
    tier: 2,
    name: '電磁リパルサー',
    requires: 'def_sensor',
    tagline: '接近した敵を衝撃波で押し返す',
    description: '接近敵を緊急ノックバック（低威力・長めCDで危機回避寄り）',
    detailNote:
      '視線内の周囲敵へ緊急電磁パルスを放ち、ダメージ＋38pxノックバックを与えます（ボス・固定砲台はノックバック無効）。',
  },
  {
    id: 'def_aegis',
    branch: 'defense',
    tier: 3,
    name: 'オートパリィ盾',
    requires: 'def_pulse',
    tagline: '通常弾・近接をパリィし反撃＋無敵',
    description: '通常弾・近接をパリィ無効化＋反撃＆無敵1.0s（Lv1: CD7.0s/22 → Lv2: CD4.5s/42、貫通/迫撃砲/レーザー不可・突進は相打ち）',
    detailNote:
      '通常弾・近接接触をパリィ無効化し反撃＋無敵1.0s。貫通弾・迫撃砲・レーザーは無効化不可（ボス突進は被弾しつつ相打ち反撃）。',
  },
  {
    id: 'mob_magnet',
    branch: 'mobility',
    tier: 1,
    name: '磁力回収フレーム',
    requires: null,
    tagline: 'アイテム吸引範囲と回復効果を強化',
    description: '吸引範囲＆回復オーブ強化（Lv4: 回復+50% / Lv5: 吸引+160% & 回復+75%）',
    detailNote:
      '基礎吸引距離(95px)の倍率と、回復オーブ取得時のHP回復量を乗算で強化します。',
  },
  {
    id: 'mob_loot',
    branch: 'mobility',
    tier: 2,
    name: 'トレジャー解析',
    requires: 'mob_magnet',
    tagline: '装備ドロップ率・品質とEXPを強化',
    description: '装備ドロップ品質＆ドロップ率UP + 宝箱・EXP強化（サブ装備固めの要）',
    detailNote:
      '基礎装備ドロップ率(1.5%)への加算と抽選品質Tier上昇に加え、宝箱率・獲得EXP倍率を強化します。',
  },
  {
    id: 'mob_dash',
    branch: 'mobility',
    tier: 3,
    name: '緊急回避ブースト',
    requires: 'mob_loot',
    tagline: '全攻撃をノーダメ回避＋無敵・加速',
    description: '全攻撃をチャージ消費でノーダメ回避＋無敵延長＆2.5s移動加速（Lv1: 1回/1.30s/+24% → Lv2: 2回/1.60s/+38%）',
    detailNote:
      '被弾時にチャージ消費で全攻撃(貫通・迫撃砲・レーザー・突進含む)をノーダメ回避し、無敵延長＋2.5s移動加速（パリィ盾が通常攻撃を優先し温存）。',
  },
] as const;

export function getSkillNode(id: SkillNodeId): SkillNodeDef {
  const found = SKILL_TREE_NODES.find((n) => n.id === id);
  if (!found) {
    throw new Error(`Unknown skill node: ${id}`);
  }
  return found;
}

export function getSkillLevel(levels: SkillLevelMap, nodeId: SkillNodeId): number {
  return Math.max(0, Math.min(getSkillMaxLevel(nodeId), levels[nodeId] ?? 0));
}

export function canUpgradeSkill(
  levels: SkillLevelMap,
  skillPoints: number,
  nodeId: SkillNodeId
): boolean {
  const currLevel = getSkillLevel(levels, nodeId);
  const maxLevel = getSkillMaxLevel(nodeId);
  if (currLevel >= maxLevel) return false;
  const node = getSkillNode(nodeId);
  const cost = getSkillUpgradeCost(currLevel, nodeId);
  if (skillPoints < cost) return false;
  if (node.requires === null) return true;
  return getSkillLevel(levels, node.requires) >= SKILL_PREREQ_LEVEL;
}

export const canUnlockSkill = canUpgradeSkill;

// Per-level scaling curves [Lv0, Lv1, Lv2, Lv3, Lv4, Lv5]
// Arms: Main Weapon dedicated scaling (DEC-19 / DEC-20 / PRM-18 / PRM-23)
const ARM_MAIN_DAMAGE_PCT = [0, 0.25, 0.5, 0.8, 1.2, 1.7] as const;
const ARM_MAIN_RANGE_BONUS = [0, 20, 40, 60, 85, 110] as const;
const ARM_MAIN_EXTRA_SHOTS = [0, 0, 0, 0, 0, 0] as const;
const ARM_MAIN_PARALLEL_DMG_PCT = [0, 0, 0.08, 0.16, 0.25, 0.35] as const;
const ARM_MAIN_HOMING_SHOTS = [0, 2, 3, 4, 6, 8] as const;
const ARM_MAIN_CD_REDUCTION = [0, 0.22, 0.45] as const;
const ARM_MAIN_SPEED_BONUS = [0, 100, 200] as const;

// Defense: Sensor range + controlled emergency defense (def_aegis capped at Lv2)
const DEF_RANGE_PCT = [0, 0.08, 0.16, 0.24, 0.38, 0.55] as const;
const DEF_PULSE_DMG = [0, 6, 8, 10, 14, 18] as const;
const DEF_PULSE_CD = [0, 4.2, 3.9, 3.6, 3.2, 2.8] as const;
const DEF_PULSE_RANGE = [0, 100, 108, 116, 132, 150] as const;
const DEF_AEGIS_DMG = [0, 22, 42] as const;
const DEF_AEGIS_CD = [0, 7.0, 4.5] as const;

// Mobility: Magnet (Tier 1) -> Treasure/Drop Quality & Rate (Tier 2) -> Evasion Boost (Tier 3, capped at Lv2)
const MOB_MAGNET_PCT = [0, 0.22, 0.44, 0.66, 1.05, 1.6] as const;
const MOB_HEAL_PCT = [0, 0.1, 0.2, 0.3, 0.5, 0.75] as const;
const MOB_LOOT_PCT = [0, 0.1, 0.2, 0.3, 0.45, 0.65] as const;
const MOB_DROP_BONUS = [0, 0.005, 0.01, 0.015, 0.023, 0.035] as const;
const MOB_DROP_QUALITY = [0, 1, 2, 3, 4, 5] as const;
const MOB_EXP_PCT = [0, 0.08, 0.16, 0.24, 0.42, 0.68] as const;
const MOB_DASH_INVULN = [BASE_HIT_INVULN_DURATION, 1.3, 1.6] as const;
const MOB_DASH_CHARGES = [0, 1, 2] as const;
const MOB_DASH_CD = [0, 4.5, 3.5] as const;
const MOB_DASH_SPEED_BOOST = [0, 0.24, 0.38] as const;
export const TACTICAL_SPEED_BOOST_DURATION = 2.5;

export interface ComputedSkillModifiers {
  totalSkillLevels: number;
  armBaseLevel: number;
  armOverclockLevel: number;
  mainDamageMult: number;
  mainRangeBonus: number;
  mainExtraShots: number;
  mainParallelDamageMult: number;
  mainHomingShots: number;
  mainCooldownMult: number;
  piercingMainShot: boolean;
  mainSpeedBonus: number;
  rangeMult: number;
  hasRepulsor: boolean;
  repulsorDamage: number;
  repulsorCooldown: number;
  repulsorRange: number;
  hasAegisParry: boolean;
  aegisCooldown: number;
  aegisDamage: number;
  pickupMagnetMult: number;
  healBonusMult: number;
  lootBonusRate: number;
  equipDropBonus: number;
  dropQualityTier: number;
  expMult: number;
  hasTacticalStep: boolean;
  tacticalInvulnDuration: number;
  tacticalMaxCharges: number;
  tacticalStepCooldown: number;
  tacticalSpeedBonus: number;
}

export function computeSkillModifiers(levels: SkillLevelMap): ComputedSkillModifiers {
  const armBaseLv = getSkillLevel(levels, 'arm_base');
  const armParallelLv = getSkillLevel(levels, 'arm_parallel');
  const armOverclockLv = getSkillLevel(levels, 'arm_overclock');
  const defSensorLv = getSkillLevel(levels, 'def_sensor');
  const defPulseLv = getSkillLevel(levels, 'def_pulse');
  const defAegisLv = getSkillLevel(levels, 'def_aegis');
  const mobMagnetLv = getSkillLevel(levels, 'mob_magnet');
  const mobLootLv = getSkillLevel(levels, 'mob_loot');
  const mobDashLv = getSkillLevel(levels, 'mob_dash');

  const totalSkillLevels =
    armBaseLv +
    armParallelLv +
    armOverclockLv +
    defSensorLv +
    defPulseLv +
    defAegisLv +
    mobMagnetLv +
    mobLootLv +
    mobDashLv;

  return {
    totalSkillLevels,
    armBaseLevel: armBaseLv,
    armOverclockLevel: armOverclockLv,
    mainDamageMult: 1 + ARM_MAIN_DAMAGE_PCT[armBaseLv],
    mainRangeBonus: ARM_MAIN_RANGE_BONUS[armBaseLv],
    mainExtraShots: ARM_MAIN_EXTRA_SHOTS[armParallelLv],
    mainParallelDamageMult: 1 + ARM_MAIN_PARALLEL_DMG_PCT[armParallelLv],
    mainHomingShots: ARM_MAIN_HOMING_SHOTS[armParallelLv],
    mainCooldownMult: Math.max(0.55, 1 - ARM_MAIN_CD_REDUCTION[armOverclockLv]),
    piercingMainShot: armOverclockLv >= 1,
    mainSpeedBonus: ARM_MAIN_SPEED_BONUS[armOverclockLv],
    rangeMult: 1 + DEF_RANGE_PCT[defSensorLv],
    hasRepulsor: defPulseLv >= 1,
    repulsorDamage: DEF_PULSE_DMG[defPulseLv],
    repulsorCooldown: DEF_PULSE_CD[defPulseLv],
    repulsorRange: DEF_PULSE_RANGE[defPulseLv],
    hasAegisParry: defAegisLv >= 1,
    aegisCooldown: DEF_AEGIS_CD[defAegisLv],
    aegisDamage: DEF_AEGIS_DMG[defAegisLv],
    pickupMagnetMult: 1 + MOB_MAGNET_PCT[mobMagnetLv],
    healBonusMult: 1 + MOB_HEAL_PCT[mobMagnetLv],
    lootBonusRate: MOB_LOOT_PCT[mobLootLv],
    equipDropBonus: MOB_DROP_BONUS[mobLootLv],
    dropQualityTier: MOB_DROP_QUALITY[mobLootLv],
    expMult: 1 + MOB_EXP_PCT[mobLootLv],
    hasTacticalStep: mobDashLv >= 1,
    tacticalInvulnDuration: MOB_DASH_INVULN[mobDashLv],
    tacticalMaxCharges: MOB_DASH_CHARGES[mobDashLv],
    tacticalStepCooldown: MOB_DASH_CD[mobDashLv],
    tacticalSpeedBonus: MOB_DASH_SPEED_BOOST[mobDashLv],
  };
}

export function getSkillEffectSummary(nodeId: SkillNodeId, level: number): string {
  const lv = Math.max(0, Math.min(getSkillMaxLevel(nodeId), level));
  if (lv <= 0) return '未習得';
  switch (nodeId) {
    case 'arm_base':
      return `メイン威力 +${Math.round(ARM_MAIN_DAMAGE_PCT[lv] * 100)}% / 射程+${ARM_MAIN_RANGE_BONUS[lv]}px`;
    case 'arm_parallel': {
      const dmgPct = Math.round(ARM_MAIN_PARALLEL_DMG_PCT[lv] * 100);
      const homing = ARM_MAIN_HOMING_SHOTS[lv];
      if (dmgPct > 0) {
        return `追尾レーザー${homing}発 / メイン威力 +${dmgPct}%`;
      }
      return `追尾レーザー${homing}発`;
    }
    case 'arm_overclock':
      return `CD -${Math.round(ARM_MAIN_CD_REDUCTION[lv] * 100)}% / 弾速+${ARM_MAIN_SPEED_BONUS[lv]} / ${lv >= 2 ? '貫通チャージ＋脇レーザー4本' : '貫通チャージ＋脇レーザー2本'}`;
    case 'def_sensor':
      return `レンジ +${Math.round(DEF_RANGE_PCT[lv] * 100)}%`;
    case 'def_pulse':
      return `威力${DEF_PULSE_DMG[lv]} / 範囲${DEF_PULSE_RANGE[lv]} / CD ${DEF_PULSE_CD[lv].toFixed(1)}s`;
    case 'def_aegis':
      return `反撃${DEF_AEGIS_DMG[lv]} / CD ${DEF_AEGIS_CD[lv].toFixed(1)}s`;
    case 'mob_magnet':
      return `吸引 +${Math.round(MOB_MAGNET_PCT[lv] * 100)}% / 回復 +${Math.round(MOB_HEAL_PCT[lv] * 100)}%`;
    case 'mob_loot':
      return `品質+${MOB_DROP_QUALITY[lv]} / 装備率+${(MOB_DROP_BONUS[lv] * 100).toFixed(1)}% / EXP+${Math.round(MOB_EXP_PCT[lv] * 100)}%`;
    case 'mob_dash':
      return `連続${MOB_DASH_CHARGES[lv]}回 / 無敵${MOB_DASH_INVULN[lv].toFixed(2)}s / 加速+${Math.round(MOB_DASH_SPEED_BOOST[lv] * 100)}% / 回復${MOB_DASH_CD[lv].toFixed(1)}s`;
  }
}

function getSkillLevelDetailSummary(nodeId: SkillNodeId, level: number): string {
  const base = getSkillEffectSummary(nodeId, level);
  switch (nodeId) {
    case 'arm_base':
      if (level === 3) return `${base} / 弾拡大・残像`;
      if (level === 5) return `${base} / 最大拡大`;
      return base;
    case 'def_aegis':
      return `${base} / 無敵${BASE_HIT_INVULN_DURATION.toFixed(1)}s`;
    case 'mob_loot':
      return `${base} / 宝+${Math.round(MOB_LOOT_PCT[level] * 100)}%`;
    default:
      return base;
  }
}

export function getSkillDetailedSpec(
  nodeId: SkillNodeId,
  levels: SkillLevelMap
): SkillDetailedSpec {
  const node = getSkillNode(nodeId);
  const currentLevel = getSkillLevel(levels, nodeId);
  const maxLevel = getSkillMaxLevel(nodeId);
  const nextCost = getSkillUpgradeCost(currentLevel, nodeId);

  const levelDetails: SkillLevelDetail[] = [];
  let totalCost = 0;
  for (let lv = 1; lv <= maxLevel; lv++) {
    const cost = getSkillUpgradeCost(lv - 1, nodeId);
    totalCost += cost;
    levelDetails.push({
      level: lv,
      cost,
      summary: getSkillLevelDetailSummary(nodeId, lv),
    });
  }

  let requires: SkillPrerequisiteInfo | null = null;
  if (node.requires !== null) {
    const reqNode = getSkillNode(node.requires);
    const reqCurrLv = getSkillLevel(levels, node.requires);
    requires = {
      id: reqNode.id,
      name: reqNode.name,
      requiredLevel: SKILL_PREREQ_LEVEL,
      currentLevel: reqCurrLv,
      met: reqCurrLv >= SKILL_PREREQ_LEVEL,
    };
  }

  return {
    id: node.id,
    name: node.name,
    branch: node.branch,
    tier: node.tier,
    tagline: node.tagline,
    detailNote: node.detailNote,
    currentLevel,
    maxLevel,
    currentEffect:
      currentLevel > 0 ? getSkillLevelDetailSummary(nodeId, currentLevel) : '未習得',
    nextCost,
    totalCost,
    requires,
    levels: levelDetails,
  };
}
