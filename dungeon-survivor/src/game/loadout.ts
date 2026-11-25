import { createRng } from '../core/rng';
import {
  ALL_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  type EquipmentId,
  type EquippedItem,
  MAX_EQUIPMENT_LEVEL,
  MAX_EQUIP_SLOTS_CAP,
  MAX_TARGET_RANGE,
  clampEquipmentLevel,
  getOrbitBitCount,
  getOrbitShieldRadius,
  getScrapExpandCost,
  getSeekerDroneCount,
} from './equipment';
import { grantExpAndCheckLevelUp } from './leveling';
import { computeSkillModifiers } from './skillTree';
import type { GameState, MainWeaponId, PlayerState, Vec2 } from './types';

function applyScrapExpandStep(state: GameState, sourceLabel: string): void {
  const { player } = state;
  const cost = getScrapExpandCost(player.maxEquipSlots);
  player.scrapExpandProgress += 1;
  if (player.scrapExpandProgress >= cost) {
    player.scrapExpandProgress -= cost;
    player.maxEquipSlots = Math.min(MAX_EQUIP_SLOTS_CAP, player.maxEquipSlots + 1);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `${sourceLabel} → SLOT EXPANDED! (${player.maxEquipSlots}/${MAX_EQUIP_SLOTS_CAP})`,
      color: '#34d399',
      life: 1.4,
      maxLife: 1.4,
    });
  } else {
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `${sourceLabel} (${player.scrapExpandProgress}/${cost})`,
      color: '#fbbf24',
      life: 1.25,
      maxLife: 1.25,
    });
  }
}

export function acquireEquipment(state: GameState, droppedItem: EquippedItem): void {
  const { player } = state;
  const { equipment } = player;
  const clampedLevel = clampEquipmentLevel(droppedItem.level);
  const normalizedItem: EquippedItem = { ...droppedItem, level: clampedLevel };
  const existing = equipment.find((eq) => eq.id === normalizedItem.id);
  if (existing) {
    if (existing.level >= MAX_EQUIPMENT_LEVEL) {
      if (player.maxEquipSlots < MAX_EQUIP_SLOTS_CAP) {
        applyScrapExpandStep(state, 'MAX LV → EXPAND');
        return;
      }
      player.hp = Math.min(player.maxHp, player.hp + 20);
      grantExpAndCheckLevelUp(state, 25);
      state.floatingTexts.push({
        x: player.x,
        y: player.y - 26,
        text: 'MAX LV BONUS! (+20HP/+25EXP)',
        color: '#fbbf24',
        life: 1.25,
        maxLife: 1.25,
      });
      return;
    }
    if (normalizedItem.level >= existing.level + 2) {
      state.pendingEquipDrop = { item: normalizedItem };
      state.status = 'equip_choice';
      return;
    }
    existing.level = clampEquipmentLevel(existing.level + 1);
    const def = EQUIPMENT_CATALOG[existing.id];
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `LV UP! ${def.name} Lv${existing.level}`,
      color: def.color,
      life: 1.25,
      maxLife: 1.25,
    });
    return;
  }

  if (equipment.length < player.maxEquipSlots) {
    equipment.push(normalizedItem);
    const def = EQUIPMENT_CATALOG[normalizedItem.id];
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `+GEAR: ${def.name} Lv${normalizedItem.level}`,
      color: def.color,
      life: 1.2,
      maxLife: 1.2,
    });
    return;
  }

  if (player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP && equipment.every((eq) => eq.level >= MAX_EQUIPMENT_LEVEL)) {
    player.hp = Math.min(player.maxHp, player.hp + 30);
    grantExpAndCheckLevelUp(state, 40);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: 'ALL GEAR MAX! (+30HP/+40EXP)',
      color: '#fbbf24',
      life: 1.3,
      maxLife: 1.3,
    });
    return;
  }

  state.pendingEquipDrop = { item: normalizedItem };
  state.status = 'equip_choice';
}

export type EquipChoice =
  | { type: 'replace'; slotIndex: number }
  | { type: 'scrap_upgrade'; slotIndex: number }
  | { type: 'scrap_expand' };

export function resolveEquipChoice(state: GameState, choice: EquipChoice): boolean {
  if (state.status !== 'equip_choice' || !state.pendingEquipDrop) {
    return false;
  }

  const dropped = state.pendingEquipDrop.item;
  if (choice.type === 'replace') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    if (state.player.equipment.some((eq, idx) => idx !== choice.slotIndex && eq.id === dropped.id)) {
      return false;
    }
    state.player.equipment[choice.slotIndex] = {
      ...dropped,
      level: clampEquipmentLevel(dropped.level),
      cooldown: 0,
    };
    const def = EQUIPMENT_CATALOG[dropped.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `EQUIPPED: ${def.name} Lv${dropped.level}`,
      color: def.color,
      life: 1.1,
      maxLife: 1.1,
    });
  } else if (choice.type === 'scrap_upgrade') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    const target = state.player.equipment[choice.slotIndex];
    if (target.level >= MAX_EQUIPMENT_LEVEL) {
      return false;
    }
    target.level = clampEquipmentLevel(target.level + 1);
    const def = EQUIPMENT_CATALOG[target.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `SCRAP UP! ${def.name} Lv${target.level}`,
      color: '#fbbf24',
      life: 1.2,
      maxLife: 1.2,
    });
  } else {
    if (state.player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP) {
      return false;
    }
    applyScrapExpandStep(state, 'SCRAP BUILD');
  }

  state.pendingEquipDrop = null;
  state.status = 'playing';
  return true;
}

export function getOrbitBitPositions(state: GameState): Vec2[] {
  const { player } = state;
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  if (!orbitItem) return [];

  const mods = computeSkillModifiers(player.skillLevels);
  const count = getOrbitBitCount(orbitItem.level);
  const radius = getOrbitShieldRadius(orbitItem.level, mods.rangeMult);

  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = player.orbitAngle + (i * Math.PI * 2) / count;
    positions.push({
      x: player.x + Math.cos(a) * radius,
      y: player.y + Math.sin(a) * radius,
    });
  }
  return positions;
}

export function getSeekerDronePositions(state: GameState): Vec2[] {
  const { player } = state;
  const droneItem = player.equipment.find((e) => e.id === 'seeker_drone');
  if (!droneItem) return [];

  const count = getSeekerDroneCount(droneItem.level);
  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = -player.orbitAngle * 1.4 + (i * Math.PI * 2) / count;
    positions.push({
      x: player.x + Math.cos(a) * 28,
      y: player.y + Math.sin(a) * 28,
    });
  }
  return positions;
}

export function rollDropEquipmentLevel(
  equipment: readonly EquippedItem[],
  rngNext: () => number,
  dropQualityTier = 0,
): number {
  if (equipment.length === 0) return 1;
  let minLevel = Infinity;
  for (const item of equipment) {
    if (item.level < minLevel) minLevel = item.level;
  }
  const tier = Math.max(0, Math.min(5, dropQualityTier));
  const pMinus1 = Math.max(0, 0.2 - tier * 0.04);
  const pPlus1 = 0.22 + tier * 0.036;
  const pPlus2 = 0.08 + tier * 0.024;
  const pZero = Math.max(0, 1 - pMinus1 - pPlus1 - pPlus2);
  const r = rngNext();
  if (r < pMinus1) return clampEquipmentLevel(minLevel - 1);
  if (r < pMinus1 + pZero) return clampEquipmentLevel(minLevel);
  if (r < pMinus1 + pZero + pPlus1) return clampEquipmentLevel(minLevel + 1);
  return clampEquipmentLevel(minLevel + 2);
}

export function pickChestDrop(state: GameState, chestId: number): { id: EquipmentId; level: number } {
  const rng = createRng((state.seed ^ (state.floor * 4999) ^ (chestId * 3571)) >>> 0);
  const id = rng.pick(ALL_EQUIPMENT_IDS);
  const mods = computeSkillModifiers(state.player.skillLevels);
  const level = rollDropEquipmentLevel(state.player.equipment, () => rng.next(), mods.dropQualityTier);
  return { id, level };
}

export interface PlayerBaseAttackStats {
  weaponId: MainWeaponId;
  damage: number;
  cooldown: number;
  range: number;
  shotCount: number;
  homingShots: number;
  homingDamage: number;
  speed: number;
  pierce: boolean;
  armBaseLevel: number;
  armOverclockLevel: number;
  spentSp: number;
}

export function getPlayerBaseAttackStats(player: PlayerState): PlayerBaseAttackStats {
  const mods = computeSkillModifiers(player.skillLevels);
  const weaponId: MainWeaponId = player.mainWeaponId ?? 'core_shot';
  const baseDamage = 14;
  const baseCooldown = 0.58;
  const baseSpeed = 460;
  const damage = Math.round(baseDamage * mods.mainDamageMult * mods.mainParallelDamageMult);
  const cooldown = Math.max(0.2, baseCooldown * mods.mainCooldownMult);
  const range = Math.min(MAX_TARGET_RANGE, Math.round(MAX_TARGET_RANGE * mods.rangeMult)) + mods.mainRangeBonus;
  const baseShots = 1 + mods.mainExtraShots;
  const shotCount =
    mods.armOverclockLevel >= 2
      ? Math.max(5, baseShots)
      : mods.armOverclockLevel === 1
        ? Math.max(3, baseShots)
        : baseShots;
  const homingShots = mods.mainHomingShots;
  const homingDamage = homingShots > 0 ? Math.max(1, Math.round(damage * 0.35)) : 0;
  const speed = baseSpeed + mods.mainSpeedBonus;
  return {
    weaponId,
    damage,
    cooldown,
    range,
    shotCount,
    homingShots,
    homingDamage,
    speed,
    pierce: mods.piercingMainShot,
    armBaseLevel: mods.armBaseLevel,
    armOverclockLevel: mods.armOverclockLevel,
    spentSp: player.spentSkillPoints,
  };
}

export const getMainWeaponStats = getPlayerBaseAttackStats;
