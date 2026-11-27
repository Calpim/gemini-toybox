import { getOrbitBitPositions, getSeekerDronePositions, isEnemyVisibleToPlayer } from '../../game/engine';
import { EQUIPMENT_CATALOG, getOrbitShieldRadius, getSeekerDroneRange, MAX_TARGET_RANGE } from '../../game/equipment';
import type { computeSkillModifiers } from '../../game/skillTree';
import type { EnemyState, GameState } from '../../game/types';
import { drawGlowSprite, type GlowColor } from '../sprites';
import { setLineDashSafe } from './primitives';

function drawPlayerCore(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  facingAngle: number,
  nowSec: number,
): void {
  const pulse = 0.82 + 0.18 * Math.sin(nowSec * 5.2);

  // Soft outer cyan radial glow (pre-baked sprite, additive)
  drawGlowSprite(ctx, 'cyan', x, y, radius * 3.15, 0.62 * pulse, true);

  ctx.save();
  ctx.translate(x, y);

  // Rotating outer segmented cyan energy ring
  ctx.save();
  ctx.rotate(nowSec * 1.35);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
  ctx.lineWidth = 1.25;
  setLineDashSafe(ctx, [4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5.5, 0, Math.PI * 2);
  ctx.stroke();
  setLineDashSafe(ctx, []);

  ctx.strokeStyle = 'rgba(103, 232, 249, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5.5, 0.15, 1.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5.5, Math.PI + 0.15, Math.PI + 1.35);
  ctx.stroke();
  ctx.restore();

  // Counter-rotating inner subtle halo ring
  ctx.save();
  ctx.rotate(-nowSec * 2.1);
  ctx.strokeStyle = 'rgba(165, 243, 252, 0.58)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 2.2, 0.4, 2.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius + 2.2, Math.PI + 0.4, Math.PI + 2.3);
  ctx.stroke();
  ctx.restore();

  // Glowing cyan-to-white energy orb
  ctx.rotate(facingAngle);
  if (typeof ctx.createRadialGradient === 'function') {
    const coreGrad = ctx.createRadialGradient(-radius * 0.22, -radius * 0.22, 1, 0, 0, radius);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.35, '#a5f3fc');
    coreGrad.addColorStop(0.75, '#38bdf8');
    coreGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = coreGrad;
  } else {
    ctx.fillStyle = '#38bdf8';
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ecfeff';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Inner concentric tech halo
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  // Crisp directional indicator dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(Math.max(5.5, radius * 0.52), 0, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawEnemyBody(ctx: CanvasRenderingContext2D, enemy: EnemyState, nowSec: number): void {
  const kind = enemy.kind ?? 'normal';
  const flash = enemy.hitFlash > 0;

  // Pre-baked outer neon halo (zero shadowBlur)
  const glowColor: GlowColor = enemy.isGrandBoss
    ? 'rose'
    : kind === 'tank'
      ? 'purple'
      : kind === 'runner' || kind === 'scout'
        ? 'amber'
        : kind === 'shooter'
          ? 'pink'
          : 'rose';
  drawGlowSprite(
    ctx,
    glowColor,
    enemy.x,
    enemy.y,
    enemy.radius * (enemy.isRoomBoss ? 2.5 : 2.1),
    enemy.awake ? 0.44 : 0.24,
    true,
  );

  ctx.save();
  ctx.translate(enemy.x, enemy.y);

  if ((enemy.spawnDelay ?? 0) > 0) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    setLineDashSafe(ctx, [4, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 9, 0, Math.PI * 2);
    ctx.stroke();
    setLineDashSafe(ctx, []);
  }

  if (enemy.isAmbush) {
    const glow = 0.65 + 0.35 * Math.sin(nowSec * 12);
    ctx.fillStyle = `rgba(249, 115, 22, ${0.2 * glow})`;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(251, 191, 36, ${0.8 * glow})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 5 + glow * 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (enemy.isRoomBoss) {
    if (enemy.dashState === 'windup' && enemy.dashDir) {
      const dashPreviewLen = (enemy.dashSpeed ?? 480) * (enemy.isGrandBoss ? 0.62 : 0.55);
      const tx = enemy.dashDir.x * dashPreviewLen;
      const ty = enemy.dashDir.y * dashPreviewLen;
      const blink = 0.55 + 0.45 * Math.sin(nowSec * 28);
      ctx.save();
      ctx.strokeStyle = `rgba(244, 63, 94, ${0.42 * blink})`;
      ctx.lineWidth = enemy.radius * 1.85;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      ctx.strokeStyle = `rgba(254, 205, 211, ${0.88 * blink})`;
      ctx.lineWidth = 2;
      setLineDashSafe(ctx, [6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      setLineDashSafe(ctx, []);
      ctx.restore();
    } else if (enemy.dashState === 'dashing') {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.92)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 14, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(251, 113, 133, 0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
    } else if (enemy.dashState === 'recovering') {
      const stunBlink = 0.45 + 0.55 * Math.sin(nowSec * 20);
      ctx.save();
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.88 * stunBlink})`;
      ctx.lineWidth = 2.8;
      setLineDashSafe(ctx, [5, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 11, 0, Math.PI * 2);
      ctx.stroke();
      setLineDashSafe(ctx, []);
      ctx.restore();
    }

    const bossPulse = 0.7 + 0.3 * Math.sin(nowSec * 5);
    ctx.strokeStyle = enemy.isGrandBoss
      ? `rgba(244, 63, 94, ${0.92 * bossPulse})`
      : `rgba(250, 204, 21, ${0.88 * bossPulse})`;
    ctx.lineWidth = enemy.isGrandBoss ? 3.2 : 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + (enemy.isGrandBoss ? 9 : 6), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (kind === 'tank') {
    // Heavy armored neon hexagon
    ctx.fillStyle = flash ? '#ffffff' : enemy.isGrandBoss ? '#9f1239' : enemy.awake ? '#6d28d9' : '#3b0764';
    ctx.strokeStyle = enemy.isGrandBoss
      ? '#fda4af'
      : enemy.isRoomBoss
        ? '#fde047'
        : enemy.awake
          ? '#e9d5ff'
          : '#7c3aed';
    ctx.lineWidth = enemy.isRoomBoss ? 3.5 : 2.6;
    ctx.beginPath();
    for (let s = 0; s < 6; s++) {
      const a = (s * Math.PI) / 3;
      const vx = Math.cos(a) * enemy.radius;
      const vy = Math.sin(a) * enemy.radius;
      if (s === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner tech hexagon + core ring
    ctx.strokeStyle = enemy.isGrandBoss ? 'rgba(253, 224, 71, 0.65)' : 'rgba(221, 214, 254, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let s = 0; s < 6; s++) {
      const a = (s * Math.PI) / 3;
      const vx = Math.cos(a) * enemy.radius * 0.62;
      const vy = Math.sin(a) * enemy.radius * 0.62;
      if (s === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = enemy.isGrandBoss ? 'rgba(254, 205, 211, 0.7)' : 'rgba(216, 180, 254, 0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius * 0.24, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'runner') {
    // Fast agile neon diamond
    const r = enemy.radius + 1;
    ctx.fillStyle = flash ? '#ffffff' : enemy.isAmbush ? '#fb923c' : enemy.awake ? '#f59e0b' : '#92400e';
    ctx.strokeStyle = enemy.isAmbush ? '#fef3c7' : enemy.awake ? '#fef08a' : '#b45309';
    ctx.lineWidth = enemy.isAmbush ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner bright core diamond
    const ir = r * 0.44;
    ctx.fillStyle = 'rgba(254, 249, 195, 0.65)';
    ctx.beginPath();
    ctx.moveTo(0, -ir);
    ctx.lineTo(ir, 0);
    ctx.lineTo(0, ir);
    ctx.lineTo(-ir, 0);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'shooter') {
    // Stationary 8-way barrage turret with charge-up telegraph ring before firing
    const s = enemy.radius;
    const cd = enemy.attackCooldown ?? 1;
    if (enemy.awake && cd <= 0.65) {
      const charge = Math.max(0, Math.min(1, (0.65 - cd) / 0.65));
      ctx.strokeStyle = `rgba(244, 114, 182, ${0.4 + charge * 0.6})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, s + 9 - charge * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer subtle tech halo ring
    ctx.strokeStyle = enemy.awake ? 'rgba(244, 114, 182, 0.42)' : 'rgba(190, 24, 93, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, s + 3.5, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating radial barrage nozzles
    const rotOffset = (enemy.bossPatternIndex ?? 0) * (Math.PI / 8);
    ctx.fillStyle = '#fdf2f8';
    for (let k = 0; k < 8; k++) {
      ctx.save();
      ctx.rotate(rotOffset + (k * Math.PI) / 4);
      ctx.fillRect(s * 0.45, -1.8, s * 0.72, 3.6);
      ctx.restore();
    }

    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#db2777' : '#831843';
    ctx.strokeStyle = enemy.awake ? '#fbcfe8' : '#9d174d';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const vx = Math.cos(a) * s;
      const vy = Math.sin(a) * s;
      if (k === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(253, 242, 248, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#fdf2f8';
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'scout') {
    // Wandering scout with neon radar ring
    const pulse = 0.65 + 0.35 * Math.sin(nowSec * 6);
    ctx.strokeStyle = enemy.awake ? `rgba(249, 115, 22, ${0.8 * pulse})` : `rgba(250, 204, 21, ${0.5 * pulse})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 5 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#f97316' : '#eab308';
    ctx.strokeStyle = '#fef9c3';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.radius - 2);
    ctx.lineTo(enemy.radius + 1, enemy.radius);
    ctx.lineTo(-enemy.radius - 1, enemy.radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner glowing tech chevron
    ctx.strokeStyle = 'rgba(254, 249, 195, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.radius * 0.45);
    ctx.lineTo(enemy.radius * 0.48, enemy.radius * 0.48);
    ctx.lineTo(-enemy.radius * 0.48, enemy.radius * 0.48);
    ctx.closePath();
    ctx.stroke();
  } else {
    // Standard chaser with neon rim & inner core ring
    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#e11d48' : '#881337';
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = enemy.awake ? '#fda4af' : '#be123c';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.strokeStyle = enemy.awake ? 'rgba(255, 228, 230, 0.55)' : 'rgba(251, 113, 133, 0.35)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius * 0.52, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  if (enemy.isRoomBoss) {
    ctx.save();
    ctx.fillStyle = enemy.isGrandBoss ? '#fda4af' : '#fde047';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(enemy.isGrandBoss ? 'GRAND BOSS' : 'GUARDIAN', enemy.x, enemy.y - enemy.radius - 14);
    ctx.restore();
  }

  if (enemy.hp < enemy.maxHp) {
    const bw = Math.max(24, enemy.radius * 2);
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = 'rgba(6, 12, 26, 0.88)';
    ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw, 4);
    ctx.fillStyle = enemy.isGrandBoss ? '#f43f5e' : enemy.isRoomBoss ? '#facc15' : '#fb7185';
    ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw * ratio, 4);
  }
}

export function renderPlayerSupportGear(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  mods: ReturnType<typeof computeSkillModifiers>,
): void {
  const { player } = state;

  // 5. Intercept range rings & Orbit Bits
  const droneEquip = player.equipment.find((e) => e.id === 'seeker_drone');
  if (droneEquip) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      player.x,
      player.y,
      Math.min(
        MAX_TARGET_RANGE,
        getSeekerDroneRange(droneEquip.level, EQUIPMENT_CATALOG.seeker_drone.baseRange, mods.rangeMult),
      ),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  const orbitEquip = player.equipment.find((e) => e.id === 'orbit_shield');
  const bits = getOrbitBitPositions(state);
  if (bits.length > 0 && orbitEquip) {
    const orbitR = getOrbitShieldRadius(orbitEquip.level, mods.rangeMult);
    ctx.save();
    ctx.fillStyle = 'rgba(34, 211, 238, 0.04)';
    ctx.beginPath();
    ctx.arc(player.x, player.y, orbitR, 0, Math.PI * 2);
    ctx.fill();

    // Crisp dashed cyan-blue tech orbit ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
    ctx.lineWidth = 1.4;
    setLineDashSafe(ctx, [5, 5]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, orbitR, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle secondary inner dashed tech ring
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
    ctx.lineWidth = 1.1;
    setLineDashSafe(ctx, [3, 4]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, orbitR * 0.56, 0, Math.PI * 2);
    ctx.stroke();
    setLineDashSafe(ctx, []);
    ctx.restore();

    for (const bit of bits) {
      drawGlowSprite(ctx, 'purple', bit.x, bit.y, 17, 0.55, true);
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f5f3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Hovering Seeker Drones
  for (const drone of getSeekerDronePositions(state)) {
    drawGlowSprite(ctx, 'cyan', drone.x, drone.y, 15, 0.42, true);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(drone.x, drone.y - 6);
    ctx.lineTo(drone.x + 6, drone.y + 4);
    ctx.lineTo(drone.x - 6, drone.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export function renderEnemies(ctx: CanvasRenderingContext2D, state: GameState, nowSec: number): void {
  for (const enemy of state.enemies) {
    if (!isEnemyVisibleToPlayer(state, enemy)) {
      continue;
    }
    drawEnemyBody(ctx, enemy, nowSec);
  }
}

export function renderPlayerAndAura(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  mods: ReturnType<typeof computeSkillModifiers>,
  nowSec: number,
): void {
  const { player } = state;
  if (mods.hasAegisParry && player.aegisCooldown <= 0) {
    drawGlowSprite(ctx, 'emerald', player.x, player.y, player.radius * 2.4, 0.32, true);
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 8.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const blink = player.invulnTimer > 0 && Math.floor(nowSec * 20) % 2 === 0;
  if (!blink) {
    drawPlayerCore(ctx, player.x, player.y, player.radius, player.facingAngle, nowSec);
  }
}
