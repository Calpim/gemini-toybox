export type EquipmentId =
  | 'pulse_blade'
  | 'orbit_shield'
  | 'seeker_drone'
  | 'reactive_coil'
  | 'ricochet_disc';

export type EquipmentCategory = '近接迎撃' | '公転ビット' | '自律ドローン' | 'カウンター' | '跳弾投擲';

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  category: EquipmentCategory;
  color: string;
  baseCooldown: number;
  baseRange: number;
  baseDamage: number;
  description: string;
}

export interface EquippedItem {
  id: EquipmentId;
  level: number;
  cooldown: number;
}

export const MAX_EQUIP_SLOTS = 3;
export const MAX_TARGET_RANGE = 180;

export const EQUIPMENT_CATALOG: Record<EquipmentId, EquipmentDef> = {
  pulse_blade: {
    id: 'pulse_blade',
    name: 'パルスブレード',
    category: '近接迎撃',
    color: '#22d3ee',
    baseCooldown: 1.05,
    baseRange: 78,
    baseDamage: 22,
    description: 'Lvで斬撃範囲拡大・Lv3以上で360°全方位斬撃へ進化',
  },
  orbit_shield: {
    id: 'orbit_shield',
    name: '公転シールドビット',
    category: '公転ビット',
    color: '#a78bfa',
    baseCooldown: 0,
    baseRange: 64,
    baseDamage: 14,
    description: 'Lvごとに公転ビット数が増加し、接触撃破＋敵弾消去',
  },
  seeker_drone: {
    id: 'seeker_drone',
    name: '自律追尾ドローン',
    category: '自律ドローン',
    color: '#38bdf8',
    baseCooldown: 0.48,
    baseRange: 155,
    baseDamage: 15,
    description: 'Lvでドローン展開数＆弾速が強化される自動追尾射撃',
  },
  reactive_coil: {
    id: 'reactive_coil',
    name: '迎撃サンダーコイル',
    category: 'カウンター',
    color: '#f472b6',
    baseCooldown: 1.5,
    baseRange: 74,
    baseDamage: 18,
    description: 'Lvごとに連鎖数＋1・放電範囲が拡大する電撃カウンター',
  },
  ricochet_disc: {
    id: 'ricochet_disc',
    name: '跳弾チャクラム',
    category: '跳弾投擲',
    color: '#fb923c',
    baseCooldown: 1.15,
    baseRange: 145,
    baseDamage: 17,
    description: '敵の間を跳ね回る回転刃。Lvで跳弾回数増・Lv3で2枚投擲',
  },
};

export const ALL_EQUIPMENT_IDS: readonly EquipmentId[] = [
  'pulse_blade',
  'orbit_shield',
  'seeker_drone',
  'reactive_coil',
  'ricochet_disc',
];

export function createEquippedItem(id: EquipmentId, level = 1): EquippedItem {
  return {
    id,
    level,
    cooldown: 0,
  };
}

export function getEquipmentDamage(item: EquippedItem, damageMult: number): number {
  const def = EQUIPMENT_CATALOG[item.id];
  return def.baseDamage * (1 + (item.level - 1) * 0.25) * damageMult;
}

export function getEquipmentCooldownMultiplier(level: number): number {
  return Math.max(0.7, 1 - (level - 1) * 0.05);
}

export function getOrbitBitCount(level: number, extraBits = 0): number {
  return Math.min(6, Math.max(1, level)) + extraBits;
}

export function getSeekerDroneCount(level: number, extraBits = 0): number {
  return Math.min(4, 1 + Math.floor(level / 2)) + extraBits;
}

export function getPulseBladeStats(
  level: number,
  baseRange: number,
  rangeMult: number
): { range: number; halfArcRad: number; fullCircle: boolean } {
  const fullCircle = level >= 3;
  const halfArcRad = fullCircle ? Math.PI : level >= 2 ? 1.92 : 1.22;
  return {
    range: (baseRange + (level - 1) * 12) * rangeMult,
    halfArcRad,
    fullCircle,
  };
}

export function getReactiveCoilStats(
  level: number,
  baseRange: number,
  rangeMult: number
): { range: number; maxTargets: number } {
  return {
    range: (baseRange + (level - 1) * 14) * rangeMult,
    maxTargets: 2 + Math.max(1, level),
  };
}

export function getRicochetDiscStats(level: number): {
  count: number;
  maxBounces: number;
  speed: number;
} {
  return {
    count: level >= 3 ? 2 : 1,
    maxBounces: 1 + Math.max(1, level),
    speed: 390 + (level - 1) * 20,
  };
}

export function getEquipmentEvolutionSummary(id: EquipmentId, level: number): string {
  switch (id) {
    case 'orbit_shield':
      return `ビット${getOrbitBitCount(level)}個`;
    case 'pulse_blade': {
      const s = getPulseBladeStats(level, EQUIPMENT_CATALOG.pulse_blade.baseRange, 1);
      return s.fullCircle ? `全方位${Math.round(s.range)}px` : `斬撃${Math.round(s.range)}px`;
    }
    case 'seeker_drone':
      return `ドローン${getSeekerDroneCount(level)}機`;
    case 'reactive_coil':
      return `連鎖${getReactiveCoilStats(level, EQUIPMENT_CATALOG.reactive_coil.baseRange, 1).maxTargets}体`;
    case 'ricochet_disc': {
      const d = getRicochetDiscStats(level);
      return `${d.count}枚/跳弾${d.maxBounces}回`;
    }
  }
}
