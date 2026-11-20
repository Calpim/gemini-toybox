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
  description: string;
}

export function getSkillMaxLevel(nodeId: SkillNodeId): number {
  if (getSkillNode(nodeId).tier === 3) {
    return TIER3_MAX_LEVEL;
  }
  return MAX_SKILL_LEVEL;
}

/**
 * Required SP to upgrade from `currentLevel` to `currentLevel + 1`:
 * - Tier 1 (max Lv5): Lv0->1: 1, Lv1->2: 1, Lv2->3: 1, Lv3->4: 1, Lv4->5: 2 (total 6 SP)
 * - Tier 2 (max Lv5): Lv0->1: 1, Lv1->2: 1, Lv2->3: 1, Lv3->4: 2, Lv4->5: 3 (total 8 SP)
 * - Tier 3 (max Lv2): Lv0->1: 2, Lv1->2: 3 (total 5 SP)
 * Total per branch: 6 + 8 + 5 = 19 SP (completable at player Lv20)
 */
export function getSkillUpgradeCost(currentLevel: number, nodeId?: SkillNodeId): number {
  const tier = nodeId ? getSkillNode(nodeId).tier : 2;
  const maxLv = tier === 3 ? TIER3_MAX_LEVEL : MAX_SKILL_LEVEL;
  if (currentLevel >= maxLv) return Infinity;
  if (tier === 3) {
    return currentLevel === 0 ? 2 : 3;
  }
  if (tier === 1) {
    return currentLevel <= 3 ? 1 : 2;
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
    description: 'メイン武器ダメ大幅UP & 主兵装射程延長（Lv3+で弾拡大・残像強化 / 最大射程+110px）',
  },
  {
    id: 'arm_parallel',
    branch: 'arms',
    tier: 2,
    name: '並列射出',
    requires: 'arm_base',
    description: 'メイン弾を平行射出（+1〜3発 & 威力UP）+ 周囲周回後に敵へ飛ぶ小型誘導バラマキ弾を同時射出',
  },
  {
    id: 'arm_overclock',
    branch: 'arms',
    tier: 3,
    name: 'オーバークロック',
    requires: 'arm_parallel',
    description: 'メイン武器CD短縮(-22% / -45%) & 弾速UP(+100 / +200) + 貫通レーザー化（最低3本 / Lv2で5本・光線強化）',
  },
  {
    id: 'def_sensor',
    branch: 'defense',
    tier: 1,
    name: '広域索敵',
    requires: null,
    description: '迎撃・攻撃レンジ拡大（Lv1〜3: +8%/Lv → Lv4: +38% / Lv5: +55%、上限180px）',
  },
  {
    id: 'def_pulse',
    branch: 'defense',
    tier: 2,
    name: '電磁リパルサー',
    requires: 'def_sensor',
    description: '接近敵を緊急ノックバック（低威力・長めCDで危機回避寄り）',
  },
  {
    id: 'def_aegis',
    branch: 'defense',
    tier: 3,
    name: 'オートパリィ盾',
    requires: 'def_pulse',
    description: '被弾無効パリィ＋小反撃＆無敵1.0s（Lv1: CD7.0s/反撃22 → Lv2: CD4.5s/反撃42）',
  },
  {
    id: 'mob_magnet',
    branch: 'mobility',
    tier: 1,
    name: '磁力回収フレーム',
    requires: null,
    description: '吸引範囲＆回復オーブ強化（Lv4: 回復+50% / Lv5: 吸引+160% & 回復+75%）',
  },
  {
    id: 'mob_loot',
    branch: 'mobility',
    tier: 2,
    name: 'トレジャー解析',
    requires: 'mob_magnet',
    description: '装備ドロップ品質＆ドロップ率UP + 宝箱・EXP強化（サブ装備固めの要）',
  },
  {
    id: 'mob_dash',
    branch: 'mobility',
    tier: 3,
    name: '緊急回避ブースト',
    requires: 'mob_loot',
    description: '被弾時にチャージ消費で無敵延長＆2.5s移動加速（Lv1: 1回/1.30s/+24% → Lv2: 2回/1.60s/+38%）',
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
const ARM_MAIN_EXTRA_SHOTS = [0, 1, 1, 2, 2, 3] as const;
const ARM_MAIN_PARALLEL_DMG_PCT = [0, 0, 0.08, 0.08, 0.16, 0.25] as const;
const ARM_MAIN_HOMING_SHOTS = [0, 1, 1, 2, 2, 3] as const;
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
      return dmgPct > 0
        ? `平行 +${ARM_MAIN_EXTRA_SHOTS[lv]}発 / 威力 +${dmgPct}% / 誘導弾${homing}発`
        : `平行 +${ARM_MAIN_EXTRA_SHOTS[lv]}発 / 誘導弾${homing}発`;
    }
    case 'arm_overclock':
      return `CD -${Math.round(ARM_MAIN_CD_REDUCTION[lv] * 100)}% / 弾速+${ARM_MAIN_SPEED_BONUS[lv]} / ${lv >= 2 ? '5本貫通レーザー強化' : '最低3本貫通レーザー'}`;
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
