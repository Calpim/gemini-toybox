export type EquipmentId =
  | 'pulse_blade'
  | 'orbit_shield'
  | 'seeker_drone'
  | 'auto_turret'
  | 'reactive_coil';

export type EquipmentCategory = '近接迎撃' | '公転ビット' | '自律ドローン' | '設置迎撃' | 'カウンター';

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

export const MAX_EQUIP_SLOTS = 5;

export const EQUIPMENT_CATALOG: Record<EquipmentId, EquipmentDef> = {
  pulse_blade: {
    id: 'pulse_blade',
    name: 'パルスブレード',
    category: '近接迎撃',
    color: '#22d3ee',
    baseCooldown: 1.05,
    baseRange: 90,
    baseDamage: 22,
    description: '半径90px以内の敵を自動で薙ぎ払う近接レーザー刃',
  },
  orbit_shield: {
    id: 'orbit_shield',
    name: '公転シールドビット',
    category: '公転ビット',
    color: '#a78bfa',
    baseCooldown: 0,
    baseRange: 64,
    baseDamage: 14,
    description: '周囲64pxを公転し、接触ダメージ＋敵弾を消去',
  },
  seeker_drone: {
    id: 'seeker_drone',
    name: '自律追尾ドローン',
    category: '自律ドローン',
    color: '#38bdf8',
    baseCooldown: 0.48,
    baseRange: 260,
    baseDamage: 15,
    description: '半径260px内の敵へ自動追尾ショットを発射',
  },
  auto_turret: {
    id: 'auto_turret',
    name: 'オートタレット',
    category: '設置迎撃',
    color: '#fbbf24',
    baseCooldown: 5.0,
    baseRange: 210,
    baseDamage: 12,
    description: '5秒ごとに足元へ10秒持続する迎撃砲台を展開',
  },
  reactive_coil: {
    id: 'reactive_coil',
    name: '迎撃サンダーコイル',
    category: 'カウンター',
    color: '#f472b6',
    baseCooldown: 1.5,
    baseRange: 80,
    baseDamage: 18,
    description: '敵が80px以内に接近または被弾時に周囲へ連鎖放電',
  },
};

export const ALL_EQUIPMENT_IDS: readonly EquipmentId[] = [
  'pulse_blade',
  'orbit_shield',
  'seeker_drone',
  'auto_turret',
  'reactive_coil',
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
