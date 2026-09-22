// 便利店交班稽核台 —— 应用编排层
// 页面只调这里的动作；所有可否保存/复核/更正的判定都来自 rules.ts。
import { computed, ref } from "vue";
import {
  RULES,
  auditConflicts,
  buildVersion,
  canReview,
  freezeForReview,
  latestVersion,
  shiftLabel,
  validateSubmission,
} from "./rules";
import { loadShifts, resetSeeds, saveShifts } from "./storage";
import type { ActionResult, Shift, ShiftDraft, ShiftVersion } from "./types";

const shifts = ref<Shift[]>(loadShifts());
const toast = ref<{ type: "ok" | "error"; text: string } | null>(null);

function persist() {
  saveShifts(shifts.value);
}

/** 新建班次：规则不过则整班拒绝，不产生任何半截数据 */
function createShift(draft: ShiftDraft): ActionResult {
  const result = validateSubmission(shifts.value, draft, { nextVersion: 1 });
  if (!result.ok) {
    toast.value = { type: "error", text: `整班已拒绝：${result.issues.length} 项问题未通过规则` };
    return result;
  }
  const now = new Date().toISOString();
  const shift: Shift = {
    id: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: draft.date,
    shiftType: draft.shiftType as Shift["shiftType"],
    cashier: draft.cashier.trim(),
    versions: [buildVersion(draft, 1, now)],
    status: "待复核",
  };
  shifts.value = [shift, ...shifts.value];
  persist();
  toast.value = { type: "ok", text: `${shiftLabel(shift)} 已登记，等待复核` };
  return result;
}

/** 复核：盘亏/盘盈未定性或未写依据时禁止；通过即冻结最新版本 */
function reviewShift(shiftId: string): ActionResult {
  const shift = shifts.value.find((item) => item.id === shiftId);
  if (!shift) return { ok: false, issues: [{ field: "", message: "班次不存在" }] };
  if (shift.status === "已复核") {
    return { ok: false, issues: [{ field: "", message: `${RULES.REVIEW_FREEZE.name}：班次已复核冻结（${RULES.REVIEW_FREEZE.id}）` }] };
  }
  const check = canReview(shift);
  if (!check.ok) {
    toast.value = { type: "error", text: "不得复核：存在未定性或未写依据的盘亏/盘盈" };
    return { ok: false, issues: check.issues.map((message) => ({ field: "stock", message })) };
  }
  const version = latestVersion(shift)!;
  const index = shift.versions.length - 1;
  shift.versions[index] = freezeForReview(version, new Date().toISOString());
  shift.status = "已复核";
  persist();
  toast.value = { type: "ok", text: `${shiftLabel(shift)} 已复核冻结（v${version.version}）` };
  return { ok: true, issues: [] };
}

/** 更正：已复核班次不能改原值，只能带原因追加新版本 */
function reviseShift(shiftId: string, draft: ShiftDraft): ActionResult {
  const shift = shifts.value.find((item) => item.id === shiftId);
  if (!shift) return { ok: false, issues: [{ field: "", message: "班次不存在" }] };
  const nextVersion = shift.versions.length + 1;
  const result = validateSubmission(shifts.value, draft, { shiftId, nextVersion });
  if (!result.ok) {
    toast.value = { type: "error", text: `更正已拒绝：${result.issues.length} 项问题未通过规则` };
    return result;
  }
  shift.versions.push(buildVersion(draft, nextVersion, new Date().toISOString()));
  // 新版本等待复核；旧版本（含原值）原样保留
  shift.status = "待复核";
  shift.date = draft.date;
  shift.shiftType = draft.shiftType as Shift["shiftType"];
  shift.cashier = draft.cashier.trim();
  persist();
  toast.value = { type: "ok", text: `已新建 v${nextVersion} 更正版本，原值保留待复核` };
  return { ok: true, issues: [] };
}

/** 从某班次最新版本（或指定历史版本）生成更正草稿，便于页面预填 */
function draftFromVersion(shift: Shift, version?: ShiftVersion): ShiftDraft {
  const source = version ?? latestVersion(shift)!;
  return {
    date: shift.date,
    shiftType: shift.shiftType,
    cashier: shift.cashier,
    inStoreSales: source.inStoreSales,
    coupons: source.coupons.map((c) => ({ id: c.id, code: c.code, amount: c.amount })),
    stock: source.stock.map((line) => ({ ...line })),
    revisionReason: "",
  };
}

function clearToast() {
  toast.value = null;
}

function restoreSeeds() {
  shifts.value = resetSeeds();
  toast.value = { type: "ok", text: "已恢复演示数据" };
}

const conflicts = computed(() => auditConflicts(shifts.value));

export function useAuditStore() {
  return {
    shifts,
    conflicts,
    toast,
    createShift,
    reviewShift,
    reviseShift,
    draftFromVersion,
    clearToast,
    restoreSeeds,
  };
}
