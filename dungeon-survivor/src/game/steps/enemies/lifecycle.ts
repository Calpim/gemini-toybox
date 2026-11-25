import { TILE_SIZE, findRoomAtTile, isWallTile, tileCenterWorld, tileIndex } from '../../../core/dungeon';
import type { createRng } from '../../../core/rng';
import { emitSound, pushNotification, spawnParticles, triggerShake } from '../../effects';
import { ALL_EQUIPMENT_IDS, type EquippedItem, MAX_TARGET_RANGE, clampEquipmentLevel } from '../../equipment';
import type { ComputedSkillModifiers } from '../../skillTree';
import { createEnemyByKind, getRunnerPackSize, pickEnemyKindForFloor } from '../../spawn';
import type { EnemyState, GameState } from '../../types';

export interface EnemiesStepDeps {
  getStairsLockCount: (state: GameState) => number;
  rollDropEquipmentLevel: (
    equipment: readonly EquippedItem[],
    rngNext: () => number,
    dropQualityTier?: number,
  ) => number;
}

export function handleEnemyDeath(
  state: GameState,
  enemy: EnemyState,
  index: number,
  mods: ComputedSkillModifiers,
  rng: ReturnType<typeof createRng>,
  deps: EnemiesStepDeps,
): void {
  const { player, map } = state;
  state.stats.kills += 1;
  const wasRoomBoss = Boolean(enemy.isRoomBoss);
  const wasGrandBoss = Boolean(enemy.isGrandBoss);
  const deathColor = wasGrandBoss
    ? '#fbbf24'
    : wasRoomBoss
      ? '#f43f5e'
      : enemy.kind === 'runner'
        ? '#fde047'
        : enemy.kind === 'tank'
          ? '#c084fc'
          : enemy.kind === 'shooter'
            ? '#38bdf8'
            : enemy.kind === 'scout'
              ? '#fb923c'
              : '#fb7185';
  if (wasRoomBoss || wasGrandBoss) {
    emitSound(state, 'boss_kill');
    triggerShake(state, wasGrandBoss ? 10 : 7.5, wasGrandBoss ? 0.38 : 0.28);
    spawnParticles(state, enemy.x, enemy.y, deathColor, wasGrandBoss ? 24 : 18, 60, 210, 3.6, 0.55);
  } else {
    emitSound(state, 'kill');
    spawnParticles(state, enemy.x, enemy.y, deathColor, 8, 45, 145, 2.6, 0.34);
  }

  // Scout-spawned ambush runners yield no drops so alerts cannot be farmed for EXP (APP-MAP-07)
  if (!enemy.isAmbush) {
    const isPackExtra = Boolean(enemy.isPackFollower);
    const dropRateScale = isPackExtra ? 0.4 : 1.0;
    state.pickups.push({
      id: state.nextEntityId++,
      kind: 'exp',
      x: enemy.x,
      y: enemy.y,
      value: wasGrandBoss ? 120 : wasRoomBoss ? 45 : isPackExtra ? 4 : 10,
    });
    if (wasRoomBoss || rng.next() < (0.22 + mods.lootBonusRate * 0.4) * dropRateScale) {
      state.pickups.push({
        id: state.nextEntityId++,
        kind: 'heal',
        x: enemy.x + 10,
        y: enemy.y + 6,
        value: wasGrandBoss ? 60 : wasRoomBoss ? 40 : 25,
      });
    }
    if (wasRoomBoss) {
      const eqId = rng.pick(ALL_EQUIPMENT_IDS);
      let minEquippedLv = 1;
      if (player.equipment.length > 0) {
        minEquippedLv = Math.min(...player.equipment.map((eq) => eq.level));
      }
      const bonus = (wasGrandBoss ? 2 : 1) + (rng.next() < 0.35 ? 1 : 0);
      const itemLevel = clampEquipmentLevel(minEquippedLv + bonus);
      state.pickups.push({
        id: state.nextEntityId++,
        kind: 'equip',
        x: enemy.x - 10,
        y: enemy.y + 6,
        value: 1,
        equipmentId: eqId,
        itemLevel,
      });
    } else {
      // Low-probability enemy equipment drop (1.5% base + mob_loot bonus) scaled to player's lowest equipment level & drop quality (APP-GRW-07)
      const equipDropChance = (0.015 + mods.equipDropBonus) * dropRateScale;
      if (rng.next() < equipDropChance) {
        const eqId = rng.pick(ALL_EQUIPMENT_IDS);
        const itemLevel = deps.rollDropEquipmentLevel(player.equipment, () => rng.next(), mods.dropQualityTier);
        state.pickups.push({
          id: state.nextEntityId++,
          kind: 'equip',
          x: enemy.x - 10,
          y: enemy.y + 6,
          value: 1,
          equipmentId: eqId,
          itemLevel,
        });
      }
    }
  }
  state.enemies.splice(index, 1);
  if (wasRoomBoss && deps.getStairsLockCount(state) === 0) {
    const stairsWorld = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
    emitSound(state, 'stairs_unlock');
    pushNotification(
      state,
      'info',
      wasGrandBoss
        ? `🏆 階層ボス撃破！階段から先（${state.floor + 1}F）へ進める！`
        : '🔓 中ボス撃破！階段の封印が解けた！',
      '#22d3ee',
      3.2,
    );
    state.visualFx.push({
      kind: 'pulse',
      x: stairsWorld.x,
      y: stairsWorld.y,
      radius: 84,
      color: '#22d3ee',
      life: 0.65,
      maxLife: 0.65,
    });
  }
}

export function stepFloorRespawn(state: GameState, clampedDt: number, rng: ReturnType<typeof createRng>): void {
  const { player, map } = state;
  state.elapsedFloorTime += clampedDt;
  state.respawnTimer -= clampedDt;
  const maxAlive = 26 + state.floor * 3;
  const isBossArenaFloor = map.floorType === 'boss';
  const activeGrandBoss = isBossArenaFloor ? state.enemies.find((e) => e.isGrandBoss && e.hp > 0) : undefined;
  const canRespawnOnFloor = !isBossArenaFloor || Boolean(activeGrandBoss && activeGrandBoss.awake);

  if (state.respawnTimer <= 0) {
    state.respawnTimer = isBossArenaFloor ? 5.0 : Math.max(9, 14 - (state.floor - 1) * 0.8);
    const nonBossAlive = isBossArenaFloor
      ? state.enemies.filter((e) => !e.isRoomBoss && !e.isGrandBoss).length
      : state.enemies.length;
    const arenaCap = isBossArenaFloor ? 10 : maxAlive;
    if (canRespawnOnFloor && state.enemies.length < maxAlive && (!isBossArenaFloor || nonBossAlive < arenaCap)) {
      const occupied = new Set<number>();
      for (const e of state.enemies) {
        occupied.add(tileIndex(map, Math.floor(e.x / TILE_SIZE), Math.floor(e.y / TILE_SIZE)));
      }
      for (const c of state.chests) {
        occupied.add(tileIndex(map, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE)));
      }
      const candidates: { tx: number; ty: number }[] = [];
      const bossArena = isBossArenaFloor && map.rooms.length >= 2 ? map.rooms[1] : null;
      for (let ty = 1; ty < map.height - 1; ty++) {
        for (let tx = 1; tx < map.width - 1; tx++) {
          if (isWallTile(map, tx, ty) || occupied.has(tileIndex(map, tx, ty))) continue;
          const room = findRoomAtTile(map, tx, ty);
          if (!room) continue; // Corridor respawn suppressed
          if (bossArena && room !== bossArena) continue; // Never spawn inside fountain anteroom
          const pos = tileCenterWorld(tx, ty);
          const minDist = bossArena ? 180 : 260;
          if (Math.hypot(pos.x - player.x, pos.y - player.y) >= minDist) {
            candidates.push({ tx, ty });
          }
        }
      }
      if (candidates.length > 0) {
        const desiredCount = isBossArenaFloor
          ? Math.min(arenaCap - nonBossAlive, rng.next() < 0.5 ? 3 : 2)
          : rng.next() < 0.45
            ? 2
            : 1;
        const spawnCount = Math.min(candidates.length, maxAlive - state.enemies.length, desiredCount);
        for (let s = 0; s < spawnCount; s++) {
          if (candidates.length === 0) break;
          const pickIdx = rng.int(0, candidates.length - 1);
          const picked = candidates.splice(pickIdx, 1)[0];
          const pos = tileCenterWorld(picked.tx, picked.ty);
          const kind = pickEnemyKindForFloor(state.floor, rng.next());
          const spawned = createEnemyByKind(state.nextEntityId++, kind, pos.x, pos.y, state.floor, MAX_TARGET_RANGE);
          if (bossArena) spawned.awake = true;
          state.enemies.push(spawned);

          if (kind === 'runner') {
            const packSize = getRunnerPackSize(state.floor, rng.next());
            for (let p = 1; p < packSize; p++) {
              if (candidates.length === 0 || state.enemies.length >= maxAlive) break;
              // Prefer nearby candidate tiles in the same room for pack cohesion
              let bestCandIdx = 0;
              let bestDist = Infinity;
              for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
                const c = candidates[cIdx];
                const d = Math.hypot(c.tx - picked.tx, c.ty - picked.ty);
                if (d < bestDist) {
                  bestDist = d;
                  bestCandIdx = cIdx;
                }
              }
              const extraTile = candidates.splice(bestCandIdx, 1)[0];
              const extraPos = tileCenterWorld(extraTile.tx, extraTile.ty);
              const follower = createEnemyByKind(
                state.nextEntityId++,
                'runner',
                extraPos.x,
                extraPos.y,
                state.floor,
                MAX_TARGET_RANGE,
              );
              follower.isPackFollower = true;
              if (bossArena) follower.awake = true;
              state.enemies.push(follower);
            }
          }
        }
        pushNotification(
          state,
          'info',
          bossArena ? '👾 ボスアリーナに増援が出現！' : '👾 ダンジョン奥の部屋に新たな敵の気配…',
          '#c084fc',
          2.2,
        );
      }
    }
  }
}
