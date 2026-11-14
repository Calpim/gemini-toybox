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
export const SKILL_PREREQ_LEVEL = 3;

export type SkillLevelMap = Partial<Record<SkillNodeId, number>>;

export interface SkillNodeDef {
  id: SkillNodeId;
  branch: SkillBranch;
  tier: 1 | 2 | 3;
  name: string;
  requires: SkillNodeId | null;
  description: string;
}

/**
 * Required SP to upgrade from `currentLevel` to `currentLevel + 1`:
 * Lv0->1: 1, Lv1->2: 1, Lv2->3: 1, Lv3->4: 2, Lv4->5: 3
 */
export function getSkillUpgradeCost(currentLevel: number): number {
  if (currentLevel >= MAX_SKILL_LEVEL) return Infinity;
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
    description: '全攻撃ダメージ強化（Lv1〜3: +8%/Lv → Lv4: +42% / Lv5: +68%）',
  },
  {
    id: 'arm_parallel',
    branch: 'arms',
    tier: 2,
    name: 'ビット並列制御',
    requires: 'arm_base',
    description: 'ビット・ドローン展開数増 & 威力UP（Lv4〜5で展開+3/+4 & 威力大幅増）',
  },
  {
    id: 'arm_overclock',
    branch: 'arms',
    tier: 3,
    name: 'オーバークロック',
    requires: 'arm_parallel',
    description: 'CD短縮 & 弾速UP + ドローン貫通（Lv4: CD-28% / Lv5: CD-40%）',
  },
  {
    id: 'def_sensor',
    branch: 'defense',
    tier: 1,
    name: '広域索敵',
    requires: null,
    description: '迎撃レンジ拡大（Lv1〜3: +8%/Lv → Lv4: +38% / Lv5: +55%、上限180px）',
  },
  {
    id: 'def_pulse',
    branch: 'defense',
    tier: 2,
    name: '電磁リパルサー',
    requires: 'def_sensor',
    description: '接近敵を周期ノックバック（Lv4〜5で高威力・高回転＆広範囲）',
  },
  {
    id: 'def_aegis',
    branch: 'defense',
    tier: 3,
    name: 'オートパリィ盾',
    requires: 'def_pulse',
    description: '被弾無効パリィ＋反射（Lv4〜5で高反射・短CD）',
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
    id: 'mob_dash',
    branch: 'mobility',
    tier: 2,
    name: '戦術ステップ',
    requires: 'mob_magnet',
    description: '被弾時の無敵延長＆回避距離（Lv4〜5で大幅延長＆CD半減級）',
  },
  {
    id: 'mob_loot',
    branch: 'mobility',
    tier: 3,
    name: 'トレジャー解析',
    requires: 'mob_dash',
    description: '宝箱・装備ドロップ・EXP強化（Lv4: EXP+42% / Lv5: EXP+68% & 希少率UP）',
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
  return Math.max(0, Math.min(MAX_SKILL_LEVEL, levels[nodeId] ?? 0));
}

export function canUpgradeSkill(
  levels: SkillLevelMap,
  skillPoints: number,
  nodeId: SkillNodeId
): boolean {
  const currLevel = getSkillLevel(levels, nodeId);
  if (currLevel >= MAX_SKILL_LEVEL) return false;
  const node = getSkillNode(nodeId);
  const cost = getSkillUpgradeCost(currLevel);
  if (skillPoints < cost) return false;
  if (node.requires === null) return true;
  return getSkillLevel(levels, node.requires) >= SKILL_PREREQ_LEVEL;
}

export const canUnlockSkill = canUpgradeSkill;

// Per-level scaling curves [Lv0, Lv1, Lv2, Lv3, Lv4, Lv5] with sharp Lv4 & Lv5 breakthroughs
const ARM_DAMAGE_PCT = [0, 0.08, 0.16, 0.24, 0.42, 0.68] as const;
const ARM_EXTRA_BITS = [0, 1, 1, 2, 3, 4] as const;
const ARM_BIT_DMG_PCT = [0, 0.06, 0.12, 0.18, 0.32, 0.52] as const;
const ARM_CD_REDUCTION = [0, 0.06, 0.12, 0.18, 0.28, 0.4] as const;
const ARM_DRONE_SPEED = [0, 20, 40, 60, 100, 150] as const;

const DEF_RANGE_PCT = [0, 0.08, 0.16, 0.24, 0.38, 0.55] as const;
const DEF_PULSE_DMG = [0, 12, 16, 20, 32, 48] as const;
const DEF_PULSE_CD = [0, 3.8, 3.5, 3.2, 2.5, 1.8] as const;
const DEF_PULSE_RANGE = [0, 105, 112, 120, 138, 160] as const;
const DEF_AEGIS_DMG = [0, 24, 32, 40, 64, 96] as const;
const DEF_AEGIS_CD = [0, 6.4, 5.8, 5.2, 4.0, 2.8] as const;

const MOB_MAGNET_PCT = [0, 0.22, 0.44, 0.66, 1.05, 1.6] as const;
const MOB_HEAL_PCT = [0, 0.1, 0.2, 0.3, 0.5, 0.75] as const;
const MOB_DASH_INVULN = [0.55, 0.85, 0.95, 1.05, 1.3, 1.65] as const;
const MOB_DASH_DIST = [0, 40, 46, 52, 66, 84] as const;
const MOB_DASH_CD = [0, 6.4, 5.8, 5.2, 4.0, 2.8] as const;
const MOB_LOOT_PCT = [0, 0.08, 0.16, 0.24, 0.4, 0.6] as const;
const MOB_DROP_BONUS = [0, 0.002, 0.004, 0.006, 0.011, 0.018] as const;
const MOB_EXP_PCT = [0, 0.08, 0.16, 0.24, 0.42, 0.68] as const;

export interface ComputedSkillModifiers {
  totalSkillLevels: number;
  damageMult: number;
  extraBits: number;
  bitDroneDamageMult: number;
  cooldownMult: number;
  piercingDrones: boolean;
  droneSpeedBonus: number;
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
  hasTacticalStep: boolean;
  tacticalInvulnDuration: number;
  tacticalStepDist: number;
  tacticalStepCooldown: number;
  lootBonusRate: number;
  equipDropBonus: number;
  expMult: number;
}

export function computeSkillModifiers(levels: SkillLevelMap): ComputedSkillModifiers {
  const armBaseLv = getSkillLevel(levels, 'arm_base');
  const armParallelLv = getSkillLevel(levels, 'arm_parallel');
  const armOverclockLv = getSkillLevel(levels, 'arm_overclock');
  const defSensorLv = getSkillLevel(levels, 'def_sensor');
  const defPulseLv = getSkillLevel(levels, 'def_pulse');
  const defAegisLv = getSkillLevel(levels, 'def_aegis');
  const mobMagnetLv = getSkillLevel(levels, 'mob_magnet');
  const mobDashLv = getSkillLevel(levels, 'mob_dash');
  const mobLootLv = getSkillLevel(levels, 'mob_loot');

  const totalSkillLevels =
    armBaseLv +
    armParallelLv +
    armOverclockLv +
    defSensorLv +
    defPulseLv +
    defAegisLv +
    mobMagnetLv +
    mobDashLv +
    mobLootLv;

  return {
    totalSkillLevels,
    damageMult: 1 + ARM_DAMAGE_PCT[armBaseLv],
    extraBits: ARM_EXTRA_BITS[armParallelLv],
    bitDroneDamageMult: 1 + ARM_BIT_DMG_PCT[armParallelLv],
    cooldownMult: Math.max(0.55, 1 - ARM_CD_REDUCTION[armOverclockLv]),
    piercingDrones: armOverclockLv >= 1,
    droneSpeedBonus: ARM_DRONE_SPEED[armOverclockLv],
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
    hasTacticalStep: mobDashLv >= 1,
    tacticalInvulnDuration: MOB_DASH_INVULN[mobDashLv],
    tacticalStepDist: MOB_DASH_DIST[mobDashLv],
    tacticalStepCooldown: MOB_DASH_CD[mobDashLv],
    lootBonusRate: MOB_LOOT_PCT[mobLootLv],
    equipDropBonus: MOB_DROP_BONUS[mobLootLv],
    expMult: 1 + MOB_EXP_PCT[mobLootLv],
  };
}

export function getSkillEffectSummary(nodeId: SkillNodeId, level: number): string {
  const lv = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
  if (lv <= 0) return '未習得';
  switch (nodeId) {
    case 'arm_base':
      return `全攻撃 +${Math.round(ARM_DAMAGE_PCT[lv] * 100)}%`;
    case 'arm_parallel':
      return `展開 +${ARM_EXTRA_BITS[lv]} / 威力 +${Math.round(ARM_BIT_DMG_PCT[lv] * 100)}%`;
    case 'arm_overclock':
      return `CD -${Math.round(ARM_CD_REDUCTION[lv] * 100)}% / 貫通`;
    case 'def_sensor':
      return `レンジ +${Math.round(DEF_RANGE_PCT[lv] * 100)}%`;
    case 'def_pulse':
      return `威力${DEF_PULSE_DMG[lv]} / 範囲${DEF_PULSE_RANGE[lv]} / CD ${DEF_PULSE_CD[lv].toFixed(1)}s`;
    case 'def_aegis':
      return `反撃${DEF_AEGIS_DMG[lv]} / CD ${DEF_AEGIS_CD[lv].toFixed(1)}s`;
    case 'mob_magnet':
      return `吸引 +${Math.round(MOB_MAGNET_PCT[lv] * 100)}% / 回復 +${Math.round(MOB_HEAL_PCT[lv] * 100)}%`;
    case 'mob_dash':
      return `無敵 ${MOB_DASH_INVULN[lv].toFixed(2)}s / 回避${MOB_DASH_DIST[lv]}px`;
    case 'mob_loot':
      return `宝 +${Math.round(MOB_LOOT_PCT[lv] * 100)}% / EXP +${Math.round(MOB_EXP_PCT[lv] * 100)}%`;
  }
}
