import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_CATALOG,
  EquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getOrbitBitCount,
  getSeekerDroneCount,
} from './equipment';
import { getPlayerBaseAttackStats } from './engine';
import { PlayerState } from './types';
import { SkillLevelMap } from './skillTree';

interface BuildPreset {
  name: string;
  playerLevel: number;
  floor: number;
  skills: SkillLevelMap;
  equipment: EquippedItem[];
  mainHitRatio: number; // 平行ショットによる単体ヒット率 (1.0 = 全弾ヒット)
}

function makePlayer(level: number, skills: SkillLevelMap, equipment: EquippedItem[]): PlayerState {
  return {
    x: 0,
    y: 0,
    radius: 13,
    hp: 100,
    maxHp: 100,
    baseSpeed: 210,
    autoRegenPerSec: 0,
    level,
    exp: 0,
    expToNext: 25,
    skillPoints: 0,
    spentSkillPoints: 0,
    skillLevels: skills,
    mainWeaponId: 'core_shot',
    equipment,
    maxEquipSlots: Math.max(2, equipment.length),
    scrapExpandProgress: 0,
    baseAttackCooldown: 0,
    repulsorCooldown: 0,
    aegisCooldown: 0,
    tacticalStepCharges: 0,
    tacticalStepCooldown: 0,
    tacticalSpeedTimer: 0,
    invulnTimer: 0,
    orbitAngle: 0,
    orbitRadius: 78,
    facingAngle: 0,
  };
}

function calcSubEquipmentSingleTargetDps(item: EquippedItem): number {
  const def = EQUIPMENT_CATALOG[item.id];
  const dmg = getEquipmentDamage(item, 1);
  const cdMult = getEquipmentCooldownMultiplier(item.level);
  const cd = def.baseCooldown * cdMult;

  switch (item.id) {
    case 'seeker_drone': {
      const count = getSeekerDroneCount(item.level);
      return (dmg / cd) * count;
    }
    case 'pulse_blade': {
      return dmg / cd;
    }
    case 'reactive_coil': {
      return dmg / cd;
    }
    case 'ricochet_disc': {
      // 単体相手はヒット位置起点1回転による再ヒット込みで平均1.5ヒット相当として試算
      return (dmg * 1.5) / cd;
    }
    case 'orbit_shield': {
      // ビット回転による接触期待値（約1.5ヒット/秒相当）
      const bits = getOrbitBitCount(item.level);
      return dmg * Math.min(2.5, bits * 0.4);
    }
  }
}

function calcEnemyHp(floor: number, playerLevel: number) {
  const baseHp = 26 + (floor - 1) * 9;
  const normal = baseHp;
  const tank = Math.round(baseHp * 2.4);
  const guardian =
    floor % 10 === 3 || floor % 10 === 6 || floor % 10 === 9
      ? Math.round(tank * 2.9 * (1 + Math.max(0, playerLevel - 1) * 0.14))
      : null;
  const grandBoss = floor % 10 === 0 ? Math.round(tank * 6.8 * (1 + Math.max(0, playerLevel - 1) * 0.16)) : null;
  return { normal, tank, guardian, grandBoss };
}

function evaluateBuild(preset: BuildPreset) {
  const player = makePlayer(preset.playerLevel, preset.skills, preset.equipment);
  const mainStats = getPlayerBaseAttackStats(player);

  const mainFullDps = (mainStats.damage * mainStats.shotCount) / mainStats.cooldown;
  const mainRealisticSingleDps =
    (mainStats.damage * Math.max(1, mainStats.shotCount * preset.mainHitRatio)) / mainStats.cooldown;
  const homingDps = (mainStats.homingDamage * mainStats.homingShots) / mainStats.cooldown;

  const subDps = preset.equipment.reduce((sum, item) => sum + calcSubEquipmentSingleTargetDps(item), 0);

  const totalSingleDps = mainRealisticSingleDps + homingDps + subDps;
  const enemyHp = calcEnemyHp(preset.floor, preset.playerLevel);

  return {
    name: preset.name,
    floor: preset.floor,
    lv: preset.playerLevel,
    mainDmg: mainStats.damage,
    shots: mainStats.shotCount,
    homing: mainStats.homingShots,
    cd: Number(mainStats.cooldown.toFixed(2)),
    range: mainStats.range,
    mainFullDps: Number(mainFullDps.toFixed(1)),
    homingDps: Number(homingDps.toFixed(1)),
    mainPlusHomingDps: Number((mainRealisticSingleDps + homingDps).toFixed(1)),
    subDps: Number(subDps.toFixed(1)),
    totalSingleDps: Number(totalSingleDps.toFixed(1)),
    ttkNormal: Number((enemyHp.normal / totalSingleDps).toFixed(2)),
    ttkTank: Number((enemyHp.tank / totalSingleDps).toFixed(2)),
    ttkBoss: enemyHp.grandBoss
      ? Number((enemyHp.grandBoss / totalSingleDps).toFixed(1))
      : enemyHp.guardian
        ? Number((enemyHp.guardian / totalSingleDps).toFixed(1))
        : null,
  };
}

describe('Balance Baseline Report', () => {
  it('prints current DPS and TTK matrix across builds and floors', () => {
    const presets: BuildPreset[] = [
      // 序盤 (1F, Lv1)
      {
        name: '1F 初期状態 (武器なし)',
        playerLevel: 1,
        floor: 1,
        skills: {},
        equipment: [],
        mainHitRatio: 1,
      },
      // 3F 中ボス (Lv6 = 累計6SP / 5SP使用)
      {
        name: '3F 主兵装振り (サブなし)',
        playerLevel: 6,
        floor: 3,
        skills: { arm_base: 3, arm_parallel: 2 },
        equipment: [],
        mainHitRatio: 1.0, // 平行ショットにより単体へ全弾ヒット想定
      },
      {
        name: '3F 機動振り (ドローンLv2+ブレードLv2)',
        playerLevel: 6,
        floor: 3,
        skills: { mob_magnet: 3, mob_loot: 2 },
        equipment: [
          { id: 'seeker_drone', level: 2, cooldown: 0 },
          { id: 'pulse_blade', level: 2, cooldown: 0 },
        ],
        mainHitRatio: 1,
      },
      // 10F 大ボス (Lv20 = 累計30SP / 主兵装1系統MAX = 20SP使用)
      {
        name: '10F [A] 主兵装特化・サブなし (20SP)',
        playerLevel: 20,
        floor: 10,
        skills: { arm_base: 5, arm_parallel: 5, arm_overclock: 2 },
        equipment: [],
        mainHitRatio: 1.0, // 平行・貫通レーザー5発が単体ターゲットへ全弾ヒット
      },
      {
        name: '10F [B] 主兵装特化・サブ3枠Lv4 (20SP)',
        playerLevel: 20,
        floor: 10,
        skills: { arm_base: 5, arm_parallel: 5, arm_overclock: 2 },
        equipment: [
          { id: 'seeker_drone', level: 4, cooldown: 0 },
          { id: 'pulse_blade', level: 4, cooldown: 0 },
          { id: 'ricochet_disc', level: 4, cooldown: 0 },
        ],
        mainHitRatio: 1.0,
      },
      {
        name: '10F [C] 攻撃スキル0・機動防衛特化・サブ4枠Lv6',
        playerLevel: 20,
        floor: 10,
        skills: { mob_magnet: 3, mob_loot: 5, mob_dash: 1, def_sensor: 3, def_pulse: 2 },
        equipment: [
          { id: 'seeker_drone', level: 6, cooldown: 0 },
          { id: 'pulse_blade', level: 6, cooldown: 0 },
          { id: 'ricochet_disc', level: 6, cooldown: 0 },
          { id: 'reactive_coil', level: 6, cooldown: 0 },
        ],
        mainHitRatio: 1,
      },
      {
        name: '10F [D] バランス型・サブ3枠Lv5',
        playerLevel: 20,
        floor: 10,
        skills: { arm_base: 3, arm_parallel: 3, def_sensor: 3, def_pulse: 2, mob_magnet: 3, mob_loot: 3 },
        equipment: [
          { id: 'seeker_drone', level: 5, cooldown: 0 },
          { id: 'pulse_blade', level: 5, cooldown: 0 },
          { id: 'ricochet_disc', level: 5, cooldown: 0 },
        ],
        mainHitRatio: 1.0,
      },
    ];

    const rows = presets.map(evaluateBuild);
    console.log('\n=== CURRENT BALANCE BASELINE (DPS & TTK) ===');
    console.table(rows);

    for (const r of rows) {
      expect(r.totalSingleDps).toBeGreaterThan(0);
    }
  });
});
