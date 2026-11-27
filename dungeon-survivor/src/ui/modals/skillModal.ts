import {
  canUpgradeSkill,
  getSkillLevel,
  getSkillMaxLevel,
  getSkillUpgradeCost,
  SKILL_PREREQ_LEVEL,
  SKILL_TREE_NODES,
} from '../../game/skillTree';
import type { GameState } from '../../game/types';
import { getSkillIcon, ICON_GEAR, ICON_INFO, ICON_LOCK, ICON_TREE } from '../icons';
import { renderGearTabContent } from './gearTab';
import type { PopoverController } from './popover';
import { BRANCH_META, el, type ModalElements, type ModalHandlers, type PauseModalTab } from './types';

export function renderSkillModal(
  state: GameState,
  els: ModalElements,
  handlers: ModalHandlers,
  ctrl: PopoverController,
): void {
  // 1. Pause Modal (Skill Tree / Gear & Scrap-Build Tabs)
  if (state.status === 'skill_tree') {
    const activeTab: PauseModalTab = handlers.activeTab ?? 'skill';
    els.skillModal.classList.remove('hidden');
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints} (使用済 ${state.player.spentSkillPoints})`;

    if (els.tabSkillBtn) {
      els.tabSkillBtn.innerHTML = `${ICON_TREE}<span>スキル</span><span class="tab-badge">SP ${state.player.skillPoints}</span>`;
      els.tabSkillBtn.classList.toggle('active-skill', activeTab === 'skill');
      els.tabSkillBtn.setAttribute('aria-selected', String(activeTab === 'skill'));
    }
    if (els.tabGearBtn) {
      els.tabGearBtn.innerHTML = `${ICON_GEAR}<span>装備・ギア</span><span class="tab-badge tab-badge-gear">${state.player.equipment.length} / ${state.player.maxEquipSlots}</span>`;
      els.tabGearBtn.classList.toggle('active-gear', activeTab === 'gear');
      els.tabGearBtn.setAttribute('aria-selected', String(activeTab === 'gear'));
    }
    if (els.skillTabBody && els.gearTabBody) {
      els.skillTabBody.classList.toggle('hidden', activeTab !== 'skill');
      els.gearTabBody.classList.toggle('hidden', activeTab !== 'gear');
      if (activeTab === 'gear') {
        renderGearTabContent(els.gearTabBody, state);
      }
    }

    if (activeTab !== 'skill') {
      ctrl.close(false);
    }

    els.skillColumns.innerHTML = '';
    for (const branch of BRANCH_META) {
      const col = el('div', 'tree-col');

      const heading = el('div', 'tree-col-head');
      heading.style.color = branch.accent;
      const dot = el('span', 'branch-dot');
      dot.style.background = branch.accent;
      dot.style.color = branch.accent;
      const headingLabel = el('span', undefined, branch.label);
      heading.append(dot, headingLabel);
      col.appendChild(heading);

      const nodes = SKILL_TREE_NODES.filter((n) => n.branch === branch.id).sort((a, b) => a.tier - b.tier);
      nodes.forEach((node, idx) => {
        if (idx > 0) {
          col.appendChild(el('div', 'tree-arrow', `↓ 前提 Lv${SKILL_PREREQ_LEVEL}+`));
        }

        const currLv = getSkillLevel(state.player.skillLevels, node.id);
        const maxLv = getSkillMaxLevel(node.id);
        const isMax = currLv >= maxLv;
        const nextCost = getSkillUpgradeCost(currLv, node.id);
        const isAvailable = canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, node.id);
        const prereqMet =
          node.requires === null || getSkillLevel(state.player.skillLevels, node.requires) >= SKILL_PREREQ_LEVEL;

        const cardState = isMax ? 'unlocked' : isAvailable ? 'available' : currLv > 0 ? 'unlocked' : 'locked';
        const card = el('div', `tree-node ${cardState}`);
        card.dataset.branch = node.branch;
        card.dataset.tier = String(node.tier);
        card.dataset.nodeId = node.id;
        if (!isMax && !isAvailable) {
          card.dataset.lockReason = prereqMet ? 'sp' : 'prereq';
        }

        const actionBtn = el('button', 'tree-node-main');
        actionBtn.type = 'button';
        actionBtn.disabled = !isAvailable;
        actionBtn.setAttribute(
          'aria-label',
          isMax ? `${node.name} Lv${currLv}/${maxLv} MAX` : `${node.name} Lv${currLv}/${maxLv} (-${nextCost} SP)`,
        );

        const headRow = el('div', 'node-head');
        const iconSpan = el('span', 'node-icon');
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = getSkillIcon(node.id);
        const titleEl = el('span', 'node-title', node.name);
        headRow.append(iconSpan, titleEl);

        const taglineEl = el('div', 'node-tagline', node.tagline);

        const footRow = el('div', 'node-foot');
        const lvGroup = el('span', 'node-lv-group');
        lvGroup.appendChild(el('span', 'node-lv', `Lv${currLv}/${maxLv}`));
        const pips = el('span', 'node-pips');
        pips.setAttribute('aria-hidden', 'true');
        for (let lv = 1; lv <= maxLv; lv++) {
          pips.appendChild(el('span', `node-pip${lv <= currLv ? ' is-filled' : ''}`));
        }
        lvGroup.appendChild(pips);

        const costBadge = el('span', 'node-cost');
        if (isMax) {
          costBadge.textContent = 'MAX';
        } else if (isAvailable) {
          costBadge.textContent = `-${nextCost} SP`;
        } else {
          const lockIcon = el('span', 'node-lock-icon');
          lockIcon.setAttribute('aria-hidden', 'true');
          lockIcon.innerHTML = ICON_LOCK;
          costBadge.append(lockIcon, el('span', undefined, `-${nextCost} SP`));
        }

        footRow.append(lvGroup, costBadge);
        actionBtn.append(headRow, taglineEl, footRow);

        if (isAvailable) {
          actionBtn.addEventListener('click', () => handlers.onUnlockSkill(node.id));
        }

        const infoBtn = el('button', 'node-info-btn');
        infoBtn.type = 'button';
        infoBtn.dataset.infoNode = node.id;
        infoBtn.setAttribute('aria-label', `${node.name}の詳細情報`);
        infoBtn.setAttribute('aria-haspopup', 'dialog');
        infoBtn.setAttribute('aria-expanded', String(ctrl.openNodeId === node.id));
        infoBtn.setAttribute('aria-controls', 'skillInfoPopover');
        infoBtn.title = `${node.name}の詳細`;
        infoBtn.innerHTML = ICON_INFO;

        infoBtn.addEventListener('pointerenter', (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && !ctrl.pinned) {
            ctrl.open(node.id, false, infoBtn);
          }
        });
        infoBtn.addEventListener('pointerleave', (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && !ctrl.pinned) {
            ctrl.scheduleClose();
          }
        });
        infoBtn.addEventListener('focusin', () => {
          if (ctrl.suppressNextFocusOpen) {
            ctrl.suppressNextFocusOpen = false;
            return;
          }
          if (Date.now() - ctrl.lastPointerDownTs < 400) return;
          if (!ctrl.pinned) {
            ctrl.open(node.id, false, infoBtn);
          }
        });
        infoBtn.addEventListener('focusout', () => {
          setTimeout(() => ctrl.handleFocusOut(), 0);
        });

        card.append(actionBtn, infoBtn);
        col.appendChild(card);
      });

      els.skillColumns.appendChild(col);
    }

    if (activeTab === 'skill' && ctrl.openNodeId) {
      ctrl.refresh();
    }
  } else {
    ctrl.close(false);
    els.skillModal.classList.add('hidden');
  }
}
