import { getActiveBossLaserWidth, isPointInPlayerVision } from '../../game/engine';
import type { GameState } from '../../game/types';
import { drawGlowSprite } from '../sprites';
import { setLineDashSafe } from './primitives';

export function renderMortarZones(ctx: CanvasRenderingContext2D, state: GameState): void {
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
}

export function renderBossLasers(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const laser of state.bossLasers ?? []) {
    const firstPt = laser.points[0];
    if (!firstPt || laser.points.length < 2) continue;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(firstPt.x, firstPt.y);
    for (let p = 1; p < laser.points.length; p++) {
      const pt = laser.points[p];
      if (!pt) continue;
      ctx.lineTo(pt.x, pt.y);
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
}

export function renderVisualFxAndParticles(ctx: CanvasRenderingContext2D, state: GameState): void {
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
    } else if (fx.kind === 'lightning' && fx.points && fx.points.length >= 2 && fx.points[0]) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(fx.points[0].x, fx.points[0].y);
      for (let idx = 1; idx < fx.points.length; idx++) {
        const pt = fx.points[idx];
        if (!pt) continue;
        ctx.lineTo(pt.x, pt.y);
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
}

export function renderProjectiles(ctx: CanvasRenderingContext2D, state: GameState, nowSec: number): void {
  const { map, player } = state;
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
        if (trail && trail.length >= 2 && trail[0]) {
          ctx.moveTo(trail[0].x, trail[0].y);
          for (let t = 1; t < trail.length; t++) {
            const pt = trail[t];
            if (!pt) continue;
            ctx.lineTo(pt.x, pt.y);
          }
          const last = trail[trail.length - 1];
          if (last && (last.x !== proj.x || last.y !== proj.y)) {
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
}

export function renderFloatingTexts(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  for (const ft of state.floatingTexts) {
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;
}
