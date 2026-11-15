import { TILE_SIZE, findRoomAtTile, getTile, tileCenterWorld } from '../core/dungeon';
import {
  CORRIDOR_VISION_RADIUS,
  getOrbitBitPositions,
  getSeekerDronePositions,
  getStairsLockCount,
  isPointInPlayerVision,
} from '../game/engine';
import {
  EQUIPMENT_CATALOG,
  MAX_TARGET_RANGE,
  getOrbitShieldRadius,
  getSeekerDroneRange,
} from '../game/equipment';
import { computeSkillModifiers } from '../game/skillTree';
import type { EnemyState, GameState } from '../game/types';
import type { VirtualStickState } from '../input/controller';

export const TARGET_VIEW_WORLD_WIDTH = 840; // ~21 tiles across on desktop/web

export function computeCameraZoom(viewportWidth: number, viewportHeight: number): number {
  const widthZoom = Math.max(0.72, viewportWidth / TARGET_VIEW_WORLD_WIDTH);
  const heightMaxZoom = Math.max(0.72, viewportHeight / 480);
  return Math.min(2.4, widthZoom, heightMaxZoom);
}

let fogCanvas: HTMLCanvasElement | null = null;

function getFogCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!fogCanvas) {
    fogCanvas = document.createElement('canvas');
  }
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (fogCanvas.width !== cw || fogCanvas.height !== ch) {
    fogCanvas.width = cw;
    fogCanvas.height = ch;
  }
  return fogCanvas;
}

function drawEnemyBody(
  ctx: CanvasRenderingContext2D,
  enemy: EnemyState,
  nowSec: number
): void {
  const kind = enemy.kind ?? 'normal';
  const flash = enemy.hitFlash > 0;

  ctx.save();
  ctx.translate(enemy.x, enemy.y);

  if ((enemy.spawnDelay ?? 0) > 0) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (enemy.isAmbush) {
    const glow = 0.65 + 0.35 * Math.sin(nowSec * 12);
    ctx.fillStyle = `rgba(249, 115, 22, ${0.22 * glow})`;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(251, 191, 36, ${0.75 * glow})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 5 + glow * 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (enemy.isRoomBoss) {
    if (enemy.dashState === 'windup' && enemy.dashDir) {
      const dashPreviewLen = (enemy.dashSpeed ?? 320) * (enemy.isGrandBoss ? 0.48 : 0.42);
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

      ctx.strokeStyle = `rgba(254, 205, 211, ${0.85 * blink})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (enemy.dashState === 'dashing') {
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    const bossPulse = 0.7 + 0.3 * Math.sin(nowSec * 5);
    ctx.strokeStyle = enemy.isGrandBoss
      ? `rgba(244, 63, 94, ${0.9 * bossPulse})`
      : `rgba(250, 204, 21, ${0.85 * bossPulse})`;
    ctx.lineWidth = enemy.isGrandBoss ? 3.2 : 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + (enemy.isGrandBoss ? 9 : 6), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (kind === 'tank') {
    // Heavy armored hexagon
    ctx.fillStyle = flash
      ? '#ffffff'
      : enemy.isGrandBoss
      ? '#9f1239'
      : enemy.awake
      ? '#7c3aed'
      : '#4c1d95';
    ctx.strokeStyle = enemy.isGrandBoss
      ? '#fda4af'
      : enemy.isRoomBoss
      ? '#fde047'
      : enemy.awake
      ? '#ddd6fe'
      : '#6d28d9';
    ctx.lineWidth = enemy.isRoomBoss ? 3.5 : 3;
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

    ctx.strokeStyle = enemy.isGrandBoss
      ? 'rgba(253, 224, 71, 0.6)'
      : 'rgba(221, 214, 254, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'runner') {
    // Fast agile diamond
    const r = enemy.radius + 1;
    ctx.fillStyle = flash ? '#ffffff' : enemy.isAmbush ? '#fb923c' : enemy.awake ? '#f59e0b' : '#92400e';
    ctx.strokeStyle = enemy.isAmbush ? '#fef3c7' : enemy.awake ? '#fef08a' : '#78350f';
    ctx.lineWidth = enemy.isAmbush ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'shooter') {
    // Stationary 8-way barrage turret with charge-up telegraph ring before firing
    const s = enemy.radius;
    const cd = enemy.attackCooldown ?? 1;
    if (enemy.awake && cd <= 0.65) {
      const charge = Math.max(0, Math.min(1, (0.65 - cd) / 0.65));
      ctx.strokeStyle = `rgba(244, 114, 182, ${0.35 + charge * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s + 9 - charge * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 8 radial barrage nozzles
    const rotOffset = ((enemy.bossPatternIndex ?? 0) % 2) * (Math.PI / 8);
    ctx.fillStyle = '#fdf2f8';
    for (let k = 0; k < 8; k++) {
      ctx.save();
      ctx.rotate(rotOffset + (k * Math.PI) / 4);
      ctx.fillRect(s * 0.45, -2, s * 0.72, 4);
      ctx.restore();
    }

    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#db2777' : '#831843';
    ctx.strokeStyle = enemy.awake ? '#fbcfe8' : '#500724';
    ctx.lineWidth = 2;
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

    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'scout') {
    // Wandering scout with radar ring
    const pulse = 0.65 + 0.35 * Math.sin(nowSec * 6);
    ctx.strokeStyle = enemy.awake
      ? `rgba(249, 115, 22, ${0.75 * pulse})`
      : `rgba(250, 204, 21, ${0.45 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 5 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#f97316' : '#eab308';
    ctx.strokeStyle = '#fef9c3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.radius - 2);
    ctx.lineTo(enemy.radius + 1, enemy.radius);
    ctx.lineTo(-enemy.radius - 1, enemy.radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // Standard chaser
    ctx.fillStyle = flash ? '#ffffff' : enemy.awake ? '#f43f5e' : '#9f1239';
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = enemy.awake ? '#fda4af' : '#4c0519';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();

  if (enemy.isRoomBoss) {
    ctx.save();
    ctx.fillStyle = enemy.isGrandBoss ? '#fda4af' : '#fde047';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      enemy.isGrandBoss ? 'GRAND BOSS' : 'GUARDIAN',
      enemy.x,
      enemy.y - enemy.radius - 14
    );
    ctx.restore();
  }

  if (enemy.hp < enemy.maxHp) {
    const bw = Math.max(24, enemy.radius * 2);
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw, 4);
    ctx.fillStyle = enemy.isGrandBoss ? '#f43f5e' : enemy.isRoomBoss ? '#facc15' : '#fb7185';
    ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw * ratio, 4);
  }
}

export function renderGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  stick: VirtualStickState,
  nowSec: number
): void {
  const { map, player, explored } = state;
  const mods = computeSkillModifiers(player.skillLevels);
  const stairsLockCount = getStairsLockCount(state);

  ctx.fillStyle = '#050811';
  ctx.fillRect(0, 0, width, height);

  const zoom = computeCameraZoom(width, height);
  const viewW = width / zoom;
  const viewH = height / zoom;
  const camX = player.x - viewW / 2;
  const camY = player.y - viewH / 2;

  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // 1. Visible tile culling & explored dungeon floor/walls
  const minTx = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
  const maxTx = Math.min(map.width - 1, Math.ceil((camX + viewW) / TILE_SIZE) + 1);
  const minTy = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
  const maxTy = Math.min(map.height - 1, Math.ceil((camY + viewH) / TILE_SIZE) + 1);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!explored[ty * map.width + tx]) continue;
      const tile = getTile(map, tx, ty);
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;

      if (tile === 'wall') {
        ctx.fillStyle = '#141d31';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#1e2b45';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 8);
      } else {
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#0b101d' : '#0d1323';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.18)';
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

        if (tile === 'stairs') {
          const pulse = 0.7 + 0.3 * Math.sin(nowSec * 4.5);
          const center = tileCenterWorld(tx, ty);
          const locked = stairsLockCount > 0;
          ctx.save();
          ctx.fillStyle = locked
            ? `rgba(244, 63, 94, ${0.2 * pulse})`
            : `rgba(34, 211, 238, ${0.18 * pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * 0.48, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = locked ? '#fb7185' : '#22d3ee';
          ctx.lineWidth = 2;
          for (let s = -1; s <= 1; s++) {
            const y = center.y + s * 6;
            ctx.beginPath();
            ctx.moveTo(center.x - 10 + s * 3, y);
            ctx.lineTo(center.x + 10, y);
            ctx.stroke();
          }
          if (locked) {
            ctx.strokeStyle = 'rgba(251, 113, 133, 0.85)';
            ctx.beginPath();
            ctx.arc(center.x, center.y, TILE_SIZE * 0.46, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = locked ? '#fecdd3' : '#a5f3fc';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(locked ? `LOCKED (${stairsLockCount})` : 'NEXT ▲', center.x, center.y - 16);
          ctx.restore();
        } else if (tile === 'fountain') {
          const center = tileCenterWorld(tx, ty);
          const used = Boolean(state.fountainUsed);
          const pulse = 0.72 + 0.28 * Math.sin(nowSec * 4);
          ctx.save();
          ctx.fillStyle = used
            ? 'rgba(51, 65, 85, 0.35)'
            : `rgba(45, 212, 191, ${0.26 * pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * 0.46, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = used ? '#64748b' : '#2dd4bf';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (!used) {
            ctx.fillStyle = '#99f6e4';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('FOUNTAIN', center.x, center.y - 16);
          }
          ctx.restore();
        }
      }
    }
  }

  // 2. Treasure chests (only on explored tiles)
  for (const chest of state.chests) {
    const cx = Math.floor(chest.x / TILE_SIZE);
    const cy = Math.floor(chest.y / TILE_SIZE);
    if (!explored[cy * map.width + cx]) continue;

    ctx.save();
    ctx.translate(chest.x, chest.y);
    if (chest.opened) {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = '#94a3b8';
      ctx.strokeRect(-11, -8, 22, 16);
    } else {
      const glow = 0.75 + 0.25 * Math.sin(nowSec * 5);
      ctx.fillStyle = `rgba(251, 191, 36, ${0.2 * glow})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#b45309';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-11, -8, 22, 6);
      ctx.fillRect(-3, -2, 6, 5);
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-11, -8, 22, 16);
    }
    ctx.restore();
  }

  // 3. Pickups (only on explored tiles)
  for (const p of state.pickups) {
    const ptx = Math.floor(p.x / TILE_SIZE);
    const pty = Math.floor(p.y / TILE_SIZE);
    if (!explored[pty * map.width + ptx]) continue;

    if (p.kind === 'heal') {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ecfdf5';
      ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3);
      ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
    } else if (p.kind === 'equip' && p.equipmentId) {
      const def = EQUIPMENT_CATALOG[p.equipmentId];
      const pulse = 0.7 + 0.3 * Math.sin(nowSec * 6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = `rgba(251, 191, 36, ${0.24 * pulse})`;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Lv${p.itemLevel ?? 1}`, 0, -12);
      ctx.restore();
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 6);
      ctx.lineTo(p.x + 5, p.y);
      ctx.lineTo(p.x, p.y + 6);
      ctx.lineTo(p.x - 5, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 5. Intercept range rings & Orbit Bits
  const droneEquip = player.equipment.find((e) => e.id === 'seeker_drone');
  if (droneEquip) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      player.x,
      player.y,
      Math.min(
        MAX_TARGET_RANGE,
        getSeekerDroneRange(droneEquip.level, EQUIPMENT_CATALOG.seeker_drone.baseRange, mods.rangeMult)
      ),
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }

  const orbitEquip = player.equipment.find((e) => e.id === 'orbit_shield');
  const bits = getOrbitBitPositions(state);
  if (bits.length > 0 && orbitEquip) {
    const orbitR = getOrbitShieldRadius(orbitEquip.level, mods.rangeMult);
    ctx.fillStyle = 'rgba(167, 139, 250, 0.07)';
    ctx.beginPath();
    ctx.arc(player.x, player.y, orbitR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, orbitR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const bit of bits) {
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ede9fe';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Hovering Seeker Drones
  for (const drone of getSeekerDronePositions(state)) {
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

  // 5.5. Tank parabolic mortar landing telegraphs & airborne shells
  for (const zone of state.mortarZones) {
    const progress = Math.max(0, Math.min(1, zone.elapsed / Math.max(0.01, zone.duration)));
    ctx.save();
    // Target danger zone fill & outer border
    ctx.fillStyle = `rgba(168, 85, 247, ${0.14 + progress * 0.14})`;
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(216, 180, 254, 0.88)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Expanding inner timing circle (reaches outer ring right on impact)
    ctx.fillStyle = `rgba(244, 63, 94, ${0.18 + progress * 0.28})`;
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius * progress, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(251, 113, 133, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius * progress, 0, Math.PI * 2);
    ctx.stroke();

    // Airborne lobbed shell flying along a parabolic arc
    const shellGroundX = zone.startX + (zone.targetX - zone.startX) * progress;
    const shellGroundY = zone.startY + (zone.targetY - zone.startY) * progress;
    const arcHeight = Math.sin(progress * Math.PI) * 52;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.ellipse(shellGroundX, shellGroundY, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(shellGroundX, shellGroundY - arcHeight, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fae8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // 6. Visual FX (Thick crescent Slash / Lightning / Pulse)
  for (const fx of state.visualFx) {
    const alpha = Math.max(0, fx.life / fx.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx.kind === 'slash' && fx.radius !== undefined && fx.angle !== undefined) {
      const half = fx.halfArcRad ?? 1.0;
      const startA = fx.angle - half;
      const endA = fx.angle + half;
      const outerR = fx.radius * 0.94;
      const thickness = fx.thickness ?? 26;
      const innerR = Math.max(14, outerR - thickness);
      const midA = fx.angle;

      // Thick crescent blade body
      ctx.fillStyle = 'rgba(34, 211, 238, 0.28)';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, outerR, startA, endA);
      ctx.arc(fx.x, fx.y, innerR, endA, startA, true);
      ctx.closePath();
      ctx.fill();

      // Bright cutting edge & trailing energy arc
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, outerR, startA, endA);
      ctx.stroke();

      ctx.strokeStyle = '#ecfeff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, outerR - 3, midA - half * 0.72, midA + half * 0.72);
      ctx.stroke();
    } else if (fx.kind === 'pulse' && fx.radius !== undefined) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * (1 - alpha * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'lightning' && fx.points && fx.points.length >= 2) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx.points[0].x, fx.points[0].y);
      for (let idx = 1; idx < fx.points.length; idx++) {
        ctx.lineTo(fx.points[idx].x, fx.points[idx].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Enemies (rendered when inside player's vision, or glowing ambush runners summoned by scout)
  for (const enemy of state.enemies) {
    if (!enemy.isAmbush && !isPointInPlayerVision(map, player.x, player.y, enemy.x, enemy.y)) {
      continue;
    }
    drawEnemyBody(ctx, enemy, nowSec);
  }

  // 8. Projectiles
  for (const proj of state.projectiles) {
    if (proj.kind === 'disc') {
      ctx.save();
      ctx.translate(proj.x, proj.y);
      ctx.rotate(proj.spinAngle ?? nowSec * 14);
      ctx.strokeStyle = proj.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, proj.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-proj.radius - 2, 0);
      ctx.lineTo(proj.radius + 2, 0);
      ctx.moveTo(0, -proj.radius - 2);
      ctx.lineTo(0, proj.radius + 2);
      ctx.stroke();
      ctx.restore();
    } else if (proj.kind === 'base' || proj.kind === 'reflected') {
      ctx.save();
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = proj.kind === 'reflected' ? '#ecfeff' : '#ecfdf5';
      ctx.lineWidth = proj.kind === 'reflected' ? 2 : 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const ep of state.enemyProjectiles) {
    if (!isPointInPlayerVision(map, player.x, player.y, ep.x, ep.y)) continue;
    ctx.fillStyle = ep.color ?? '#fb7185';
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, ep.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffe4e6';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // 9. Player & Aegis ready aura
  if (mods.hasAegisParry && player.aegisCooldown <= 0) {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  const blink = player.invulnTimer > 0 && Math.floor(nowSec * 20) % 2 === 0;
  if (!blink) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.facingAngle);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(6, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 10. Floating damage / pickup texts
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  for (const ft of state.floatingTexts) {
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // 10.5. Fog of War overlay (corridor circular light vs lit room)
  renderFogOverlay(ctx, width, height, zoom, camX, camY, state);

  // 11. Mini-map (top-right, responsive for smartphone portrait)
  renderMinimap(ctx, width, state);

  // 12. Virtual joystick indicator (if active)
  if (stick.active) {
    const dx = stick.currentX - stick.originX;
    const dy = stick.currentY - stick.originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, stick.maxRadius);
    const kx = dist > 0 ? stick.originX + (dx / dist) * clampedDist : stick.originX;
    const ky = dist > 0 ? stick.originY + (dy / dist) * clampedDist : stick.originY;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, stick.maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.beginPath();
    ctx.arc(kx, ky, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // 13. Toast Notifications (Level-up & Scout Alert) & Floor entry banner
  renderNotifications(ctx, width, state);

  if (state.floorBannerTimer > 0) {
    const isBoss = map.floorType === 'boss';
    const isGuardian = map.floorType === 'guardian';
    const bannerText = isBoss
      ? `BOSS FLOOR ${state.floor}F`
      : isGuardian
      ? `GUARDIAN ${state.floor}F`
      : `FLOOR ${state.floor}F`;
    const borderColor = isBoss ? '#f43f5e' : isGuardian ? '#facc15' : '#38bdf8';

    ctx.save();
    ctx.globalAlpha = Math.min(1, state.floorBannerTimer);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(width / 2 - 135, 74, 270, 42);
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(width / 2 - 135, 74, 270, 42);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bannerText, width / 2, 101);
    ctx.restore();
  }
}

function renderFogOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
  camX: number,
  camY: number,
  state: GameState
): void {
  const fCanvas = getFogCanvas(width, height);
  if (!fCanvas) return;
  const fCtx = fCanvas.getContext('2d');
  if (!fCtx) return;

  const { map, player } = state;
  const cw = fCanvas.width;
  const ch = fCanvas.height;

  fCtx.save();
  fCtx.globalCompositeOperation = 'source-over';
  fCtx.clearRect(0, 0, cw, ch);
  fCtx.fillStyle = 'rgba(5, 8, 17, 0.78)';
  fCtx.fillRect(0, 0, cw, ch);

  // Carve out current active vision
  fCtx.globalCompositeOperation = 'destination-out';

  const psx = (player.x - camX) * zoom;
  const psy = (player.y - camY) * zoom;
  const circleRadius = CORRIDOR_VISION_RADIUS * zoom;

  const grad = fCtx.createRadialGradient(psx, psy, circleRadius * 0.55, psx, psy, circleRadius);
  grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.88)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  fCtx.fillStyle = grad;
  fCtx.beginPath();
  fCtx.arc(psx, psy, circleRadius, 0, Math.PI * 2);
  fCtx.fill();

  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  const activeRoom = findRoomAtTile(map, ptx, pty);
  if (activeRoom) {
    const pad = TILE_SIZE * 0.75;
    const rx = (activeRoom.x * TILE_SIZE - pad - camX) * zoom;
    const ry = (activeRoom.y * TILE_SIZE - pad - camY) * zoom;
    const rw = (activeRoom.w * TILE_SIZE + pad * 2) * zoom;
    const rh = (activeRoom.h * TILE_SIZE + pad * 2) * zoom;

    fCtx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    fCtx.beginPath();
    if (typeof fCtx.roundRect === 'function') {
      fCtx.roundRect(rx, ry, rw, rh, 14 * zoom);
    } else {
      fCtx.rect(rx, ry, rw, rh);
    }
    fCtx.fill();
  }

  // Illuminate surroundings of scout-summoned ambush runners so they stand out in dark corridors
  for (const enemy of state.enemies) {
    if (!enemy.isAmbush) continue;
    const esx = (enemy.x - camX) * zoom;
    const esy = (enemy.y - camY) * zoom;
    const ambR = 64 * zoom;
    const ambGrad = fCtx.createRadialGradient(esx, esy, ambR * 0.25, esx, esy, ambR);
    ambGrad.addColorStop(0, 'rgba(0, 0, 0, 0.96)');
    ambGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.72)');
    ambGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fCtx.fillStyle = ambGrad;
    fCtx.beginPath();
    fCtx.arc(esx, esy, ambR, 0, Math.PI * 2);
    fCtx.fill();
  }

  fCtx.restore();

  ctx.save();
  ctx.drawImage(fCanvas, 0, 0, width, height);
  ctx.restore();
}

function renderNotifications(
  ctx: CanvasRenderingContext2D,
  width: number,
  state: GameState
): void {
  if (state.notifications.length === 0) return;

  ctx.save();
  let y = state.floorBannerTimer > 0 ? 126 : 74;
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';

  for (let i = state.notifications.length - 1; i >= 0; i--) {
    const n = state.notifications[i];
    const alpha = Math.min(1, n.life * 2);
    const tw = Math.min(width - 28, Math.max(210, ctx.measureText(n.text).width + 28));
    const x = width / 2 - tw / 2;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = n.kind === 'alert' ? 'rgba(69, 10, 10, 0.9)' : 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(x, y, tw, 30);
    ctx.strokeStyle = n.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, tw, 30);

    ctx.fillStyle = n.kind === 'alert' ? '#fed7aa' : '#f8fafc';
    ctx.fillText(n.text, width / 2, y + 19);
    y += 36;
  }
  ctx.restore();
}

function renderMinimap(ctx: CanvasRenderingContext2D, canvasWidth: number, state: GameState): void {
  const { map, explored, player } = state;
  const stairsLocked = getStairsLockCount(state) > 0;
  const isNarrow = canvasWidth < 540;
  const cell = isNarrow ? 2 : 3;
  const mapW = map.width * cell;
  const mapH = map.height * cell;
  const ox = canvasWidth - mapW - 12;
  const oy = isNarrow ? 94 : 64;

  ctx.save();
  ctx.fillStyle = 'rgba(7, 11, 20, 0.78)';
  ctx.fillRect(ox - 4, oy - 4, mapW + 8, mapH + 8);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.strokeRect(ox - 4, oy - 4, mapW + 8, mapH + 8);

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const idx = ty * map.width + tx;
      if (!explored[idx]) continue;
      const t = map.tiles[idx];
      if (t === 'wall') continue;
      ctx.fillStyle =
        t === 'stairs'
          ? stairsLocked
            ? '#fb7185'
            : '#22d3ee'
          : t === 'fountain'
          ? state.fountainUsed
            ? '#475569'
            : '#2dd4bf'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
    }
  }

  // Unopened chests within explored tiles
  ctx.fillStyle = '#fbbf24';
  for (const chest of state.chests) {
    if (chest.opened) continue;
    const ctxTx = Math.floor(chest.x / TILE_SIZE);
    const ctxTy = Math.floor(chest.y / TILE_SIZE);
    if (explored[ctxTy * map.width + ctxTx]) {
      ctx.fillRect(ox + ctxTx * cell, oy + ctxTy * cell, cell + 1, cell + 1);
    }
  }

  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(ox + ptx * cell - 1, oy + pty * cell - 1, cell + 2, cell + 2);
  ctx.restore();
}
