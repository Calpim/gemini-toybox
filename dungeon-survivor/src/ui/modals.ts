import { EQUIPMENT_CATALOG, MAX_EQUIP_SLOTS } from '../game/equipment';
import {
  SKILL_TREE_NODES,
  canUnlockSkill,
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
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints}`;
    const unlockedSet = new Set(state.player.unlockedSkills);

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
          arrow.textContent = '↓';
          col.appendChild(arrow);
        }

        const isUnlocked = unlockedSet.has(node.id);
        const isAvailable = canUnlockSkill(unlockedSet, state.player.skillPoints, node.id);
        const prereqMet = node.requires === null || unlockedSet.has(node.requires);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tree-node ${
          isUnlocked ? 'unlocked' : isAvailable ? 'available' : 'locked'
        }`;
        btn.disabled = !isAvailable;

        const reqLabel = node.requires
          ? `Tier ${node.tier} · 必要 ${node.cost} SP · 前提: ${getSkillNode(node.requires).name}`
          : `Tier ${node.tier} · 必要 ${node.cost} SP · 基本ノード`;

        const stateLabel = isUnlocked
          ? '習得済'
          : isAvailable
          ? `習得可 (-${node.cost} SP)`
          : prereqMet
          ? `🔒 SP不足 (要${node.cost})`
          : `🔒 要${node.cost} SP`;

        btn.innerHTML = `
          <div class="node-top">
            <strong>${node.name}</strong>
            <span class="node-state">${stateLabel}</span>
          </div>
          <div class="node-desc">${node.description}</div>
          <div class="node-req">${reqLabel}</div>
        `;

        if (isAvailable) {
          btn.addEventListener('click', () => handlers.onUnlockSkill(node.id));
        }
        col.appendChild(btn);
      });

      els.skillColumns.appendChild(col);
    }

    els.skillGearSummary.innerHTML = state.player.equipment
      .map((eq) => {
        const def = EQUIPMENT_CATALOG[eq.id];
        return `<span class="gear-pill" style="border-color:${def.color}55;color:${def.color}">${def.name} Lv${eq.level}</span>`;
      })
      .join('');
  } else {
    els.skillModal.classList.add('hidden');
  }

  // 2. Equipment Choice Modal (when slots === 5)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const dropDef = EQUIPMENT_CATALOG[state.pendingEquipDrop.item.id];
    els.equipDropCard.innerHTML = `
      <div class="drop-badge" style="color:${dropDef.color}">${dropDef.category}</div>
      <div class="drop-name">${dropDef.name} Lv${state.pendingEquipDrop.item.level}</div>
      <div class="drop-desc">${dropDef.description}</div>
    `;

    els.equipSlotList.innerHTML = '';
    state.player.equipment.forEach((eq, idx) => {
      const def = EQUIPMENT_CATALOG[eq.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.innerHTML = `
        <span><strong>枠${idx + 1}/${MAX_EQUIP_SLOTS}</strong> ${def.name} (Lv${eq.level})</span>
        <span class="slot-action">入れ替える</span>
      `;
      btn.addEventListener('click', () => handlers.onResolveEquip({ type: 'replace', slotIndex: idx }));
      els.equipSlotList.appendChild(btn);
    });
  } else {
    els.equipModal.classList.add('hidden');
  }
}
