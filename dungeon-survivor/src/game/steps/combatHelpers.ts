import { hasLineOfSight } from '../../core/collision';
import { emitSound, spawnParticles } from '../effects';
import { MAX_TARGET_RANGE } from '../equipment';
import type { EnemyState, GameState, Vec2 } from '../types';

export function damageEnemy(state: GameState, enemy: EnemyState, amount: number, bypassDashInvuln = false): void {
  const isDashInvuln = Boolean(enemy.isRoomBoss || enemy.isGrandBoss) && enemy.dashState === 'dashing';
  if (isDashInvuln && !bypassDashInvuln) {
    enemy.hitFlash = 0.06;
    spawnParticles(state, enemy.x, enemy.y, '#cbd5e1', 2, 30, 90, 1.8, 0.16);
    return;
  }
  enemy.hp -= amount;
  enemy.hitFlash = 0.14;
  enemy.awake = true;
  emitSound(state, 'hit');
  spawnParticles(state, enemy.x, enemy.y, '#fef08a', 3, 35, 110, 2.0, 0.2);
  state.floatingTexts.push({
    x: enemy.x,
    y: enemy.y - enemy.radius - 4,
    text: `${Math.round(amount)}`,
    color: '#fde047',
    life: 0.55,
    maxLife: 0.55,
  });
}

export function findNearestVisibleEnemy(
  originX: number,
  originY: number,
  range: number,
  state: GameState,
  excludeIds: readonly number[] = [],
  allowExceedMaxRange = false,
): EnemyState | null {
  let bestEnemy: EnemyState | null = null;
  let bestDist = allowExceedMaxRange ? range : Math.min(range, MAX_TARGET_RANGE);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || excludeIds.includes(enemy.id)) continue;
    const d = Math.hypot(enemy.x - originX, enemy.y - originY);
    if (d <= bestDist && hasLineOfSight(originX, originY, enemy.x, enemy.y, state.map)) {
      bestDist = d;
      bestEnemy = enemy;
    }
  }
  return bestEnemy;
}

export function triggerChainLightning(
  state: GameState,
  sourceX: number,
  sourceY: number,
  range: number,
  damage: number,
  maxTargets = 3,
): boolean {
  const first = findNearestVisibleEnemy(sourceX, sourceY, range, state);
  if (!first) return false;

  const hitIds = new Set<number>([first.id]);
  const points: Vec2[] = [
    { x: sourceX, y: sourceY },
    { x: first.x, y: first.y },
  ];
  damageEnemy(state, first, damage);

  let curr = first;
  const maxHops = Math.max(0, maxTargets - 1);
  for (let hop = 0; hop < maxHops; hop++) {
    let nextTarget: EnemyState | null = null;
    let nextDist = Math.min(MAX_TARGET_RANGE, Math.max(105, range * 1.15));
    for (const candidate of state.enemies) {
      if (hitIds.has(candidate.id) || candidate.hp <= 0) continue;
      const d = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
      if (d <= nextDist && hasLineOfSight(curr.x, curr.y, candidate.x, curr.y, state.map)) {
        nextDist = d;
        nextTarget = candidate;
      }
    }
    if (!nextTarget) break;
    hitIds.add(nextTarget.id);
    points.push({ x: nextTarget.x, y: nextTarget.y });
    damageEnemy(state, nextTarget, damage * 0.8);
    curr = nextTarget;
  }

  emitSound(state, 'coil');
  state.visualFx.push({
    kind: 'lightning',
    x: sourceX,
    y: sourceY,
    points,
    color: '#f472b6',
    life: 0.22,
    maxLife: 0.22,
  });
  return true;
}
