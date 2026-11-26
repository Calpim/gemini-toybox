import type { EquipChoice } from '../../game/engine';
import type { SkillBranch, SkillNodeId } from '../../game/skillTree';

export type PauseModalTab = 'skill' | 'gear';

export interface ModalHandlers {
  onUnlockSkill: (nodeId: SkillNodeId) => void;
  onCloseSkillTree: () => void;
  onResolveEquip: (choice: EquipChoice) => void;
  activeTab?: PauseModalTab;
}

export interface ModalElements {
  skillModal: HTMLElement;
  skillSpBadge: HTMLElement;
  skillColumns: HTMLElement;
  skillTabBody?: HTMLElement;
  gearTabBody?: HTMLElement;
  tabSkillBtn?: HTMLElement;
  tabGearBtn?: HTMLElement;
  equipModal: HTMLElement;
  equipDropCard: HTMLElement;
  equipSlotList: HTMLElement;
}

export const BRANCH_META: { id: SkillBranch; label: string; accent: string }[] = [
  { id: 'arms', label: '兵装・ビット', accent: '#f87171' },
  { id: 'defense', label: '迎撃・防衛', accent: '#60a5fa' },
  { id: 'mobility', label: '探索・機動', accent: '#34d399' },
];

export function getBranchLabel(branch: SkillBranch): string {
  return BRANCH_META.find((b) => b.id === branch)?.label ?? branch;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
