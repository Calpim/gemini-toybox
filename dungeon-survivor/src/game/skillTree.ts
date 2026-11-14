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
  cost: number;
  name: string;
  requires: SkillNodeId | null;
  description: string;
}

export const SKILL_TREE_NODES: readonly SkillNodeDef[] = [
  {
    id: 'arm_base',
    branch: 'arms',
    tier: 1,
    cost: 1,
    name: '出力強化',
    requires: null,
    description: 'Lv毎に全自動攻撃ダメージ +10%（最大+50%）',
  },
  {
    id: 'arm_parallel',
    branch: 'arms',
    tier: 2,
    cost: 2,
    name: 'ビット並列制御',
    requires: 'arm_base',
    description: 'Lv1/3/5でビット・ドローン展開数+1 & 威力+6%/Lv',
  },
  {
    id: 'arm_overclock',
    branch: 'arms',
    tier: 3,
    cost: 3,
    name: 'オーバークロック',
    requires: 'arm_parallel',
    description: 'Lv毎にCD-7% & 弾速UP（Lv1以上でドローン貫通）',
  },
  {
    id: 'def_sensor',
    branch: 'defense',
    tier: 1,
    cost: 1,
    name: '広域索敵',
    requires: null,
    description: 'Lv毎に迎撃レンジ +10%（部屋・通路上限180px内）',
  },
  {
    id: 'def_pulse',
    branch: 'defense',
    tier: 2,
    cost: 2,
    name: '電磁リパルサー',
    requires: 'def_sensor',
    description: '接近敵を周期ノックバック（Lv毎に威力UP・CD短縮）',
  },
  {
    id: 'def_aegis',
    branch: 'defense',
    tier: 3,
    cost: 3,
    name: 'オートパリィ盾',
    requires: 'def_pulse',
    description: '被弾無効パリィ＋反射（Lv毎にCD短縮・反撃強化）',
  },
  {
    id: 'mob_magnet',
    branch: 'mobility',
    tier: 1,
    cost: 1,
    name: '磁力回収フレーム',
    requires: null,
    description: 'Lv毎に吸引範囲 +25% & 回復オーブ効果 +12%',
  },
  {
    id: 'mob_dash',
    branch: 'mobility',
    tier: 2,
    cost: 2,
    name: '戦術ステップ',
    requires: 'mob_magnet',
    description: '被弾時の無敵延長＆回避（Lv毎に距離・無敵延長）',
  },
  {
    id: 'mob_loot',
    branch: 'mobility',
    tier: 3,
    cost: 3,
    name: 'トレジャー解析',
    requires: 'mob_dash',
    description: 'Lv毎に宝箱・回復率+10% / 装備ドロップ補正 / EXP+10%',
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
  if (skillPoints < node.cost) return false;
  if (node.requires === null) return true;
  return getSkillLevel(levels, node.requires) >= SKILL_PREREQ_LEVEL;
}

export const canUnlockSkill = canUpgradeSkill;

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
    damageMult: 1 + armBaseLv * 0.1,
    extraBits: armParallelLv === 0 ? 0 : Math.ceil(armParallelLv / 2),
    bitDroneDamageMult: 1 + armParallelLv * 0.06,
    cooldownMult: Math.max(0.65, 1 - armOverclockLv * 0.07),
    piercingDrones: armOverclockLv >= 1,
    droneSpeedBonus: armOverclockLv * 22,
    rangeMult: 1 + defSensorLv * 0.1,
    hasRepulsor: defPulseLv >= 1,
    repulsorDamage: 8 + defPulseLv * 4,
    repulsorCooldown: Math.max(2.0, 4.0 - defPulseLv * 0.35),
    repulsorRange: 100 + defPulseLv * 8,
    hasAegisParry: defAegisLv >= 1,
    aegisCooldown: Math.max(3.0, 7.0 - defAegisLv * 0.7),
    aegisDamage: 18 + defAegisLv * 8,
    pickupMagnetMult: 1 + mobMagnetLv * 0.25,
    healBonusMult: 1 + mobMagnetLv * 0.12,
    hasTacticalStep: mobDashLv >= 1,
    tacticalInvulnDuration: 0.75 + mobDashLv * 0.12,
    tacticalStepDist: 36 + mobDashLv * 6,
    tacticalStepCooldown: Math.max(3.0, 7.0 - mobDashLv * 0.7),
    lootBonusRate: mobLootLv * 0.1,
    equipDropBonus: mobLootLv * 0.003,
    expMult: 1 + mobLootLv * 0.1,
  };
}

export function getSkillEffectSummary(nodeId: SkillNodeId, level: number): string {
  if (level <= 0) return '未習得';
  switch (nodeId) {
    case 'arm_base':
      return `全攻撃 +${level * 10}%`;
    case 'arm_parallel':
      return `展開 +${Math.ceil(level / 2)} / 威力 +${level * 6}%`;
    case 'arm_overclock':
      return `CD -${level * 7}% / 貫通`;
    case 'def_sensor':
      return `レンジ +${level * 10}%`;
    case 'def_pulse':
      return `威力${8 + level * 4} / CD ${(4.0 - level * 0.35).toFixed(2)}s`;
    case 'def_aegis':
      return `反撃${18 + level * 8} / CD ${(7.0 - level * 0.7).toFixed(1)}s`;
    case 'mob_magnet':
      return `吸引 +${level * 25}% / 回復 +${level * 12}%`;
    case 'mob_dash':
      return `無敵 ${(0.75 + level * 0.12).toFixed(2)}s / 回避${36 + level * 6}px`;
    case 'mob_loot':
      return `宝 +${level * 10}% / EXP +${level * 10}%`;
  }
}
