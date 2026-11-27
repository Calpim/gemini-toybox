import { emitSound, pushNotification, spawnParticles } from './effects';
import type { GameState } from './types';

export function getLevelUpSkillPoints(newLevel: number): number {
  return newLevel <= 10 ? 1 : 2;
}

export function grantExpAndCheckLevelUp(state: GameState, gainedExp: number): void {
  const { player } = state;
  player.exp += gainedExp;
  state.stats.totalExp += gainedExp;
  while (player.exp >= player.expToNext) {
    player.exp -= player.expToNext;
    player.level += 1;
    const gainedSp = getLevelUpSkillPoints(player.level);
    player.skillPoints += gainedSp;
    player.expToNext = Math.round(player.expToNext * 1.32);
    emitSound(state, 'level_up');
    spawnParticles(state, player.x, player.y, '#38bdf8', 14, 55, 165, 3.0, 0.45);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 24,
      text: `LEVEL ${player.level}! (+${gainedSp} SP)`,
      color: '#38bdf8',
      life: 1.0,
      maxLife: 1.0,
    });
    pushNotification(state, 'levelup', `🎉 LEVEL UP! Lv${player.level} (+${gainedSp} SP)`, '#38bdf8', 2.6);
  }
}
