import { getPlayerBaseAttackStats } from '../game/engine';
import {
  EQUIPMENT_CATALOG,
  MAX_EQUIP_SLOTS,
  getEquipmentEvolutionSummary,
} from '../game/equipment';
import {
  MAX_SKILL_LEVEL,
  SKILL_PREREQ_LEVEL,
  SKILL_TREE_NODES,
  canUpgradeSkill,
  getSkillEffectSummary,
  getSkillLevel,
  getSkillNode,
  type SkillBranch,
  type SkillNodeId,
} from '../game/skillTree';
import type { GameState } from '../game/types';

export interface ModalHandlers {
  onUnlockSkill: (nodeId: SkillNodeId) => void;
  onCloseSkillTree: () => void;
  onResolveEquip: (choice: { type: 'replace'; slotIndex: number } | { type: 'scrap' }) => void;
}

const BRANCH_META: { id: SkillBranch; label: string; accent: string }[] = [
  { id: 'arms', label: '🔴 兵装・ビット', accent: '#f87171' },
  { id: 'defense', label: '🔵 迎撃・防衛', accent: '#60a5fa' },
  { id: 'mobility', label: '🟢 探索・機動', accent: '#34d399' },
];

export function renderModals(
  state: GameState,
  els: {
    skillModal: HTMLElement;
    skillSpBadge: HTMLElement;
    skillColumns: HTMLElement;
    skillGearSummary: HTMLElement;
    equipModal: HTMLElement;
    equipDropCard: HTMLElement;
    equipSlotList: HTMLElement;
  },
  handlers: ModalHandlers
): void {
  // 1. Skill Tree Modal
  if (state.status === 'skill_tree') {
    els.skillModal.classList.remove('hidden');
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints} (使用済 ${state.player.spentSkillPoints})`;

    els.skillColumns.innerHTML = '';
    for (const branch of BRANCH_META) {
      const col = document.createElement('div');
      col.className = 'tree-col';

      const heading = document.createElement('div');
      heading.className = 'tree-col-head';
      heading.style.color = branch.accent;
      heading.textContent = branch.label;
      col.appendChild(heading);

      const nodes = SKILL_TREE_NODES.filter((n) => n.branch === branch.id).sort(
        (a, b) => a.tier - b.tier
      );
      nodes.forEach((node, idx) => {
        if (idx > 0) {
          const arrow = document.createElement('div');
          arrow.className = 'tree-arrow';
          arrow.textContent = `↓ 前提 Lv${SKILL_PREREQ_LEVEL}+`;
          col.appendChild(arrow);
        }

        const currLv = getSkillLevel(state.player.skillLevels, node.id);
        const isMax = currLv >= MAX_SKILL_LEVEL;
        const isAvailable = canUpgradeSkill(
          state.player.skillLevels,
          state.player.skillPoints,
          node.id
        );
        const prereqMet =
          node.requires === null ||
          getSkillLevel(state.player.skillLevels, node.requires) >= SKILL_PREREQ_LEVEL;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tree-node ${
          isMax ? 'unlocked' : isAvailable ? 'available' : currLv > 0 ? 'unlocked' : 'locked'
        }`;
        btn.disabled = !isAvailable;

        const reqLabel = node.requires
          ? `Tier ${node.tier} · 必要 ${node.cost} SP/Lv · 前提: ${getSkillNode(node.requires).name} Lv${SKILL_PREREQ_LEVEL}+`
          : `Tier ${node.tier} · 必要 ${node.cost} SP/Lv · 基本ノード`;

        const stateLabel = isMax
          ? `MAX (${currLv}/${MAX_SKILL_LEVEL})`
          : isAvailable
          ? currLv === 0
            ? `習得 (-${node.cost} SP)`
            : `Lv${currLv}→${currLv + 1} (-${node.cost} SP)`
          : prereqMet
          ? `🔒 SP不足 (Lv${currLv}/${MAX_SKILL_LEVEL})`
          : `🔒 前提Lv${SKILL_PREREQ_LEVEL}要`;

        const effectText =
          currLv > 0
            ? `${node.description} ｜ 現在: ${getSkillEffectSummary(node.id, currLv)}`
            : node.description;

        btn.innerHTML = `
          <div class="node-top">
            <strong>${node.name} <span style="opacity:0.8;font-size:11px">Lv${currLv}/${MAX_SKILL_LEVEL}</span></strong>
            <span class="node-state">${stateLabel}</span>
          </div>
          <div class="node-desc">${effectText}</div>
          <div class="node-req">${reqLabel}</div>
        `;

        if (isAvailable) {
          btn.addEventListener('click', () => handlers.onUnlockSkill(node.id));
        }
        col.appendChild(btn);
      });

      els.skillColumns.appendChild(col);
    }

    const baseStats = getPlayerBaseAttackStats(state.player);
    const basePill = `<span class="gear-pill" style="border-color:#34d39988;color:#6ee7b7">自機コアショット (使用SP ${baseStats.spentSp}): 威力${baseStats.damage} / ${baseStats.shotCount}発 / ${baseStats.cooldown.toFixed(2)}s / 射程${baseStats.range}px</span>`;
    const gearPills =
      state.player.equipment.length === 0
        ? '<span style="font-size:12px;color:#94a3b8;">装備枠 0/3（探索や敵ドロップで装備を追加可能）</span>'
        : state.player.equipment
            .map((eq) => {
              const def = EQUIPMENT_CATALOG[eq.id];
              const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
              return `<span class="gear-pill" style="border-color:${def.color}55;color:${def.color}">${def.name} Lv${eq.level} (${evo})</span>`;
            })
            .join('');
    els.skillGearSummary.innerHTML = `${basePill}${gearPills}`;
  } else {
    els.skillModal.classList.add('hidden');
  }

  // 2. Equipment Choice Modal (when slots === 3)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const dropItem = state.pendingEquipDrop.item;
    const dropDef = EQUIPMENT_CATALOG[dropItem.id];
    const dropEvo = getEquipmentEvolutionSummary(dropItem.id, dropItem.level);
    els.equipDropCard.innerHTML = `
      <div class="drop-badge" style="color:${dropDef.color}">${dropDef.category}</div>
      <div class="drop-name">${dropDef.name} Lv${dropItem.level} <span style="font-size:12px;color:#fbbf24;">[${dropEvo}]</span></div>
      <div class="drop-desc">${dropDef.description}</div>
    `;

    els.equipSlotList.innerHTML = '';
    state.player.equipment.forEach((eq, idx) => {
      const def = EQUIPMENT_CATALOG[eq.id];
      const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.innerHTML = `
        <span><strong>枠${idx + 1}/${MAX_EQUIP_SLOTS}</strong> ${def.name} Lv${eq.level} <small style="color:#94a3b8">(${evo})</small></span>
        <span class="slot-action">入れ替える</span>
      `;
      btn.addEventListener('click', () => handlers.onResolveEquip({ type: 'replace', slotIndex: idx }));
      els.equipSlotList.appendChild(btn);
    });
  } else {
    els.equipModal.classList.add('hidden');
  }
}
