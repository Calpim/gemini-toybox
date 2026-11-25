import { findRoomAtTile, TILE_SIZE } from '../../core/dungeon';
import { CORRIDOR_VISION_RADIUS } from '../../game/engine';
import type { GameState } from '../../game/types';

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

export function renderFogOverlay(
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
