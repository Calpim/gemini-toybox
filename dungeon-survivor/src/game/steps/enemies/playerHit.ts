import { emitSound, spawnParticles, triggerShake } from '../../effects';
import { EQUIPMENT_CATALOG, getEquipmentDamage, getReactiveCoilStats, MAX_TARGET_RANGE } from '../../equipment';
import { BASE_HIT_INVULN_DURATION, type ComputedSkillModifiers, TACTICAL_SPEED_BOOST_DURATION } from '../../skillTree';
import type { EnemyState, GameState } from '../../types';
import { damageEnemy, triggerChainLightning } from '../combatHelpers';

/**
 * Attempts to consume a mob_dash charge to completely evade an incoming hit (no damage, extended invuln, speed boost).
 * Can evade all attack types including pierceDefense, mortars, boss lasers, and boss dashes.
 */
export function tryTacticalStepEvade(state: GameState, mods: ComputedSkillModifiers): boolean {
  const { player } = state;
  const charges = player.tacticalStepCharges ?? mods.tacticalMaxCharges;
  if (!mods.hasTacticalStep || charges <= 0) return false;
  player.tacticalStepCharges = charges - 1;
  if (player.tacticalStepCooldown <= 0) {
    player.tacticalStepCooldown = mods.tacticalStepCooldown;
  }
  player.invulnTimer = mods.tacticalInvulnDuration;
  player.tacticalSpeedTimer = TACTICAL_SPEED_BOOST_DURATION;
  player.tacticalSpeedBonus = mods.tacticalSpeedBonus;
  state.floatingTexts.push({
    x: player.x,
    y: player.y - 22,
    text: 'EVADE!',
    color: '#38bdf8',
    life: 0.65,
    maxLife: 0.65,
  });
  return true;
}

/**
 * Applies standard player hit damage, feedback FX, and base hit invulnerability.
 * Returns true if the player died (status transitioned to gameover).
 */
export function applyPlayerHitDamage(
  state: GameState,
  damage: number,
  shakeIntensity: number,
  shakeDuration: number,
  particleColor = '#f87171',
  particleCount = 6,
): boolean {
  const { player } = state;
  player.hp = Math.max(0, player.hp - damage);
  emitSound(state, 'player_hit');
  triggerShake(state, shakeIntensity, shakeDuration);
  spawnParticles(state, player.x, player.y, particleColor, particleCount, 45, 140, 2.5, 0.3);
  state.floatingTexts.push({
    x: player.x,
    y: player.y - player.radius - 6,
    text: `-${damage}`,
    color: particleColor,
    life: 0.7,
    maxLife: 0.7,
  });
  if (player.hp <= 0) {
    state.status = 'gameover';
    return true;
  }
  player.invulnTimer = BASE_HIT_INVULN_DURATION;
  return false;
}

/**
 * Attempts to trigger def_aegis parry against parryable hits (melee contact or normal enemy projectiles).
 * Piercing projectiles, parabolic mortars, and boss lasers bypass parry.
 */
export function tryAegisParry(state: GameState, mods: ComputedSkillModifiers, counterTarget?: EnemyState): boolean {
  const { player } = state;
  if (!mods.hasAegisParry || player.aegisCooldown > 0) return false;
  player.aegisCooldown = mods.aegisCooldown;
  player.invulnTimer = BASE_HIT_INVULN_DURATION;
  emitSound(state, 'parry');
  triggerShake(state, 3.5, 0.12);
  spawnParticles(state, player.x, player.y, '#34d399', 8, 55, 140, 2.4, 0.28);
  if (counterTarget) {
    damageEnemy(state, counterTarget, mods.aegisDamage);
    state.visualFx.push({
      kind: 'pulse',
      x: player.x,
      y: player.y,
      radius: 70,
      color: '#34d399',
      life: 0.25,
      maxLife: 0.25,
    });
  }
  state.floatingTexts.push({
    x: player.x,
    y: player.y - 20,
    text: 'PARRY!',
    color: '#34d399',
    life: 0.7,
    maxLife: 0.7,
  });
  return true;
}

export function stepEnemyProjectilesOnPlayer(state: GameState, mods: ComputedSkillModifiers): boolean {
  const { player } = state;
  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    if (!ep) continue;
    if (player.invulnTimer <= 0 && Math.hypot(player.x - ep.x, player.y - ep.y) <= player.radius + ep.radius) {
      state.enemyProjectiles.splice(i, 1);
      if (!ep.pierceDefense && tryAegisParry(state, mods)) {
        continue;
      }
      if (tryTacticalStepEvade(state, mods)) {
        continue;
      }
      if (applyPlayerHitDamage(state, ep.damage, 5.5, 0.16, '#f87171', 6)) {
        return true;
      }
    }
  }
  return false;
}

export function handleEnemyContactWithPlayer(
  state: GameState,
  enemy: EnemyState,
  mods: ComputedSkillModifiers,
): boolean {
  const { player } = state;
  if (player.invulnTimer <= 0 && Math.hypot(player.x - enemy.x, player.y - enemy.y) <= player.radius + enemy.radius) {
    const isDashingBoss = Boolean(enemy.isRoomBoss || enemy.isGrandBoss) && enemy.dashState === 'dashing';

    if (!isDashingBoss) {
      if (tryAegisParry(state, mods, enemy)) {
        return false;
      }
      if (tryTacticalStepEvade(state, mods)) {
        return false;
      }
    } else {
      if (tryTacticalStepEvade(state, mods)) {
        return false;
      }
    }

    if (applyPlayerHitDamage(state, enemy.damage, 6, 0.18, '#f87171', 7)) {
      return true;
    }

    // Boss dash bypasses parry damage negation, but def_aegis still triggers a counter-hit (trade)
    if (isDashingBoss && mods.hasAegisParry && player.aegisCooldown <= 0) {
      player.aegisCooldown = mods.aegisCooldown;
      emitSound(state, 'parry');
      damageEnemy(state, enemy, mods.aegisDamage, true);
      state.visualFx.push({
        kind: 'pulse',
        x: player.x,
        y: player.y,
        radius: 70,
        color: '#34d399',
        life: 0.25,
        maxLife: 0.25,
      });
      state.floatingTexts.push({
        x: player.x,
        y: player.y - 20,
        text: 'PARRY!',
        color: '#34d399',
        life: 0.7,
        maxLife: 0.7,
      });
    }

    // Trigger reactive coil counter immediately on hit if equipped
    const coil = player.equipment.find((e) => e.id === 'reactive_coil');
    if (coil) {
      const coilStats = getReactiveCoilStats(coil.level, EQUIPMENT_CATALOG.reactive_coil.baseRange, mods.rangeMult);
      triggerChainLightning(
        state,
        player.x,
        player.y,
        Math.min(MAX_TARGET_RANGE, coilStats.range),
        getEquipmentDamage(coil, 1),
        coilStats.maxTargets,
      );
    }
  }
  return false;
}
