import type { Vec2 } from '../game/types';

export interface VirtualStickState {
  active: boolean;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  maxRadius: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private activePointerId: number | null = null;
  readonly stick: VirtualStickState = {
    active: false,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
    maxRadius: 44,
  };

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('touchstart', this.preventTouchDefault, { passive: false });
    target.addEventListener('touchmove', this.preventTouchDefault, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private readonly preventTouchDefault = (e: TouchEvent): void => {
    e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key.toLowerCase());
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.resetStick();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      this.target.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events that lack active pointer capture support
    }
    const rect = this.target.getBoundingClientRect();
    this.activePointerId = e.pointerId;
    this.stick.active = true;
    this.stick.originX = e.clientX - rect.left;
    this.stick.originY = e.clientY - rect.top;
    this.stick.currentX = this.stick.originX;
    this.stick.currentY = this.stick.originY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.stick.active || e.pointerId !== this.activePointerId) return;
    const rect = this.target.getBoundingClientRect();
    this.stick.currentX = e.clientX - rect.left;
    this.stick.currentY = e.clientY - rect.top;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    try {
      if (this.target.hasPointerCapture?.(e.pointerId)) {
        this.target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    this.resetStick();
  };

  private resetStick(): void {
    this.activePointerId = null;
    this.stick.active = false;
  }

  getMoveVector(): Vec2 {
    let x = 0;
    let y = 0;

    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;

    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    }

    if (this.stick.active) {
      const dx = this.stick.currentX - this.stick.originX;
      const dy = this.stick.currentY - this.stick.originY;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const clamped = Math.min(dist, this.stick.maxRadius) / this.stick.maxRadius;
        return {
          x: (dx / dist) * clamped,
          y: (dy / dist) * clamped,
        };
      }
    }

    return { x: 0, y: 0 };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('touchstart', this.preventTouchDefault);
    this.target.removeEventListener('touchmove', this.preventTouchDefault);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
