import wallTileUrl from '../assets/wall-tile.webp';

export type GlowColor = 'cyan' | 'purple' | 'amber' | 'rose' | 'emerald' | 'pink' | 'white';

const GLOW_RGB: Record<GlowColor, readonly [number, number, number]> = {
  cyan: [34, 211, 238],
  purple: [168, 85, 247],
  amber: [251, 191, 36],
  rose: [244, 63, 94],
  emerald: [52, 211, 153],
  pink: [232, 121, 249],
  white: [224, 242, 254],
};

const GLOW_SPRITE_SIZE = 64;
const WALL_FALLBACK_SIZE = 64;

let wallImage: HTMLImageElement | null = null;
let wallLoadStarted = false;
let wallFallbackCanvas: HTMLCanvasElement | null = null;
const glowSpriteCache = new Map<GlowColor, HTMLCanvasElement>();

/**
 * Lazily starts loading wall-tile.webp in browser environments and returns
 * the cached HTMLImageElement once decoded and ready to draw.
 */
export function getWallTileImage(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;

  if (!wallLoadStarted) {
    wallLoadStarted = true;
    const img = new Image();
    img.decoding = 'async';
    img.src = wallTileUrl;
    wallImage = img;
  }

  if (wallImage?.complete && wallImage.naturalWidth > 0) {
    return wallImage;
  }
  return null;
}

/**
 * Procedural dark metallic sci-fi armor panel used when wall-tile.webp
 * is still loading or running in headless/Node environments.
 */
export function drawProceduralWallPanel(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pad = Math.max(2, size * 0.08);
  const inner = Math.max(4, size - pad * 2);
  const bevel = Math.max(2, size * 0.14);

  // Dark metallic base plate
  ctx.fillStyle = '#0c1528';
  ctx.fillRect(x, y, size, size);

  // Outer frame recess
  ctx.strokeStyle = '#070d1a';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

  // Chamfered inner armor block
  const ix = x + pad;
  const iy = y + pad;
  ctx.fillStyle = '#152441';
  ctx.beginPath();
  ctx.moveTo(ix + bevel, iy);
  ctx.lineTo(ix + inner - bevel, iy);
  ctx.lineTo(ix + inner, iy + bevel);
  ctx.lineTo(ix + inner, iy + inner - bevel);
  ctx.lineTo(ix + inner - bevel, iy + inner);
  ctx.lineTo(ix + bevel, iy + inner);
  ctx.lineTo(ix, iy + inner - bevel);
  ctx.lineTo(ix, iy + bevel);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Recessed central tech seam
  const midPad = Math.max(4, size * 0.28);
  const midSize = Math.max(4, size - midPad * 2);
  ctx.fillStyle = '#101d35';
  ctx.fillRect(x + midPad, y + midPad, midSize, midSize);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.strokeRect(x + midPad, y + midPad, midSize, midSize);

  // Subtle top-left metallic sheen
  ctx.fillStyle = 'rgba(125, 211, 252, 0.08)';
  ctx.fillRect(ix + bevel, iy + 1, Math.max(2, inner - bevel * 2), Math.max(1.5, size * 0.06));
}

function getWallFallbackCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (wallFallbackCanvas) return wallFallbackCanvas;

  const canvas = document.createElement('canvas');
  canvas.width = WALL_FALLBACK_SIZE;
  canvas.height = WALL_FALLBACK_SIZE;
  const offCtx = canvas.getContext('2d');
  if (!offCtx) return null;

  drawProceduralWallPanel(offCtx, 0, 0, WALL_FALLBACK_SIZE);
  wallFallbackCanvas = canvas;
  return wallFallbackCanvas;
}

/**
 * Draws a sci-fi metallic wall tile using the loaded WebP sprite when ready,
 * falling back to a cached offscreen or direct procedural panel.
 */
export function drawWallTile(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const img = getWallTileImage();
  if (img && typeof ctx.drawImage === 'function') {
    ctx.drawImage(img, x, y, size, size);
    return;
  }

  const fallback = getWallFallbackCanvas();
  if (fallback && typeof ctx.drawImage === 'function') {
    ctx.drawImage(fallback, x, y, size, size);
    return;
  }

  drawProceduralWallPanel(ctx, x, y, size);
}

/**
 * Returns a pre-baked offscreen radial glow canvas for zero-shadowBlur neon bloom.
 */
export function getGlowSprite(color: GlowColor): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cached = glowSpriteCache.get(color);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = GLOW_SPRITE_SIZE;
  canvas.height = GLOW_SPRITE_SIZE;
  const gCtx = canvas.getContext('2d');
  if (!gCtx || typeof gCtx.createRadialGradient !== 'function') return null;

  const [r, g, b] = GLOW_RGB[color];
  const half = GLOW_SPRITE_SIZE / 2;
  const grad = gCtx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.92)`);
  grad.addColorStop(0.28, `rgba(${r}, ${g}, ${b}, 0.52)`);
  grad.addColorStop(0.62, `rgba(${r}, ${g}, ${b}, 0.16)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  gCtx.fillStyle = grad;
  gCtx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);

  glowSpriteCache.set(color, canvas);
  return canvas;
}

/**
 * Draws a pre-baked neon radial glow centered at (x, y) without using ctx.shadowBlur.
 * Gracefully degrades to a translucent circle in headless/mock Canvas contexts.
 */
export function drawGlowSprite(
  ctx: CanvasRenderingContext2D,
  color: GlowColor,
  x: number,
  y: number,
  radius: number,
  alpha = 1,
  additive = false,
): void {
  if (radius <= 0 || alpha <= 0) return;

  const sprite = getGlowSprite(color);
  ctx.save();
  if (additive) {
    ctx.globalCompositeOperation = 'lighter';
  }
  const baseAlpha = typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1;
  ctx.globalAlpha = baseAlpha * Math.min(1, alpha);

  if (sprite && typeof ctx.drawImage === 'function') {
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const [r, g, b] = GLOW_RGB[color];
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.28)`;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
