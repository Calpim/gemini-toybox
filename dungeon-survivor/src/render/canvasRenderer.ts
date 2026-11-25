import { TILE_SIZE, findRoomAtTile, getTile, tileCenterWorld, type DungeonMap } from '../core/dungeon';
import {
  CORRIDOR_VISION_RADIUS,
  getActiveBossLaserWidth,
  getOrbitBitPositions,
  getSeekerDronePositions,
  getStairsLockCount,
  isPointInPlayerVision,
} from '../game/engine';
import { EQUIPMENT_CATALOG, MAX_TARGET_RANGE, getOrbitShieldRadius, getSeekerDroneRange } from '../game/equipment';
import { computeSkillModifiers } from '../game/skillTree';
import type { EnemyState, GameState } from '../game/types';
import type { VirtualStickState } from '../input/controller';
import { drawGlowSprite, drawWallTile, type GlowColor } from './sprites';

export const TARGET_VIEW_WORLD_WIDTH = 840; // ~21 tiles across on desktop/web

export interface HudSafeInsets {
  /** Bottom Y coordinate (in CSS px) of the top HUD bar */
  hudBottom?: number;
  /** Top Y coordinate (in CSS px) of the bottom hint bar */
  hintTop?: number;
  /** When true, skips drawing the legacy in-canvas minimap */
  hideCanvasMinimap?: boolean;
  /** When true, skips drawing the legacy in-canvas notification toasts */
  hideCanvasNotifications?: boolean;
}

export interface NotificationLayout {
  isCompact: boolean;
  boxHeight: number;
  gap: number;
  fontSize: number;
  minWidth: number;
  maxWidth: number;
  bottomAnchorY: number;
}

export function computeCameraZoom(viewportWidth: number, viewportHeight: number): number {
  const widthZoom = Math.max(0.72, viewportWidth / TARGET_VIEW_WORLD_WIDTH);
  const heightMaxZoom = Math.max(0.72, viewportHeight / 480);
  return Math.min(2.4, widthZoom, heightMaxZoom);
}

export function computeTopSafeY(canvasWidth: number, hudBottom?: number): number {
  if (typeof hudBottom === 'number' && Number.isFinite(hudBottom) && hudBottom > 0) {
    return Math.ceil(hudBottom + 10);
  }
  return canvasWidth < 540 ? 104 : 74;
}

export function computeNotificationLayout(
  canvasWidth: number,
  canvasHeight: number,
  hintTop?: number,
): NotificationLayout {
  const isCompact = canvasWidth < 540;
  const defaultHintTop = canvasHeight - 38;
  const safeHintTop =
    typeof hintTop === 'number' && Number.isFinite(hintTop) && hintTop > 0
      ? Math.min(hintTop, canvasHeight)
      : defaultHintTop;
  const bottomAnchorY = Math.max(80, Math.floor(safeHintTop - 10));
  return {
    isCompact,
    boxHeight: isCompact ? 32 : 38,
    gap: isCompact ? 6 : 8,
    fontSize: isCompact ? 14 : 16,
    minWidth: isCompact ? 180 : 240,
    maxWidth: Math.max(120, canvasWidth - (isCompact ? 28 : 48)),
    bottomAnchorY,
  };
}

export function computeFloorBannerRect(
  canvasWidth: number,
  canvasHeight: number,
  topSafeY: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(270, Math.max(180, canvasWidth - 32));
  const height = 42;
  const x = canvasWidth / 2 - width / 2;
  const y = Math.max(topSafeY, Math.round(canvasHeight / 2 - height / 2));
  return { x, y, width, height };
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

function setLineDashSafe(ctx: CanvasRenderingContext2D, segments: number[]): void {
  if (typeof ctx.setLineDash === 'function') {
    ctx.setLineDash(segments);
  }
}

function traceCutCornerRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  const c = Math.max(0, Math.min(cut, w * 0.25, h * 0.45));
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function drawWallEdgesAndNotches(
  ctx: CanvasRenderingContext2D,
  map: DungeonMap,
  tx: number,
  ty: number,
  px: number,
  py: number,
): void {
  const openTop = getTile(map, tx, ty - 1) !== 'wall';
  const openBottom = getTile(map, tx, ty + 1) !== 'wall';
  const openLeft = getTile(map, tx - 1, ty) !== 'wall';
  const openRight = getTile(map, tx + 1, ty) !== 'wall';

  const glowDepth = 6;
  const rimWidth = 2;

  // Floor-facing cyan neon rim highlights + subtle inward cyan sheen
  if (openTop) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py, TILE_SIZE, glowDepth);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py, TILE_SIZE, rimWidth);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py, TILE_SIZE, 1);
  }
  if (openBottom) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py + TILE_SIZE - glowDepth, TILE_SIZE, glowDepth);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py + TILE_SIZE - rimWidth, TILE_SIZE, rimWidth);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py + TILE_SIZE - 1, TILE_SIZE, 1);
  }
  if (openLeft) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py, glowDepth, TILE_SIZE);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py, rimWidth, TILE_SIZE);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py, 1, TILE_SIZE);
  }
  if (openRight) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px + TILE_SIZE - glowDepth, py, glowDepth, TILE_SIZE);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px + TILE_SIZE - rimWidth, py, rimWidth, TILE_SIZE);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px + TILE_SIZE - 1, py, 1, TILE_SIZE);
  }

  // Convex corner accent caps (doorway / pillar edges where two open sides meet)
  const cap = 4;
  ctx.fillStyle = 'rgba(165, 243, 252, 0.92)';
  if (openTop && openLeft) ctx.fillRect(px, py, cap, cap);
  if (openTop && openRight) ctx.fillRect(px + TILE_SIZE - cap, py, cap, cap);
  if (openBottom && openLeft) ctx.fillRect(px, py + TILE_SIZE - cap, cap, cap);
  if (openBottom && openRight) ctx.fillRect(px + TILE_SIZE - cap, py + TILE_SIZE - cap, cap, cap);

  // Concave chamber corner accent notches (diagonal neighbor is open floor while orthogonal neighbors are walls)
  const notch = 7;
  const drawOuterCornerSlash = (x1: number, y1: number, x2: number, y2: number, ix: number, iy: number) => {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(165, 243, 252, 0.85)';
    ctx.fillRect(ix, iy, 2.5, 2.5);
  };

  if (!openBottom && !openRight && getTile(map, tx + 1, ty + 1) !== 'wall') {
    drawOuterCornerSlash(px + 2, py + notch, px + notch, py + 2, px + TILE_SIZE - 2.5, py + TILE_SIZE - 2.5);
  }
  if (!openBottom && !openLeft && getTile(map, tx - 1, ty + 1) !== 'wall') {
    drawOuterCornerSlash(px + TILE_SIZE - notch, py + 2, px + TILE_SIZE - 2, py + notch, px, py + TILE_SIZE - 2.5);
  }
  if (!openTop && !openRight && getTile(map, tx + 1, ty - 1) !== 'wall') {
    drawOuterCornerSlash(px + 2, py + TILE_SIZE - notch, px + notch, py + TILE_SIZE - 2, px + TILE_SIZE - 2.5, py);
  }
  if (!openTop && !openLeft && getTile(map, tx - 1, ty - 1) !== 'wall') {
    drawOuterCornerSlash(
      px + TILE_SIZE - notch,
      py + TILE_SIZE - 2,
      px + TILE_SIZE - 2,
      py + TILE_SIZE - notch,
      px,
      py,
    );
  }
}

function drawFloorStardust(
  ctx: CanvasRenderingContext2D,
  map: DungeonMap,
  tx: number,
  ty: number,
  px: number,
  py: number,
  nowSec: number,
): void {
  const nearWall =
    getTile(map, tx - 1, ty) === 'wall' ||
    getTile(map, tx + 1, ty) === 'wall' ||
    getTile(map, tx, ty - 1) === 'wall' ||
    getTile(map, tx, ty + 1) === 'wall';

  const seed = Math.imul(tx + 31, 374761393) ^ Math.imul(ty + 17, 668265263);
  const h = (seed ^ (seed >>> 13)) >>> 0;
  const threshold = nearWall ? 0.7 : 0.22;
  if ((h & 0xff) / 255 > threshold) return;

  const count = nearWall && ((h >>> 8) & 1) === 1 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const sh = Math.imul(h ^ (i * 2246822519), 3266489917) >>> 0;
    const fx = ((sh & 0xff) / 255) * (TILE_SIZE - 6) + 3;
    const fy = (((sh >>> 8) & 0xff) / 255) * (TILE_SIZE - 6) + 3;
    const phase = (((sh >>> 16) & 0xff) / 255) * Math.PI * 2;
    const speed = 1.1 + (((sh >>> 24) & 0x0f) / 15) * 1.4;

    const driftX = Math.sin(nowSec * speed * 0.7 + phase) * 2.2;
    const driftY = Math.cos(nowSec * speed + phase) * 2.6;
    const twinkle = 0.16 + 0.52 * (0.5 + 0.5 * Math.sin(nowSec * (speed + 0.8) + phase * 1.7));
    const size = ((sh >>> 28) & 3) === 0 ? 2 : 1.35;
    const isBright = ((sh >>> 30) & 1) === 1;

    ctx.fillStyle = isBright
      ? `rgba(224, 242, 254, ${(twinkle * 0.85).toFixed(3)})`
      : `rgba(56, 189, 248, ${twinkle.toFixed(3)})`;
    ctx.fillRect(px + fx + driftX, py + fy + driftY, size, size);
  }
}

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

export function renderGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  stick: VirtualStickState,
  nowSec: number,
  insets: HudSafeInsets = {},
): void {
  const { map, player, explored } = state;
  const mods = computeSkillModifiers(player.skillLevels);
  const stairsLockCount = getStairsLockCount(state);
  const topSafeY = computeTopSafeY(width, insets.hudBottom);

  ctx.fillStyle = '#040711';
  ctx.fillRect(0, 0, width, height);

  const zoom = computeCameraZoom(width, height);
  const viewW = width / zoom;
  const viewH = height / zoom;
  let camX = player.x - viewW / 2;
  let camY = player.y - viewH / 2;
  if ((state.shakeTimer ?? 0) > 0 && (state.shakeIntensity ?? 0) > 0) {
    const amp = (state.shakeIntensity ?? 0) * Math.min(1, (state.shakeTimer ?? 0) * 6);
    camX += Math.sin(nowSec * 97) * amp;
    camY += Math.cos(nowSec * 113) * amp;
  }

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
        drawWallTile(ctx, px, py, TILE_SIZE);
        drawWallEdgesAndNotches(ctx, map, tx, ty, px, py);
      } else {
        // Deep navy checkerboard floor with subtle cyan-tinted grid hairline
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#080e1d' : '#0c1529';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

        // Deterministic floating cyan/white stardust particles
        drawFloorStardust(ctx, map, tx, ty, px, py, nowSec);

        if (tile === 'stairs') {
          const pulse = 0.7 + 0.3 * Math.sin(nowSec * 4.5);
          const center = tileCenterWorld(tx, ty);
          const locked = stairsLockCount > 0;
          drawGlowSprite(ctx, locked ? 'rose' : 'cyan', center.x, center.y, TILE_SIZE * 0.95, 0.45 * pulse, true);
          ctx.save();
          ctx.fillStyle = locked ? `rgba(244, 63, 94, ${0.22 * pulse})` : `rgba(34, 211, 238, ${0.2 * pulse})`;
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
          if (!used) {
            drawGlowSprite(ctx, 'emerald', center.x, center.y, TILE_SIZE * 0.9, 0.42 * pulse, true);
          }
          ctx.save();
          ctx.fillStyle = used ? 'rgba(51, 65, 85, 0.35)' : `rgba(45, 212, 191, ${0.26 * pulse})`;
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

    if (!chest.opened) {
      const glow = 0.75 + 0.25 * Math.sin(nowSec * 5);
      drawGlowSprite(ctx, 'amber', chest.x, chest.y, 26, 0.42 * glow, true);
    }

    ctx.save();
    ctx.translate(chest.x, chest.y);
    if (chest.opened) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-11, -8, 22, 16);
    } else {
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
      drawGlowSprite(ctx, 'emerald', p.x, p.y, 17, 0.42, true);
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
      drawGlowSprite(ctx, 'amber', p.x, p.y, 22, 0.5 * pulse, true);
      ctx.save();
      ctx.translate(p.x, p.y);
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
      drawGlowSprite(ctx, 'cyan', p.x, p.y, 12, 0.35, true);
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

  // 5.5. Tank parabolic mortar landing telegraphs & airborne shells
  for (const zone of state.mortarZones) {
    if (zone.elapsed < 0) continue;
    const progress = Math.max(0, Math.min(1, zone.elapsed / Math.max(0.01, zone.duration)));
    ctx.save();
    // Target danger zone fill & outer border
    ctx.fillStyle = `rgba(168, 85, 247, ${0.14 + progress * 0.14})`;
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(216, 180, 254, 0.88)';
    ctx.lineWidth = 2;
    setLineDashSafe(ctx, [5, 4]);
    ctx.beginPath();
    ctx.arc(zone.targetX, zone.targetY, zone.radius, 0, Math.PI * 2);
    ctx.stroke();
    setLineDashSafe(ctx, []);

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

    drawGlowSprite(ctx, 'purple', shellGroundX, shellGroundY - arcHeight, 15, 0.55, true);
    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(shellGroundX, shellGroundY - arcHeight, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fae8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // 5.6. Grand Boss wall-reflecting laser beams (telegraph -> additive-blended high-energy beam)
  for (const laser of state.bossLasers ?? []) {
    if (laser.points.length < 2) continue;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(laser.points[0].x, laser.points[0].y);
    for (let p = 1; p < laser.points.length; p++) {
      ctx.lineTo(laser.points[p].x, laser.points[p].y);
    }
    if (laser.elapsed < laser.windup) {
      const progress = Math.max(0, Math.min(1, laser.elapsed / Math.max(0.01, laser.windup)));
      ctx.strokeStyle = `rgba(244, 63, 94, ${0.1 + progress * 0.12})`;
      ctx.lineWidth = laser.width;
      ctx.stroke();

      ctx.strokeStyle = `rgba(244, 63, 94, ${0.4 + progress * 0.55})`;
      ctx.lineWidth = 1.8 + progress * 2.2;
      setLineDashSafe(ctx, [8, 6]);
      ctx.stroke();
      setLineDashSafe(ctx, []);
    } else {
      const curWidth = getActiveBossLaserWidth(laser);
      const activeSpan = Math.max(0.01, laser.duration - laser.windup);
      const fade = Math.max(0, 1 - (laser.elapsed - laser.windup) / activeSpan);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + fade * 0.6;

      ctx.strokeStyle = 'rgba(217, 70, 239, 0.42)';
      ctx.lineWidth = curWidth * 2.4;
      ctx.stroke();

      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = curWidth * 1.45;
      ctx.stroke();

      ctx.strokeStyle = '#fdf4ff';
      ctx.lineWidth = curWidth * 0.6;
      ctx.stroke();

      for (const pt of laser.points) {
        drawGlowSprite(ctx, 'pink', pt.x, pt.y, curWidth * 1.9, 0.65 * fade, false);
      }
    }
    ctx.restore();
  }

  // 6. Visual FX (Additive-blended Thick crescent Slash / Lightning / Pulse)
  for (const fx of state.visualFx) {
    const alpha = Math.max(0, fx.life / fx.maxLife);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
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
      ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, outerR, startA, endA);
      ctx.arc(fx.x, fx.y, innerR, endA, startA, true);
      ctx.closePath();
      ctx.fill();

      // Wide outer bloom arc + bright cutting edge
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, outerR, startA, endA);
      ctx.stroke();

      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 4.5;
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
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * (1 - alpha * 0.4), 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ecfeff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * (1 - alpha * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'lightning' && fx.points && fx.points.length >= 2) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(fx.points[0].x, fx.points[0].y);
      for (let idx = 1; idx < fx.points.length; idx++) {
        ctx.lineTo(fx.points[idx].x, fx.points[idx].y);
      }
      ctx.stroke();

      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2.6;
      ctx.stroke();

      ctx.strokeStyle = '#f0f9ff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6.5. Particles (additive glowing hit sparks, death bursts, pickup sparkles)
  if (state.particles && state.particles.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of state.particles) {
      const alpha = Math.max(0, Math.min(1, pt.life / Math.max(0.01, pt.maxLife)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius * (0.45 + alpha * 0.55), 0, Math.PI * 2);
      ctx.fill();
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

  // 8. Projectiles (additive bloom for beams and energy shots)
  for (const proj of state.projectiles) {
    if (proj.kind === 'disc') {
      const glow = 0.65 + 0.35 * Math.sin(nowSec * 14);
      drawGlowSprite(ctx, 'amber', proj.x, proj.y, proj.radius * 3.1, 0.55 * glow, true);
      ctx.save();
      ctx.translate(proj.x, proj.y);

      ctx.strokeStyle = `rgba(254, 240, 138, ${0.78 * glow})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, proj.radius + 4 + glow * 2.2, 0, Math.PI * 2);
      ctx.stroke();

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
    } else if (proj.kind === 'base') {
      const ocLv = proj.overclockLevel ?? 0;
      const baseLv = proj.baseLevel ?? 0;
      const angle = Math.atan2(proj.vy, proj.vx);

      if (ocLv >= 1 && !proj.isCenterCharge) {
        const beamLen = Math.min(92, 56 + (ocLv >= 2 ? 12 : 0) + baseLv * 5);
        const baseScale = 1 + baseLv * 0.08 + (ocLv >= 2 ? 0.08 : 0);
        const halfW = Math.max(1.2, proj.radius * 0.24 * baseScale);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(proj.x, proj.y);
        ctx.rotate(angle);
        ctx.lineCap = 'round';

        // Tight outer cyan neon bloom (slim so parallel beams stay crisp and distinct)
        ctx.strokeStyle = ocLv >= 2 ? 'rgba(6, 182, 212, 0.36)' : 'rgba(6, 182, 212, 0.28)';
        ctx.lineWidth = halfW * 2.8;
        ctx.beginPath();
        ctx.moveTo(-beamLen, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();

        // Mid intense turquoise energy sheath
        ctx.strokeStyle = ocLv >= 2 ? 'rgba(45, 212, 191, 0.72)' : 'rgba(34, 211, 238, 0.65)';
        ctx.lineWidth = halfW * 1.65;
        ctx.beginPath();
        ctx.moveTo(-beamLen * 0.95, 0);
        ctx.lineTo(4, 0);
        ctx.stroke();

        // Bright slim beam body
        ctx.strokeStyle = proj.color;
        ctx.lineWidth = halfW * 1.05;
        ctx.beginPath();
        ctx.moveTo(-beamLen * 0.88, 0);
        ctx.lineTo(5, 0);
        ctx.stroke();

        // Razor-sharp white-cyan core
        ctx.strokeStyle = '#f0fdfa';
        ctx.lineWidth = Math.max(1.0, halfW * 0.55);
        ctx.beginPath();
        ctx.moveTo(-beamLen * 0.78, 0);
        ctx.lineTo(6, 0);
        ctx.stroke();

        drawGlowSprite(ctx, 'cyan', 2, 0, halfW * 2.0, 0.45, false);
        ctx.restore();
      } else {
        const isOverclockCharge = ocLv >= 1;
        const isBigCharge = baseLv >= 5 || ocLv >= 2;
        const isMidCharge = baseLv >= 3 || isOverclockCharge;
        const glowRadius = proj.radius * (isBigCharge ? 3.2 : isMidCharge ? 2.9 : 2.5);
        drawGlowSprite(
          ctx,
          isOverclockCharge ? 'cyan' : 'emerald',
          proj.x,
          proj.y,
          glowRadius,
          isBigCharge ? 0.62 : 0.48,
          true,
        );
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(proj.x, proj.y);
        ctx.rotate(angle);

        const rx = proj.radius * (isBigCharge ? 1.85 : isMidCharge ? 1.55 : 1.25);
        const ry = proj.radius * (isBigCharge ? 1.08 : isMidCharge ? 0.96 : 0.88);
        const tailLen = isOverclockCharge ? (isBigCharge ? 42 : 30) : isBigCharge ? 32 : isMidCharge ? 22 : 10;

        // Energy charge wake / plasma tail
        const tailGrad = ctx.createLinearGradient(-tailLen - rx * 0.4, 0, rx * 0.6, 0);
        tailGrad.addColorStop(0, isOverclockCharge ? 'rgba(6, 182, 212, 0)' : 'rgba(16, 185, 129, 0)');
        tailGrad.addColorStop(
          0.55,
          isOverclockCharge
            ? 'rgba(34, 211, 238, 0.58)'
            : isBigCharge
              ? 'rgba(52, 211, 153, 0.52)'
              : 'rgba(52, 211, 153, 0.36)',
        );
        tailGrad.addColorStop(1, isOverclockCharge ? 'rgba(207, 250, 254, 0.9)' : 'rgba(167, 243, 208, 0.82)');
        ctx.fillStyle = tailGrad;
        ctx.beginPath();
        ctx.moveTo(rx * 0.35, -ry * 0.92);
        ctx.quadraticCurveTo(-tailLen * 0.45, -ry * 0.65, -tailLen - rx * 0.35, 0);
        ctx.quadraticCurveTo(-tailLen * 0.45, ry * 0.65, rx * 0.35, ry * 0.92);
        ctx.closePath();
        ctx.fill();

        // Outer plasma shell (oval charge shot silhouette)
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        // Mid glowing sheath
        ctx.fillStyle = isOverclockCharge
          ? 'rgba(165, 243, 252, 0.9)'
          : isBigCharge
            ? 'rgba(167, 243, 208, 0.88)'
            : 'rgba(167, 243, 208, 0.72)';
        ctx.beginPath();
        ctx.ellipse(rx * 0.1, 0, rx * 0.76, ry * 0.68, 0, 0, Math.PI * 2);
        ctx.fill();

        // Blazing white-hot core
        ctx.fillStyle = '#f0fdfa';
        ctx.beginPath();
        ctx.ellipse(rx * 0.22, 0, rx * 0.48, ry * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();

        // Crisp rim highlight for charge shot depth
        ctx.strokeStyle = isOverclockCharge
          ? 'rgba(236, 254, 255, 0.95)'
          : isBigCharge
            ? 'rgba(236, 253, 245, 0.92)'
            : 'rgba(236, 253, 245, 0.72)';
        ctx.lineWidth = isBigCharge ? 2.0 : isMidCharge ? 1.6 : 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      }
    } else if (proj.kind === 'base_homing') {
      const angle = Math.atan2(proj.vy, proj.vx);
      const isPreHoming = (proj.orbitTimer ?? 0) > 0 || (proj.expandTimer ?? 0) > 0;
      const trail = proj.trail;
      const traceRibbon = () => {
        ctx.beginPath();
        if (trail && trail.length >= 2) {
          ctx.moveTo(trail[0].x, trail[0].y);
          for (let t = 1; t < trail.length; t++) {
            ctx.lineTo(trail[t].x, trail[t].y);
          }
          const last = trail[trail.length - 1];
          if (last.x !== proj.x || last.y !== proj.y) {
            ctx.lineTo(proj.x, proj.y);
          }
        } else {
          const tailLen = isPreHoming ? 16 : 22;
          ctx.moveTo(proj.x - Math.cos(angle) * tailLen, proj.y - Math.sin(angle) * tailLen);
          ctx.lineTo(proj.x, proj.y);
        }
      };

      drawGlowSprite(ctx, 'emerald', proj.x, proj.y, proj.radius * 2.2, 0.48, true);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer glowing cyan/emerald laser aura
      ctx.strokeStyle = isPreHoming ? 'rgba(45, 212, 191, 0.34)' : 'rgba(45, 212, 191, 0.44)';
      ctx.lineWidth = isPreHoming ? 5.2 : 6.2;
      traceRibbon();
      ctx.stroke();

      // Mid emerald-mint laser body
      ctx.strokeStyle = isPreHoming ? 'rgba(110, 231, 183, 0.72)' : 'rgba(110, 231, 183, 0.85)';
      ctx.lineWidth = isPreHoming ? 2.6 : 3.0;
      traceRibbon();
      ctx.stroke();

      // Bright thin white-mint core
      ctx.strokeStyle = '#ecfdf5';
      ctx.lineWidth = 1.3;
      traceRibbon();
      ctx.stroke();

      // Sharp glowing tip
      ctx.fillStyle = '#f0fdfa';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (proj.kind === 'reflected') {
      drawGlowSprite(ctx, 'cyan', proj.x, proj.y, proj.radius * 2.8, 0.55, true);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ecfeff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else {
      drawGlowSprite(ctx, 'cyan', proj.x, proj.y, proj.radius * 2.3, 0.4, true);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (const ep of state.enemyProjectiles) {
    if (!isPointInPlayerVision(map, player.x, player.y, ep.x, ep.y)) continue;
    drawGlowSprite(
      ctx,
      ep.pierceDefense ? 'pink' : 'rose',
      ep.x,
      ep.y,
      ep.radius * (ep.pierceDefense ? 2.8 : 2.2),
      ep.pierceDefense ? 0.55 : 0.4,
      true,
    );
    if (ep.pierceDefense) {
      ctx.fillStyle = 'rgba(232, 121, 249, 0.28)';
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, ep.radius + 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ep.color ?? '#fb7185';
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, ep.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ep.pierceDefense ? '#fdf4ff' : '#ffe4e6';
    ctx.lineWidth = ep.pierceDefense ? 1.8 : 1.3;
    ctx.stroke();
  }

  // 9. Player & Aegis ready aura
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

  // 11. Legacy in-canvas Mini-map (skipped when HUD renders dedicated minimap canvas)
  if (!insets.hideCanvasMinimap) {
    renderMinimap(ctx, width, state, topSafeY);
  }

  // 12. Virtual joystick indicator (if active)
  if (stick.active) {
    const dx = stick.currentX - stick.originX;
    const dy = stick.currentY - stick.originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, stick.maxRadius);
    const kx = dist > 0 ? stick.originX + (dx / dist) * clampedDist : stick.originX;
    const ky = dist > 0 ? stick.originY + (dy / dist) * clampedDist : stick.originY;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, stick.maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(34, 211, 238, 0.55)';
    ctx.beginPath();
    ctx.arc(kx, ky, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // 13. Legacy in-canvas Toast Notifications (skipped when HUD renders DOM notifications)
  if (!insets.hideCanvasNotifications) {
    renderNotifications(ctx, width, height, state, insets.hintTop);
  }

  // 14. Sleek sci-fi cut-corner Floor Entry Banner
  if (state.floorBannerTimer > 0) {
    const isBoss = map.floorType === 'boss';
    const isGuardian = map.floorType === 'guardian';
    const bannerText = isBoss
      ? `BOSS FLOOR ${state.floor}F`
      : isGuardian
        ? `GUARDIAN ${state.floor}F`
        : `FLOOR ${state.floor}F`;
    const borderColor = isBoss ? '#f43f5e' : isGuardian ? '#facc15' : '#38bdf8';
    const glowStroke = isBoss
      ? 'rgba(244, 63, 94, 0.32)'
      : isGuardian
        ? 'rgba(250, 204, 21, 0.32)'
        : 'rgba(56, 189, 248, 0.34)';
    const banner = computeFloorBannerRect(width, height, topSafeY);

    ctx.save();
    ctx.globalAlpha = Math.min(1, state.floorBannerTimer);

    traceCutCornerRect(ctx, banner.x, banner.y, banner.width, banner.height, 10);
    if (typeof ctx.createLinearGradient === 'function') {
      const grad = ctx.createLinearGradient(banner.x, banner.y, banner.x, banner.y + banner.height);
      grad.addColorStop(0, 'rgba(12, 24, 48, 0.92)');
      grad.addColorStop(1, 'rgba(5, 11, 24, 0.88)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(6, 14, 30, 0.88)';
    }
    ctx.fill();

    // Soft outer neon border glow (zero shadowBlur)
    ctx.strokeStyle = glowStroke;
    ctx.lineWidth = 5;
    ctx.stroke();

    // Crisp neon frame stroke
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Side cyber accent bars inside banner
    ctx.fillStyle = borderColor;
    ctx.fillRect(banner.x + 12, banner.y + 11, 3, banner.height - 22);
    ctx.fillRect(banner.x + banner.width - 15, banner.y + 11, 3, banner.height - 22);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bannerText, width / 2, banner.y + 27);
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
  state: GameState,
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

  // Illuminate surroundings of glowing ricochet discs
  for (const proj of state.projectiles) {
    if (proj.kind !== 'disc') continue;
    const dsx = (proj.x - camX) * zoom;
    const dsy = (proj.y - camY) * zoom;
    const discR = 46 * zoom;
    const discGrad = fCtx.createRadialGradient(dsx, dsy, discR * 0.25, dsx, dsy, discR);
    discGrad.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
    discGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.65)');
    discGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fCtx.fillStyle = discGrad;
    fCtx.beginPath();
    fCtx.arc(dsx, dsy, discR, 0, Math.PI * 2);
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
  height: number,
  state: GameState,
  hintTop?: number,
): void {
  if (state.notifications.length === 0) return;

  const layout = computeNotificationLayout(width, height, hintTop);
  ctx.save();
  ctx.font = `bold ${layout.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let bottomY = layout.bottomAnchorY;
  const startIdx = state.notifications.length - 1;
  const minIdx = Math.max(0, state.notifications.length - 3);

  for (let i = startIdx; i >= minIdx; i--) {
    const n = state.notifications[i];
    const alpha = Math.min(1, n.life * 2.5);
    const padX = layout.isCompact ? 28 : 34;
    const tw = Math.min(layout.maxWidth, Math.max(layout.minWidth, ctx.measureText(n.text).width + padX));
    const x = width / 2 - tw / 2;
    const boxY = bottomY - layout.boxHeight;
    if (boxY < 0) break;

    const radius = Math.min(10, layout.boxHeight / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = n.kind === 'alert' ? 'rgba(69, 10, 10, 0.9)' : 'rgba(15, 23, 42, 0.88)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, boxY, tw, layout.boxHeight, radius);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = n.kind === 'alert' ? 'rgba(248, 113, 113, 0.45)' : 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Left accent bar inside rounded card
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.roundRect(x + 6, boxY + 6, 3.5, layout.boxHeight - 12, 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, boxY, tw, layout.boxHeight);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = n.color;
      ctx.fillRect(x + 5, boxY + 5, 3, layout.boxHeight - 10);
    }

    ctx.fillStyle = n.kind === 'alert' ? '#fed7aa' : '#f8fafc';
    ctx.fillText(n.text, width / 2 + 2, boxY + layout.boxHeight / 2 + 0.5, tw - 22);
    ctx.restore();
    bottomY -= layout.boxHeight + layout.gap;
  }
  ctx.restore();
}

function renderMinimap(ctx: CanvasRenderingContext2D, canvasWidth: number, state: GameState, topSafeY: number): void {
  const { map, explored, player } = state;
  const stairsLocked = getStairsLockCount(state) > 0;
  const isNarrow = canvasWidth < 540;
  const cell = isNarrow ? 2 : 3;
  const mapW = map.width * cell;
  const mapH = map.height * cell;
  const ox = canvasWidth - mapW - 12;
  const oy = topSafeY;

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
