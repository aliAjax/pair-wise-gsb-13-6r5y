// 规则层：便利店交班稽核的全部业务规则。
// 不读写存储、不依赖 Vue，输入数据输出结论，可独立单测。
//
// 规则清单：
//  R-COUPON-UNIQUE 同一券码跨班只计一次：券码已被其他班次（含其历史版本）核销即冲突
//  R-COUPON-DUP     单次提交内同一券码重复：重复提交，整班拒绝
//  R-INV-REASON     盘亏或盘盈必须定性（损耗/错录/盗损）并写依据，未填不得复核
//  R-SALES-NONNEG   销售额不得为负
//  R-FROZEN         已复核班次冻结，只能带原因新建版本更正
//  R-IDENTITY       更正不得改变班次日期、班次类型与收银员

import type {
  AuditState,
  InventoryLine,
  RuleIssue,
  Shift,
  ShiftDraft,
  ShiftVersion,
  SubmitResult
} from "./../data/types";

function latestVersion(shift: Shift): ShiftVersion {
  return shift.versions[shift.versions.length - 1];
}

function shiftLabel(shift: Shift): string {
  return `${shift.date} ${shift.kind}（${shift.cashier}）`;
}

export const RULES = {
  couponUnique: {
    code: "R-COUPON-UNIQUE",
    text: "同一券码跨班只计一次，已核销券码不得在其他班次重复计额"
  },
  couponDup: {
    code: "R-COUPON-DUP",
    text: "单次交班中同一券码不得重复提交，重复则整班拒绝"
  },
  inventoryReason: {
    code: "R-INV-REASON",
    text: "盘亏或盘盈必须选择损耗、错录或盗损并填写依据，未填不得复核"
  },
  salesNonNeg: {
    code: "R-SALES-NONNEG",
    text: "店内销售额与现金销售额不得为负数"
  },
  frozen: {
    code: "R-FROZEN",
    text: "已复核班次已冻结，更正只能带原因新建版本并保留原值"
  },
  identity: {
    code: "R-IDENTITY",
    text: "更正版本不得改变班次日期、班次类型与收银员"
  }
} as const;

function varianceOf(line: InventoryLine): number {
  return line.actualQty - line.bookQty;
}

/** 班次内未定性/未写依据的盘亏盘盈（复核阻断项） */
export function findInventoryReasonIssues(shift: Shift, version = latestVersion(shift)): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const line of version.inventory) {
    if (varianceOf(line) === 0) continue;
    if (!line.reason || !line.basis?.trim()) {
      issues.push({
        kind: "阻断",
        ruleCode: RULES.inventoryReason.code,
        ruleText: RULES.inventoryReason.text,
        shiftId: shift.id,
        shiftLabel: shiftLabel(shift),
        target: `${line.sku} ${line.name}`,
        targetType: "inventory",
        diff: varianceOf(line),
        detail:
          !line.reason && !line.basis?.trim()
            ? "盘亏盘盈未选择定性且未填写依据"
            : !line.reason
              ? "盘亏盘盈未选择损耗/错录/盗损"
              : "盘亏盘盈已定性但未填写依据"
      });
    }
  }
  return issues;
}

interface CouponUsage {
  shift: Shift;
  version: Shift["versions"][number];
  amount: number;
}

/**
 * 券码全局占用表：每个券码 -> 哪些班次用过。
 * 已复核班次的所有历史版本都算数（旧值保留即留痕）；
 * 待复核班次只看最新版本（草稿过程值不永久占位）。
 */
function buildCouponIndex(state: AuditState, excludeShiftId?: string): Map<string, CouponUsage[]> {
  const index = new Map<string, CouponUsage[]>();
  for (const shift of state.shifts) {
    if (shift.id === excludeShiftId) continue;
    const versions = shift.status === "已复核" ? shift.versions : [latestVersion(shift)];
    for (const version of versions) {
      for (const line of version.coupons) {
        const code = line.code.trim();
        if (!code) continue;
        const list = index.get(code) ?? [];
        list.push({ shift, version, amount: line.amount });
        index.set(code, list);
      }
    }
  }
  return index;
}

/**
 * 提交（新建或更正）前校验。任何阻断规则不通过 -> 整班拒绝，返回全部命中项。
 */
export function validateShiftSubmission(
  draft: ShiftDraft,
  state: AuditState,
  correctingShiftId?: string
): SubmitResult {
  const issues: RuleIssue[] = [];
  const target = correctingShiftId
    ? state.shifts.find((shift) => shift.id === correctingShiftId)
    : undefined;

  if (correctingShiftId && !target) return { ok: false, issues };

  // R-FROZEN / R-IDENTITY：更正路径
  if (target) {
    if (target.status !== "已复核") {
      // 待复核班次直接改最新版即可，不允许借更正开版本
      issues.push({
        kind: "阻断",
        ruleCode: RULES.frozen.code,
        ruleText: RULES.frozen.text,
        shiftId: target.id,
        shiftLabel: shiftLabel(target),
        target: shiftLabel(target),
        targetType: "shift",
        diff: 0,
        detail: "仅已复核的冻结班次需要新建版本更正，待复核班次请直接修改后重新提交"
      });
    }
    if (!draft.correctionReason.trim()) {
      issues.push({
        kind: "阻断",
        ruleCode: RULES.frozen.code,
        ruleText: RULES.frozen.text,
        shiftId: target.id,
        shiftLabel: shiftLabel(target),
        target: shiftLabel(target),
        targetType: "shift",
        diff: 0,
        detail: "更正必须填写原因"
      });
    }
    if (
      draft.date !== target.date ||
      draft.kind !== target.kind ||
      draft.cashier.trim() !== target.cashier.trim()
    ) {
      issues.push({
        kind: "阻断",
        ruleCode: RULES.identity.code,
        ruleText: RULES.identity.text,
        shiftId: target.id,
        shiftLabel: shiftLabel(target),
        target: shiftLabel(target),
        targetType: "shift",
        diff: 0,
        detail: `原值：${target.date} ${target.kind} ${target.cashier}`
      });
    }
  }

  // R-SALES-NONNEG
  if (draft.storeSales < 0 || draft.cashSales < 0) {
    issues.push({
      kind: "阻断",
      ruleCode: RULES.salesNonNeg.code,
      ruleText: RULES.salesNonNeg.text,
      shiftId: target?.id ?? "(待提交)",
      shiftLabel: target ? shiftLabel(target) : `${draft.date} ${draft.kind}`,
      target: "销售额",
      targetType: "shift",
      diff: Math.min(draft.storeSales, draft.cashSales),
      detail: `店内销售额 ${draft.storeSales}，现金销售额 ${draft.cashSales}`
    });
  }

  // R-COUPON-DUP：提交内重复码（同一券码出现多次即整班拒绝，不计差额）
  const seenInDraft = new Map<string, number>();
  for (const line of draft.coupons) {
    const code = line.code.trim();
    if (!code) continue;
    seenInDraft.set(code, (seenInDraft.get(code) ?? 0) + 1);
  }
  for (const [code, count] of seenInDraft) {
    if (count > 1) {
      const amount = draft.coupons.find((line) => line.code.trim() === code)?.amount ?? 0;
      issues.push({
        kind: "阻断",
        ruleCode: RULES.couponDup.code,
        ruleText: RULES.couponDup.text,
        shiftId: target?.id ?? "(待提交)",
        shiftLabel: target ? shiftLabel(target) : `${draft.date} ${draft.kind}`,
        target: code,
        targetType: "coupon",
        diff: amount * (count - 1),
        detail: `券码 ${code} 在本班次提交中出现 ${count} 次，整班拒绝登记`
      });
    }
  }

  // R-COUPON-UNIQUE：跨班占用（更正时排除本班自身）
  const occupied = buildCouponIndex(state, correctingShiftId);
  for (const line of draft.coupons) {
    const code = line.code.trim();
    if (!code) continue;
    const usages = occupied.get(code);
    if (usages && usages.length > 0) {
      const first = usages[0];
      issues.push({
        kind: "阻断",
        ruleCode: RULES.couponUnique.code,
        ruleText: RULES.couponUnique.text,
        shiftId: target?.id ?? "(待提交)",
        shiftLabel: target ? shiftLabel(target) : `${draft.date} ${draft.kind}`,
        target: code,
        targetType: "coupon",
        diff: line.amount,
        detail: `券码已于 ${first.shift.date} ${first.shift.kind}（${first.shift.cashier}）v${first.version.version} 核销，金额 ${first.amount}；本次重复计额 ${line.amount}`
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 复核闸门：只放行没有未决阻断项的班次 */
export function reviewShift(shift: Shift): RuleIssue[] {
  return findInventoryReasonIssues(shift);
}

/**
 * 全量稽核扫描：刷新后数据一致性检查，供冲突中心展示。
 * 列出跨班重复券码（班次、券码、差额、触发规则）与未定性盘亏盘盈。
 */
export function detectStateConflicts(state: AuditState): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const codeToUsages = buildCouponIndex(state);

  for (const [code, usages] of codeToUsages) {
    // 同一班次多个版本里出现同一券码属于版本留痕，不是跨班冲突：按班次去重
    const byShift = new Map<string, CouponUsage>();
    for (const usage of usages) {
      const existing = byShift.get(usage.shift.id);
      if (!existing || existing.version.createdAt > usage.version.createdAt) {
        byShift.set(usage.shift.id, usage);
      }
    }
    const distinct = [...byShift.values()];
    if (distinct.length < 2) continue;
    // 以“最早一次核销”的班次为持有方，其余班次为重复计额方
    const sorted = [...distinct].sort((a, b) => a.version.createdAt.localeCompare(b.version.createdAt));
    const owner = sorted[0];
    for (const usage of sorted.slice(1)) {
      issues.push({
        kind: "冲突",
        ruleCode: RULES.couponUnique.code,
        ruleText: RULES.couponUnique.text,
        shiftId: usage.shift.id,
        shiftLabel: shiftLabel(usage.shift),
        target: code,
        targetType: "coupon",
        diff: usage.amount,
        detail: `券码 ${code} 首次由 ${owner.shift.date} ${owner.shift.kind} v${owner.version.version} 核销；本班次 v${usage.version.version} 重复计额 ${usage.amount}，只计一次应冲回 ${usage.amount}`
      });
    }
  }

  for (const shift of state.shifts) {
    issues.push(...findInventoryReasonIssues(shift));
  }

  return issues;
}
