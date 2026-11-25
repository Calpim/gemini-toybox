export function setLineDashSafe(ctx: CanvasRenderingContext2D, segments: number[]): void {
  if (typeof ctx.setLineDash === 'function') {
    ctx.setLineDash(segments);
  }
}

export function traceCutCornerRect(
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
