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

export const MAX_EQUIP_SLOTS = 2;
export const MAX_EQUIP_SLOTS_CAP = 5;
export const SCRAP_EXPAND_COST = 3;
export const MAX_TARGET_RANGE = 180;
export const MAX_EQUIPMENT_LEVEL = 10;
export const MAX_EQUIPMENT_COUNT_EVO_LEVEL = 6;
export const ORBIT_SHIELD_INNER_SLOW = 0.72;

export function clampEquipmentLevel(level: number): number {
  return Math.max(1, Math.min(MAX_EQUIPMENT_LEVEL, Math.floor(level)));
}

export const EQUIPMENT_CATALOG: Record<EquipmentId, EquipmentDef> = {
  pulse_blade: {
    id: 'pulse_blade',
    name: 'パルスブレード',
    category: '近接迎撃',
    color: '#22d3ee',
    baseCooldown: 0.88,
    baseRange: 84,
    baseDamage: 25,
    description: '敵方向への扇形高火力斬撃。Lv6まで扇角拡大、Lv7〜10は威力・射程・CD強化',
  },
  orbit_shield: {
    id: 'orbit_shield',
    name: '公転シールドビット',
    category: '公転ビット',
    color: '#a78bfa',
    baseCooldown: 0,
    baseRange: 78,
    baseDamage: 15,
    description: '範囲内敵をスロー化＋弾消し公転ビット。少ビット時は高速回転、Lv6で6個完成後は範囲・威力強化',
  },
  seeker_drone: {
    id: 'seeker_drone',
    name: '自律追尾ドローン',
    category: '自律ドローン',
    color: '#38bdf8',
    baseCooldown: 0.48,
    baseRange: 155,
    baseDamage: 15,
    description: 'Lv6まで展開数増加（最大4機）、Lv7〜10は射程・威力・CD・弾速を強化',
  },
  reactive_coil: {
    id: 'reactive_coil',
    name: '迎撃サンダーコイル',
    category: 'カウンター',
    color: '#f472b6',
    baseCooldown: 1.45,
    baseRange: 78,
    baseDamage: 18,
    description: 'Lv6まで連鎖数増加（最大8連鎖）、Lv7〜10は放電レンジ・威力・CD強化',
  },
  ricochet_disc: {
    id: 'ricochet_disc',
    name: '跳弾チャクラム',
    category: '跳弾投擲',
    color: '#fb923c',
    baseCooldown: 1.12,
    baseRange: 145,
    baseDamage: 17,
    description: '敵を跳ね回る回転刃。Lv3で2枚/Lv6で3枚・最大7回跳弾、Lv7〜10は威力・射程・CD強化',
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
    level: clampEquipmentLevel(level),
    cooldown: 0,
  };
}

export function getEquipmentDamage(item: EquippedItem, damageMult: number): number {
  const def = EQUIPMENT_CATALOG[item.id];
  const lv = clampEquipmentLevel(item.level);
  return def.baseDamage * (1 + (lv - 1) * 0.25) * damageMult;
}

export function getEquipmentCooldownMultiplier(level: number): number {
  const lv = clampEquipmentLevel(level);
  return Math.max(0.55, 1 - (lv - 1) * 0.05);
}

export function getOrbitBitCount(level: number, extraBits = 0): number {
  const evoLv = Math.min(MAX_EQUIPMENT_COUNT_EVO_LEVEL, clampEquipmentLevel(level));
  return Math.min(6, evoLv) + extraBits;
}

export function getOrbitShieldRadius(level: number, rangeMult = 1): number {
  const lv = clampEquipmentLevel(level);
  const raw = 78 + (Math.min(6, lv) - 1) * 2 + Math.max(0, lv - 6) * 4;
  return Math.min(MAX_TARGET_RANGE * 0.68, raw * rangeMult);
}

export function getOrbitShieldAngularSpeed(bitCount: number): number {
  return Math.max(1.6, Math.min(5.2, 5.0 / Math.pow(Math.max(1, bitCount), 0.55)));
}

export function getSeekerDroneCount(level: number, extraBits = 0): number {
  const evoLv = Math.min(MAX_EQUIPMENT_COUNT_EVO_LEVEL, clampEquipmentLevel(level));
  return Math.min(4, 1 + Math.floor(evoLv / 2)) + extraBits;
}

export function getSeekerDroneRange(
  level: number,
  baseRange = EQUIPMENT_CATALOG.seeker_drone.baseRange,
  rangeMult = 1
): number {
  const lv = clampEquipmentLevel(level);
  return (baseRange + Math.max(0, lv - 6) * 8) * rangeMult;
}

export function getPulseBladeStats(
  level: number,
  baseRange: number,
  rangeMult: number
): { range: number; halfArcRad: number; fullCircle: boolean } {
  const lv = clampEquipmentLevel(level);
  const evoLv = Math.min(MAX_EQUIPMENT_COUNT_EVO_LEVEL, lv);
  const halfArcRad = 1.15 + (evoLv - 1) * 0.1;
  return {
    range: (baseRange + (Math.min(6, lv) - 1) * 10 + Math.max(0, lv - 6) * 14) * rangeMult,
    halfArcRad,
    fullCircle: false,
  };
}

export function getReactiveCoilStats(
  level: number,
  baseRange: number,
  rangeMult: number
): { range: number; maxTargets: number } {
  const lv = clampEquipmentLevel(level);
  const evoLv = Math.min(MAX_EQUIPMENT_COUNT_EVO_LEVEL, lv);
  return {
    range: (baseRange + (Math.min(6, lv) - 1) * 12 + Math.max(0, lv - 6) * 16) * rangeMult,
    maxTargets: 2 + evoLv,
  };
}

export function getRicochetDiscStats(
  level: number,
  rangeMult = 1
): {
  count: number;
  maxBounces: number;
  speed: number;
  range: number;
} {
  const lv = clampEquipmentLevel(level);
  const evoLv = Math.min(MAX_EQUIPMENT_COUNT_EVO_LEVEL, lv);
  return {
    count: evoLv >= 6 ? 3 : evoLv >= 3 ? 2 : 1,
    maxBounces: 1 + evoLv,
    speed: 390 + (lv - 1) * 20,
    range: (EQUIPMENT_CATALOG.ricochet_disc.baseRange + Math.max(0, lv - 6) * 8) * rangeMult,
  };
}

export function getEquipmentEvolutionSummary(id: EquipmentId, level: number): string {
  const lv = clampEquipmentLevel(level);
  switch (id) {
    case 'orbit_shield': {
      const bits = getOrbitBitCount(lv);
      const radius = Math.round(getOrbitShieldRadius(lv, 1));
      return `${bits}個 / 半径${radius}px / 減速`;
    }
    case 'pulse_blade': {
      const s = getPulseBladeStats(lv, EQUIPMENT_CATALOG.pulse_blade.baseRange, 1);
      const deg = Math.round((s.halfArcRad * 2 * 180) / Math.PI);
      return `扇${deg}° / 射程${Math.round(Math.min(MAX_TARGET_RANGE, s.range))}px`;
    }
    case 'seeker_drone':
      return `${getSeekerDroneCount(lv)}機 / 射程${Math.round(Math.min(MAX_TARGET_RANGE, getSeekerDroneRange(lv)))}px`;
    case 'reactive_coil': {
      const c = getReactiveCoilStats(lv, EQUIPMENT_CATALOG.reactive_coil.baseRange, 1);
      return `連鎖${c.maxTargets}体 / ${Math.round(Math.min(MAX_TARGET_RANGE, c.range))}px`;
    }
    case 'ricochet_disc': {
      const d = getRicochetDiscStats(lv);
      return `${d.count}枚 / 跳弾${d.maxBounces}回`;
    }
  }
}
