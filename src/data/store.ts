// 数据层：唯一的数据出入口。页面只通过本模块读写，localStorage 只在这里出现。

import { SEED_STATE } from "./seed";
import type {
  AuditState,
  RuleIssue,
  Shift,
  ShiftDraft,
  SubmitResult,
  ShiftVersion
} from "./types";
import { validateShiftSubmission, reviewShift, detectStateConflicts } from "../rules/auditRules";

const STORAGE_KEY = "dfwlfront-7-convenience-audit-v1";

function load(): AuditState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = structuredClone(SEED_STATE);
    persist(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as AuditState;
    if (!parsed || !Array.isArray(parsed.shifts)) return structuredClone(SEED_STATE);
    return parsed;
  } catch {
    return structuredClone(SEED_STATE);
  }
}

function persist(state: AuditState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state: AuditState = load();
// 同页多标签/多组件的刷新通知
const listeners = new Set<() => void>();

function emit(): void {
  persist(state);
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): AuditState {
  return state;
}

export function getShifts(): Shift[] {
  return state.shifts;
}

export function getShift(id: string): Shift | undefined {
  return state.shifts.find((shift) => shift.id === id);
}

export function shiftLabel(shift: Shift): string {
  return `${shift.date} ${shift.kind}（${shift.cashier}）`;
}

export function latestVersion(shift: Shift): ShiftVersion {
  return shift.versions[shift.versions.length - 1];
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 新建班次登记。规则不通过时整班拒绝：任何数据都不落库。
 */
export function submitShift(draft: ShiftDraft): SubmitResult {
  const result = validateShiftSubmission(draft, state);
  if (!result.ok) return result;

  const now = new Date().toISOString();
  const version: ShiftVersion = {
    id: makeId("v"),
    version: 1,
    storeSales: draft.storeSales,
    cashSales: draft.cashSales,
    coupons: draft.coupons.map((line) => ({ ...line })),
    inventory: draft.inventory.map((line) => ({ ...line })),
    createdAt: now
  };
  const shift: Shift = {
    id: makeId("shift"),
    date: draft.date,
    kind: draft.kind,
    cashier: draft.cashier,
    versions: [version],
    status: "待复核",
    createdAt: now
  };
  state = { ...state, shifts: [shift, ...state.shifts] };
  emit();
  return { ok: true, issues: [] };
}

/**
 * 已复核班次更正：旧值原样保留，带原因新建一个版本；班次回到待复核。
 */
export function correctShift(shiftId: string, draft: ShiftDraft): SubmitResult {
  const target = state.shifts.find((shift) => shift.id === shiftId);
  if (!target) return { ok: false, issues: [] };

  const result = validateShiftSubmission(draft, state, shiftId);
  if (!result.ok) return result;

  const now = new Date().toISOString();
  const previous = latestVersion(target);
  const version: ShiftVersion = {
    id: makeId("v"),
    version: previous.version + 1,
    storeSales: draft.storeSales,
    cashSales: draft.cashSales,
    coupons: draft.coupons.map((line) => ({ ...line })),
    inventory: draft.inventory.map((line) => ({ ...line })),
    createdAt: now,
    correctionReason: draft.correctionReason.trim(),
    previousVersionId: previous.id
  };
  const next: Shift = {
    ...target,
    // 日期/班次/收银员不允许在更正里改动，保持班次身份
    versions: [...target.versions, version],
    status: "待复核",
    reviewedAt: undefined,
    reviewer: undefined
  };
  state = {
    ...state,
    shifts: state.shifts.map((shift) => (shift.id === shiftId ? next : shift))
  };
  emit();
  return { ok: true, issues: [] };
}

/** 复核：盘亏盘盈未定性或未写依据则阻断 */
export function review(shiftId: string, reviewer: string): RuleIssue[] {
  const target = state.shifts.find((shift) => shift.id === shiftId);
  if (!target) return [];
  const issues = reviewShift(target);
  if (issues.length > 0) return issues;

  state = {
    ...state,
    shifts: state.shifts.map((shift) =>
      shift.id === shiftId
        ? { ...shift, status: "已复核", reviewedAt: new Date().toISOString(), reviewer: reviewer.trim() || "值班长" }
        : shift
    )
  };
  emit();
  return [];
}

/** 全量稽核：跨班次券码冲突 + 库存定性合规，冲突中心直接使用 */
export function listConflicts(): RuleIssue[] {
  return detectStateConflicts(state);
}

export function conflictsOfShift(shiftId: string): RuleIssue[] {
  return detectStateConflicts(state).filter((issue) => issue.shiftId === shiftId);
}
