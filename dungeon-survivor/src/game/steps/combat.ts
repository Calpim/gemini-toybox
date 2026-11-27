import { hasLineOfSight, resolveCircleGridCollision } from '../../core/collision';
import { isWallAtWorld } from '../../core/dungeon';
import { emitSound } from '../effects';
import {
  EQUIPMENT_CATALOG,
  type EquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getOrbitBitCount,
  getOrbitShieldAngularSpeed,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getSeekerDroneRange,
  MAX_TARGET_RANGE,
} from '../equipment';
import type { ComputedSkillModifiers } from '../skillTree';
import type { GameState, MainWeaponId, PlayerState, Vec2 } from '../types';
import { isEnemyVisibleToPlayer } from '../vision';
import { damageEnemy, findNearestVisibleEnemy, triggerChainLightning } from './combatHelpers';

export interface CombatBaseStats {
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

export interface CombatStepDeps {
  getPlayerBaseAttackStats: (player: PlayerState) => CombatBaseStats;
  getSeekerDronePositions: (state: GameState) => Vec2[];
}

export function stepPlayerCombat(
  state: GameState,
  mods: ComputedSkillModifiers,
  clampedDt: number,
  deps: CombatStepDeps,
): EquippedItem | undefined {
  const { player, map } = state;

  // 4. Skill tree active modules: Repulsor Pulse (def_pulse)
  if (mods.hasRepulsor && player.repulsorCooldown <= 0 && state.enemies.length > 0) {
    const pulseRange = Math.min(MAX_TARGET_RANGE, mods.repulsorRange * mods.rangeMult);
    const nearby = state.enemies.filter(
      (e) =>
        isEnemyVisibleToPlayer(state, e) &&
        Math.hypot(e.x - player.x, e.y - player.y) <= pulseRange &&
        hasLineOfSight(player.x, player.y, e.x, e.y, map),
    );
    if (nearby.length > 0) {
      for (const e of nearby) {
        const knockbackImmune = e.kind === 'shooter' || Boolean(e.isRoomBoss) || Boolean(e.isGrandBoss);
        if (!knockbackImmune) {
          const dx = e.x - player.x;
          const dy = e.y - player.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const pushed = resolveCircleGridCollision(e.x + (dx / d) * 38, e.y + (dy / d) * 38, e.radius, map);
          e.x = pushed.x;
          e.y = pushed.y;
        }
        damageEnemy(state, e, mods.repulsorDamage);
      }
      emitSound(state, 'parry');
      state.visualFx.push({
        kind: 'pulse',
        x: player.x,
        y: player.y,
        radius: pulseRange,
        color: '#60a5fa',
        life: 0.25,
        maxLife: 0.25,
      });
      player.repulsorCooldown = mods.repulsorCooldown;
    }
  }

  // 4.5. Player intrinsic Main Weapon auto-attack (Core Shot; scales via arms skills, APP-CMB-01, APP-CMB-06)
  if (player.baseAttackCooldown <= 0 && state.enemies.length > 0) {
    const baseStats = deps.getPlayerBaseAttackStats(player);
    const target = findNearestVisibleEnemy(player.x, player.y, baseStats.range, state, [], true);
    if (target) {
      const centerAngle = Math.atan2(target.y - player.y, target.x - player.x);
      const dirX = Math.cos(centerAngle);
      const dirY = Math.sin(centerAngle);
      const perpX = -dirY;
      const perpY = dirX;
      const laneSpacing = baseStats.armOverclockLevel >= 1 ? 10 : 14;
      const mainLife = Math.max(0.75, (baseStats.range + 60) / baseStats.speed);
      const chargeRadius = 5 + (baseStats.armBaseLevel >= 5 ? 4.0 : baseStats.armBaseLevel >= 3 ? 2.5 : 0);
      const sideLaserRadius = 4.0 + (baseStats.armBaseLevel >= 5 ? 0.8 : baseStats.armBaseLevel >= 3 ? 0.4 : 0);
      const sideLaserDamage = Math.max(1, Math.round(baseStats.damage * 0.6));
      const mainColor = baseStats.pierce ? '#2dd4bf' : baseStats.armBaseLevel >= 3 ? '#6ee7b7' : '#34d399';

      const centerIndex = Math.floor(baseStats.shotCount / 2);
      for (let s = 0; s < baseStats.shotCount; s++) {
        const laneOffset = (s - (baseStats.shotCount - 1) / 2) * laneSpacing;
        const isCenterCharge = baseStats.armOverclockLevel === 0 || s === centerIndex;
        let spawnX = player.x + perpX * laneOffset;
        let spawnY = player.y + perpY * laneOffset;
        if (isWallAtWorld(map, spawnX, spawnY)) {
          spawnX = player.x;
          spawnY = player.y;
        }
        state.projectiles.push({
          id: state.nextEntityId++,
          kind: 'base',
          x: spawnX,
          y: spawnY,
          vx: dirX * baseStats.speed,
          vy: dirY * baseStats.speed,
          radius: isCenterCharge ? chargeRadius : sideLaserRadius,
          damage: isCenterCharge ? baseStats.damage : sideLaserDamage,
          life: mainLife,
          pierce: baseStats.pierce,
          baseLevel: baseStats.armBaseLevel,
          overclockLevel: baseStats.armOverclockLevel,
          isCenterCharge,
          visualTier: Math.max(baseStats.armBaseLevel >= 3 ? 1 : 0, baseStats.armOverclockLevel),
          hitEnemyIds: [],
          color: mainColor,
        });
      }

      if (baseStats.homingShots > 0) {
        const homingSpeed = Math.max(300, Math.round(baseStats.speed * 0.72));
        const homingDashSpeed = Math.max(540, Math.round(baseStats.speed * 1.25));
        const orbitDuration = 0.26;
        const expandDuration = 0.13;
        const orbitRadius = 44;
        const expandTargetRadius = 84;
        const orbitAngularSpeed = (Math.PI * 2) / orbitDuration;
        for (let h = 0; h < baseStats.homingShots; h++) {
          const initialOrbitAngle = centerAngle + (h * Math.PI * 2) / baseStats.homingShots;
          let spawnX = player.x + Math.cos(initialOrbitAngle) * orbitRadius;
          let spawnY = player.y + Math.sin(initialOrbitAngle) * orbitRadius;
          if (isWallAtWorld(map, spawnX, spawnY)) {
            for (const ratio of [0.75, 0.5, 0.25, 0]) {
              const candX = player.x + Math.cos(initialOrbitAngle) * orbitRadius * ratio;
              const candY = player.y + Math.sin(initialOrbitAngle) * orbitRadius * ratio;
              if (!isWallAtWorld(map, candX, candY)) {
                spawnX = candX;
                spawnY = candY;
                break;
              }
            }
          }
          const tangentAngle = initialOrbitAngle + Math.PI / 2;
          state.projectiles.push({
            id: state.nextEntityId++,
            kind: 'base_homing',
            x: spawnX,
            y: spawnY,
            vx: Math.cos(tangentAngle) * homingSpeed,
            vy: Math.sin(tangentAngle) * homingSpeed,
            speed: homingSpeed,
            homingDashSpeed,
            radius: 4.5,
            damage: baseStats.homingDamage,
            life: orbitDuration + expandDuration + 1.03,
            pierce: false,
            homingTurnRate: 10,
            homingRange: 220,
            maxDistance: 320,
            orbitTimer: orbitDuration,
            orbitAngle: initialOrbitAngle,
            orbitRadius,
            orbitAngularSpeed,
            expandTimer: expandDuration,
            expandDuration,
            expandTargetRadius,
            trail: [{ x: spawnX, y: spawnY }],
            hitEnemyIds: [],
            color: '#a7f3d0',
          });
        }
      }

      emitSound(state, 'shot');
      player.baseAttackCooldown = baseStats.cooldown;
    }
  }

  // 5. Sub-equipment parallel execution & per-level evolutions (APP-CMB-01, APP-CMB-02, APP-CMB-05)
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  const orbitCount = orbitItem ? getOrbitBitCount(orbitItem.level) : 0;
  const orbitAngularSpeed = orbitItem ? getOrbitShieldAngularSpeed(orbitCount) : 2.4;
  if (orbitItem) {
    player.orbitRadius = getOrbitShieldRadius(orbitItem.level, mods.rangeMult);
  }
  player.orbitAngle = (player.orbitAngle + orbitAngularSpeed * clampedDt) % (Math.PI * 2);
  const seekerDrones = deps.getSeekerDronePositions(state);
  let droneCursor = 0;

  for (const item of player.equipment) {
    const def = EQUIPMENT_CATALOG[item.id];
    item.cooldown = Math.max(0, item.cooldown - clampedDt);

    if (item.id === 'orbit_shield') {
      continue;
    }

    if (item.cooldown > 0) continue;

    const dmg = getEquipmentDamage(item, 1);
    const cdMult = getEquipmentCooldownMultiplier(item.level);

    if (item.id === 'pulse_blade') {
      const blade = getPulseBladeStats(item.level, def.baseRange, mods.rangeMult);
      const cappedRange = Math.min(MAX_TARGET_RANGE, blade.range);
      const leadEnemy = findNearestVisibleEnemy(player.x, player.y, cappedRange, state);
      let leadBullet: { x: number; y: number } | null = null;
      if (!leadEnemy) {
        let bestBulletDist = cappedRange;
        for (const ep of state.enemyProjectiles) {
          if (ep.pierceDefense) continue;
          const d = Math.hypot(ep.x - player.x, ep.y - player.y);
          if (d <= bestBulletDist && hasLineOfSight(player.x, player.y, ep.x, ep.y, map)) {
            bestBulletDist = d;
            leadBullet = ep;
          }
        }
      }
      const aimTarget = leadEnemy ?? leadBullet;
      if (aimTarget) {
        const slashAngle = Math.atan2(aimTarget.y - player.y, aimTarget.x - player.x);
        const targets = state.enemies.filter((e) => {
          if (!isEnemyVisibleToPlayer(state, e)) return false;
          if (Math.hypot(e.x - player.x, e.y - player.y) > cappedRange) return false;
          if (!hasLineOfSight(player.x, player.y, e.x, e.y, map)) return false;
          const ea = Math.atan2(e.y - player.y, e.x - player.x);
          let diff = Math.abs(ea - slashAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          return diff <= blade.halfArcRad;
        });
        for (const t of targets) {
          damageEnemy(state, t, dmg);
        }

        let reflectedCount = 0;
        for (let bIdx = state.enemyProjectiles.length - 1; bIdx >= 0; bIdx--) {
          const ep = state.enemyProjectiles[bIdx];
          if (!ep || ep.pierceDefense) continue;
          if (Math.hypot(ep.x - player.x, ep.y - player.y) > cappedRange + ep.radius) continue;
          if (!hasLineOfSight(player.x, player.y, ep.x, ep.y, map)) continue;
          const ba = Math.atan2(ep.y - player.y, ep.x - player.x);
          let diff = Math.abs(ba - slashAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff <= blade.halfArcRad) {
            state.enemyProjectiles.splice(bIdx, 1);
            const inSpeed = Math.hypot(ep.vx, ep.vy);
            const refAngle = inSpeed > 1e-3 ? Math.atan2(-ep.vy, -ep.vx) : Math.atan2(ep.y - player.y, ep.x - player.x);
            const refSpeed = Math.max(360, inSpeed * 1.6);
            state.projectiles.push({
              id: state.nextEntityId++,
              kind: 'reflected',
              x: ep.x,
              y: ep.y,
              vx: Math.cos(refAngle) * refSpeed,
              vy: Math.sin(refAngle) * refSpeed,
              radius: Math.max(5, ep.radius),
              damage: Math.max(ep.damage, Math.round(dmg * 0.65)),
              life: 1.0,
              pierce: false,
              hitEnemyIds: [],
              color: '#67e8f9',
            });
            reflectedCount++;
          }
        }
        if (reflectedCount > 0) {
          state.floatingTexts.push({
            x: player.x,
            y: player.y - 22,
            text: reflectedCount > 1 ? `REFLECT x${reflectedCount}!` : 'REFLECT!',
            color: '#67e8f9',
            life: 0.55,
            maxLife: 0.55,
          });
        }

        emitSound(state, 'blade');
        state.visualFx.push({
          kind: 'slash',
          x: player.x,
          y: player.y,
          radius: cappedRange,
          angle: slashAngle,
          halfArcRad: blade.halfArcRad,
          fullCircle: false,
          thickness: blade.thickness,
          color: def.color,
          life: 0.24,
          maxLife: 0.24,
        });
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'seeker_drone') {
      const range = Math.min(MAX_TARGET_RANGE, getSeekerDroneRange(item.level, def.baseRange, mods.rangeMult));
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const dronesToFire = Math.max(1, seekerDrones.length);
        for (let dIdx = 0; dIdx < dronesToFire; dIdx++) {
          const origin = seekerDrones[(droneCursor + dIdx) % Math.max(1, seekerDrones.length)] ?? player;
          const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
          const speed = 430 + (item.level - 1) * 18;
          state.projectiles.push({
            id: state.nextEntityId++,
            kind: 'drone',
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 5,
            damage: dmg,
            life: 0.85,
            pierce: false,
            hitEnemyIds: [],
            color: '#7dd3fc',
          });
        }
        droneCursor++;
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'reactive_coil') {
      const coilStats = getReactiveCoilStats(item.level, def.baseRange, mods.rangeMult);
      const cappedRange = Math.min(MAX_TARGET_RANGE, coilStats.range);
      if (triggerChainLightning(state, player.x, player.y, cappedRange, dmg, coilStats.maxTargets)) {
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'ricochet_disc') {
      const discStats = getRicochetDiscStats(item.level, mods.rangeMult);
      const range = Math.min(MAX_TARGET_RANGE, discStats.range);
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const angle = Math.atan2(target.y - player.y, target.x - player.x);
        state.projectiles.push({
          id: state.nextEntityId++,
          kind: 'disc',
          x: player.x,
          y: player.y,
          vx: Math.cos(angle) * discStats.speed,
          vy: Math.sin(angle) * discStats.speed,
          radius: 7,
          damage: dmg,
          life: 1.85,
          pierce: false,
          bouncesLeft: discStats.maxBounces,
          wallBouncesLeft: 3,
          speed: discStats.speed,
          homingTurnRate: discStats.homingTurnRate,
          spinAngle: 0,
          traveledDist: 0,
          maxDistance: Math.min(480, Math.round(range * 2.6)),
          hitEnemyIds: [],
          color: def.color,
        });
        item.cooldown = def.baseCooldown * cdMult;
      }
    }
  }

  return orbitItem;
}
