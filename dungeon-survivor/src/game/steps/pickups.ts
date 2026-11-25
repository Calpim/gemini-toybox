import { emitSound, spawnParticles } from '../effects';
import { createEquippedItem, type EquippedItem } from '../equipment';
import type { ComputedSkillModifiers } from '../skillTree';
import type { GameState } from '../types';

export interface PickupsStepDeps {
  acquireEquipment: (state: GameState, droppedItem: EquippedItem) => void;
  grantExpAndCheckLevelUp: (state: GameState, gainedExp: number) => void;
}

export function stepPickupsAndFx(
  state: GameState,
  mods: ComputedSkillModifiers,
  clampedDt: number,
  deps: PickupsStepDeps,
): void {
  const { player } = state;

  // 10. Pickups (magnet & heal bonus scaled by mob_magnet, EXP by mob_loot; equip drops require direct pickup)
  const magnetRange = 95 * mods.pickupMagnetMult;
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (p.kind !== 'equip' && dist < magnetRange && dist > 1e-3) {
      const pull = 300 * clampedDt;
      p.x += (dx / dist) * Math.min(pull, dist);
      p.y += (dy / dist) * Math.min(pull, dist);
    }

    const pickupRadius = p.kind === 'equip' ? player.radius + 14 : player.radius + 12;
    if (Math.hypot(player.x - p.x, player.y - p.y) <= pickupRadius) {
      state.pickups.splice(i, 1);
      if (p.kind === 'equip' && p.equipmentId) {
        emitSound(state, 'pickup_equip');
        spawnParticles(state, p.x, p.y, '#fbbf24', 10, 45, 130, 2.8, 0.42);
        deps.acquireEquipment(state, createEquippedItem(p.equipmentId, p.itemLevel ?? 1));
        if (state.status !== 'playing') return;
      } else if (p.kind === 'heal') {
        emitSound(state, 'pickup_heal');
        spawnParticles(state, p.x, p.y, '#34d399', 8, 35, 105, 2.5, 0.35);
        const before = player.hp;
        const healAmount = Math.round(p.value * mods.healBonusMult);
        player.hp = Math.min(player.maxHp, player.hp + healAmount);
        const healed = Math.round(player.hp - before);
        state.floatingTexts.push({
          x: player.x,
          y: player.y - 18,
          text: healed > 0 ? `+${healed} HP` : 'MAX HP',
          color: '#34d399',
          life: 0.7,
          maxLife: 0.7,
        });
      } else {
        emitSound(state, 'pickup_exp');
        const gainedExp = Math.round(p.value * mods.expMult);
        deps.grantExpAndCheckLevelUp(state, gainedExp);
      }
    }
  }

  // 11. Floating texts, Visual FX, Particles, Screen Shake, and Toast Notifications lifetimes
  if ((state.shakeTimer ?? 0) > 0) {
    state.shakeTimer = Math.max(0, (state.shakeTimer ?? 0) - clampedDt);
    if (state.shakeTimer <= 0) state.shakeIntensity = 0;
  }

  if (state.particles) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.x += pt.vx * clampedDt;
      pt.y += pt.vy * clampedDt;
      pt.vx *= 0.92;
      pt.vy *= 0.92;
      pt.life -= clampedDt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y -= 26 * clampedDt;
    ft.life -= clampedDt;
    if (ft.life <= 0) state.floatingTexts.splice(i, 1);
  }

  for (let i = state.visualFx.length - 1; i >= 0; i--) {
    const fx = state.visualFx[i];
    fx.life -= clampedDt;
    if (fx.life <= 0) state.visualFx.splice(i, 1);
  }

  for (let i = state.notifications.length - 1; i >= 0; i--) {
    const n = state.notifications[i];
    n.life -= clampedDt;
    if (n.life <= 0) state.notifications.splice(i, 1);
  }
}
