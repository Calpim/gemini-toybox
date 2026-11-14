export type SkillBranch = 'arms' | 'defense' | 'mobility';

export type SkillNodeId =
  | 'arm_base'
  | 'arm_parallel'
  | 'arm_overclock'
  | 'def_sensor'
  | 'def_pulse'
  | 'def_aegis'
  | 'mob_speed'
  | 'mob_dash'
  | 'mob_loot';

export interface SkillNodeDef {
  id: SkillNodeId;
  branch: SkillBranch;
  tier: 1 | 2 | 3;
  name: string;
  requires: SkillNodeId | null;
  description: string;
}

export const SKILL_TREE_NODES: readonly SkillNodeDef[] = [
  {
    id: 'arm_base',
    branch: 'arms',
    tier: 1,
    name: '出力強化',
    requires: null,
    description: '全自動攻撃ダメージ +15%',
  },
  {
    id: 'arm_parallel',
    branch: 'arms',
    tier: 2,
    name: 'ビット並列制御',
    requires: 'arm_base',
    description: '公転ビット・自律ドローン展開数 +1',
  },
  {
    id: 'arm_overclock',
    branch: 'arms',
    tier: 3,
    name: 'オーバークロック',
    requires: 'arm_parallel',
    description: '全装備クールダウン -20% & ドローン弾貫通化',
  },
  {
    id: 'def_sensor',
    branch: 'defense',
    tier: 1,
    name: '広域索敵',
    requires: null,
    description: '全迎撃レンジ +20%',
  },
  {
    id: 'def_pulse',
    branch: 'defense',
    tier: 2,
    name: '電磁リパルサー',
    requires: 'def_sensor',
    description: '周期的に接近敵をノックバック＋放電ダメージ',
  },
  {
    id: 'def_aegis',
    branch: 'defense',
    tier: 3,
    name: 'オートパリィ盾',
    requires: 'def_pulse',
    description: '6秒ごとに被弾を1回無効化し周囲へ反射衝撃',
  },
  {
    id: 'mob_speed',
    branch: 'mobility',
    tier: 1,
    name: '軽量化フレーム',
    requires: null,
    description: '移動速度 +12% & アイテム吸引範囲 +35%',
  },
  {
    id: 'mob_dash',
    branch: 'mobility',
    tier: 2,
    name: '戦術ステップ',
    requires: 'mob_speed',
    description: '被弾時の無敵時間を延長＋緊急回避加速',
  },
  {
    id: 'mob_loot',
    branch: 'mobility',
    tier: 3,
    name: 'トレジャー解析',
    requires: 'mob_dash',
    description: '回復アイテム・宝箱の出現率 +25%',
  },
] as const;

export function getSkillNode(id: SkillNodeId): SkillNodeDef {
  const found = SKILL_TREE_NODES.find((n) => n.id === id);
  if (!found) {
    throw new Error(`Unknown skill node: ${id}`);
  }
  return found;
}

export function canUnlockSkill(
  unlocked: ReadonlySet<SkillNodeId>,
  skillPoints: number,
  nodeId: SkillNodeId
): boolean {
  if (skillPoints < 1 || unlocked.has(nodeId)) return false;
  const node = getSkillNode(nodeId);
  if (node.requires === null) return true;
  return unlocked.has(node.requires);
}

export interface ComputedSkillModifiers {
  damageMult: number;
  extraBits: number;
  cooldownMult: number;
  piercingDrones: boolean;
  rangeMult: number;
  hasRepulsor: boolean;
  hasAegisParry: boolean;
  moveSpeedMult: number;
  pickupMagnetMult: number;
  hasTacticalStep: boolean;
  lootBonusRate: number;
}

export function computeSkillModifiers(unlocked: ReadonlySet<SkillNodeId>): ComputedSkillModifiers {
  return {
    damageMult: unlocked.has('arm_base') ? 1.15 : 1.0,
    extraBits: unlocked.has('arm_parallel') ? 1 : 0,
    cooldownMult: unlocked.has('arm_overclock') ? 0.8 : 1.0,
    piercingDrones: unlocked.has('arm_overclock'),
    rangeMult: unlocked.has('def_sensor') ? 1.2 : 1.0,
    hasRepulsor: unlocked.has('def_pulse'),
    hasAegisParry: unlocked.has('def_aegis'),
    moveSpeedMult: unlocked.has('mob_speed') ? 1.12 : 1.0,
    pickupMagnetMult: unlocked.has('mob_speed') ? 1.35 : 1.0,
    hasTacticalStep: unlocked.has('mob_dash'),
    lootBonusRate: unlocked.has('mob_loot') ? 0.25 : 0,
  };
}
