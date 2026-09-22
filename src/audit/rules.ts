// 便利店交班稽核台 —— 业务规则层
// 纯函数：不读写存储、不碰 DOM，页面与存储层都通过这里做校验/冻结/稽核。
import type {
  ActionResult,
  Conflict,
  Coupon,
  Shift,
  ShiftDraft,
  ShiftVersion,
  StockLine,
  VarianceReason,
} from "./types";
import { VARIANCE_REASONS } from "./types";

/** 触发规则的集中清单，冲突列表中 ruleId/ruleName 均取自此处，便于维护 */
export const RULES = {
  REQUIRED_FIELD: { id: "R01", name: "必填项校验" },
  NUMBER_RANGE: { id: "R02", name: "数值合法性" },
  COUPON_DUPLICATE: { id: "R03", name: "同一券码跨班只计一次" },
  VARIANCE_JUSTIFICATION: { id: "R04", name: "盘亏盘盈须定性并写依据" },
  REVIEW_FREEZE: { id: "R05", name: "已复核班次冻结" },
  REVISION_REASON: { id: "R06", name: "更正必须带原因并保留原值" },
  CHECKSUM_TAMPER: { id: "R07", name: "冻结数据一致性校验" },
} as const;

export function stockDiff(line: StockLine): number {
  return Number(line.actualQty) - Number(line.bookQty);
}

export function hasVariance(line: StockLine): boolean {
  return stockDiff(line) !== 0;
}

export function isVarianceReason(value: string): value is VarianceReason {
  return (VARIANCE_REASONS as readonly string[]).includes(value);
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newLineId(): string {
  return uid();
}

export function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function shiftLabel(shift: Pick<Shift, "date" | "shiftType" | "cashier">): string {
  return `${shift.date} ${shift.shiftType}（${shift.cashier || "未填交班人"}）`;
}

/** 简单稳定的校验值：已复核版本一旦被改动，刷新后即与 checksum 不符 */
export function versionChecksum(version: Omit<ShiftVersion, "checksum">): string {
  const payload = JSON.stringify([
    version.version,
    version.inStoreSales,
    version.coupons.map((c) => [c.code, c.amount]),
    version.stock.map((s) => [s.product, s.bookQty, s.actualQty, s.reason, s.evidence]),
    version.createdAt,
    version.revisionReason,
    version.reviewedAt,
  ]);
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return `c${(hash >>> 0).toString(16)}`;
}

/** 校验草稿本身（必填、数值、盘亏盘盈定性依据），不含跨班次规则 */
export function validateDraft(draft: ShiftDraft): ActionResult {
  const issues: ActionResult["issues"] = [];
  const reject = (field: string, message: string) => issues.push({ field, message });

  if (!draft.date) reject("date", "请选择交班日期");
  if (!draft.shiftType) reject("shiftType", "请选择班次");
  if (!draft.cashier.trim()) reject("cashier", "请填写交班人");

  if (!Number.isFinite(draft.inStoreSales) || draft.inStoreSales < 0) {
    reject("inStoreSales", "店内销售额须为不小于 0 的数字");
  }

  draft.coupons.forEach((coupon, index) => {
    const where = `coupons.${index}`;
    if (!coupon.code.trim()) reject(where, `第 ${index + 1} 条券码为空`);
    if (!Number.isFinite(coupon.amount) || coupon.amount <= 0) {
      reject(where, `第 ${index + 1} 条券码核销金额须大于 0`);
    }
  });

  draft.stock.forEach((line, index) => {
    if (!line.product.trim()) {
      reject(`stock.${index}.product`, `第 ${index + 1} 行商品名为空，请删除该行或补全`);
    }
    if (!Number.isFinite(line.bookQty) || line.bookQty < 0) {
      reject(`stock.${index}.bookQty`, `第 ${index + 1} 行账面数量非法`);
    }
    if (!Number.isFinite(line.actualQty) || line.actualQty < 0) {
      reject(`stock.${index}.actualQty`, `第 ${index + 1} 行实盘数量非法`);
    }
    if (hasVariance(line)) {
      if (!isVarianceReason(line.reason)) {
        reject(`stock.${index}.reason`, `「${line.product || `第 ${index + 1} 行`}」盘${stockDiff(line) > 0 ? "盈" : "亏"}须选择损耗/错录/盗损`);
      }
      if (!line.evidence.trim()) {
        reject(`stock.${index}.evidence`, `「${line.product || `第 ${index + 1} 行`}」须填写盘${stockDiff(line) > 0 ? "盈" : "亏"}依据，未填不得复核`);
      }
    }
  });

  return { ok: issues.length === 0, issues };
}

/** 收集全班次券码（同一班次多版本只取最新有效版本），返回 code -> 首次占用信息 */
export function occupiedCoupons(
  shifts: Shift[],
  excludeShiftId?: string,
): Map<string, { shiftId: string; label: string }> {
  const map = new Map<string, { shiftId: string; label: string }>();
  // 先按创建顺序稳定遍历；后出现的重复券码属于冲突，首个占用者保留
  for (const shift of shifts) {
    if (shift.id === excludeShiftId) continue;
    const version = latestVersion(shift);
    if (!version) continue;
    for (const coupon of version.coupons) {
      const code = coupon.code.trim();
      if (code && !map.has(code)) {
        map.set(code, { shiftId: shift.id, label: shiftLabel(shift) });
      }
    }
  }
  return map;
}

/**
 * 保存/更正整班提交校验：
 * 任一问题即整班拒绝（返回 ok:false，不落任何数据）。
 * 对已复核班次的更正要求必须填写更正原因。
 */
export function validateSubmission(
  shifts: Shift[],
  draft: ShiftDraft,
  target: { shiftId?: string; nextVersion: number },
): ActionResult {
  const base = validateDraft(draft);
  if (!base.ok) return base;

  const issues: ActionResult["issues"] = [];
  const occupied = occupiedCoupons(shifts, target.shiftId);
  const seenInDraft = new Set<string>();
  draft.coupons.forEach((coupon, index) => {
    const code = coupon.code.trim();
    if (seenInDraft.has(code)) {
      issues.push({ field: `coupons.${index}`, message: `券码 ${code} 在本班次内重复登记` });
    }
    seenInDraft.add(code);
    const owner = occupied.get(code);
    if (owner) {
      issues.push({
        field: `coupons.${index}`,
        message: `券码 ${code} 已在 ${owner.label} 核销，跨班只计一次（${RULES.COUPON_DUPLICATE.id}）`,
      });
    }
  });

  if (target.nextVersion > 1 && !draft.revisionReason.trim()) {
    issues.push({
      field: "revisionReason",
      message: `更正为 v${target.nextVersion} 必须填写更正原因，原值将原样保留（${RULES.REVISION_REASON.id}）`,
    });
  }

  return { ok: issues.length === 0, issues };
}

export function latestVersion(shift: Shift): ShiftVersion | undefined {
  return shift.versions[shift.versions.length - 1];
}

/** 由草稿构造一个新版本对象（checksum 留空，复核时再冻结） */
export function buildVersion(draft: ShiftDraft, version: number, now: string): ShiftVersion {
  const coupons: Coupon[] = draft.coupons
    .filter((c) => c.code.trim())
    .map((c) => ({ id: c.id, code: c.code.trim(), amount: c.amount }));
  const stock: StockLine[] = draft.stock.map((line) => ({
    id: line.id,
    product: line.product.trim(),
    bookQty: line.bookQty,
    actualQty: line.actualQty,
    reason: hasVariance(line) ? line.reason : "",
    evidence: hasVariance(line) ? line.evidence.trim() : "",
  }));
  const unfrozen: Omit<ShiftVersion, "checksum"> = {
    version,
    inStoreSales: draft.inStoreSales,
    coupons,
    stock,
    createdAt: now,
    revisionReason: version > 1 ? draft.revisionReason.trim() : "",
    reviewedAt: "",
  };
  return { ...unfrozen, checksum: "" };
}

/** 复核：规则要求盘亏盘盈未定性/未写依据不得复核；通过后冻结版本 */
export function freezeForReview(version: ShiftVersion, now: string): ShiftVersion {
  const frozen: Omit<ShiftVersion, "checksum"> = { ...version, reviewedAt: now };
  return { ...frozen, checksum: versionChecksum(frozen) };
}

/** 已复核但被改动（冻结失效）检测，供刷新后稽核 */
export function isFrozenIntact(version: ShiftVersion): boolean {
  if (!version.reviewedAt || !version.checksum) return true; // 未复核版本不受冻结约束
  const { checksum, ...rest } = version;
  return versionChecksum(rest) === checksum;
}

export function canReview(shift: Shift): { ok: boolean; issues: string[] } {
  const version = latestVersion(shift);
  if (!version) return { ok: false, issues: ["班次没有任何版本"] };
  const issues: string[] = [];
  version.stock.forEach((line) => {
    if (hasVariance(line)) {
      if (!isVarianceReason(line.reason))
        issues.push(`「${line.product}」盘${stockDiff(line) > 0 ? "盈" : "亏"}未选择损耗/错录/盗损`);
      if (!line.evidence.trim())
        issues.push(`「${line.product}」未填写盘${stockDiff(line) > 0 ? "盈" : "亏"}依据`);
    }
  });
  return { ok: issues.length === 0, issues };
}

/**
 * 刷新后全量稽核：
 * 1) 已复核冻结版本被改动（checksum 不符）
 * 2) 券码跨班重复（以最新版本为准，列全部非首次占用班次）
 * 3) 已复核版本内存在未定性/无依据的盘亏盘盈（绕过页面写入的脏数据）
 */
export function auditConflicts(shifts: Shift[]): Conflict[] {
  const conflicts: Conflict[] = [];

  // 1. 冻结一致性
  for (const shift of shifts) {
    for (const version of shift.versions) {
      if (version.reviewedAt && !isFrozenIntact(version)) {
        conflicts.push({
          ruleId: RULES.CHECKSUM_TAMPER.id,
          ruleName: RULES.CHECKSUM_TAMPER.name,
          shiftId: shift.id,
          shiftLabel: shiftLabel(shift),
          couponCode: "-",
          diff: `v${version.version} 冻结值已变化`,
          detail: "已复核版本被改动，与冻结校验值不一致",
          severity: "error",
        });
      }
    }
  }

  // 2. 券码跨班重复
  const firstOwner = new Map<string, { shiftId: string; label: string }>();
  for (const shift of shifts) {
    const version = latestVersion(shift);
    if (!version) continue;
    for (const coupon of version.coupons) {
      const code = coupon.code.trim();
      if (!code) continue;
      if (!firstOwner.has(code)) {
        firstOwner.set(code, { shiftId: shift.id, label: shiftLabel(shift) });
      } else {
        const owner = firstOwner.get(code)!;
        conflicts.push({
          ruleId: RULES.COUPON_DUPLICATE.id,
          ruleName: RULES.COUPON_DUPLICATE.name,
          shiftId: shift.id,
          shiftLabel: shiftLabel(shift),
          couponCode: code,
          diff: formatDiff(0),
          detail: `券码 ${code} 已在 ${owner.label} 计过一次，本班次不应重复核销`,
          severity: "error",
        });
      }
    }
  }

  // 3. 已复核班次库存定性缺失（数据一致性兜底）
  for (const shift of shifts) {
    const version = latestVersion(shift);
    if (!version || shift.status !== "已复核") continue;
    for (const line of version.stock) {
      if (!hasVariance(line)) continue;
      const missingReason = !isVarianceReason(line.reason);
      const missingEvidence = !line.evidence.trim();
      if (missingReason || missingEvidence) {
        conflicts.push({
          ruleId: RULES.VARIANCE_JUSTIFICATION.id,
          ruleName: RULES.VARIANCE_JUSTIFICATION.name,
          shiftId: shift.id,
          shiftLabel: shiftLabel(shift),
          couponCode: "-",
          diff: `${line.product} ${formatDiff(stockDiff(line))}`,
          detail: `已复核班次存在未${missingReason ? "定性" : ""}${missingReason && missingEvidence ? "/" : ""}${missingEvidence ? "写依据" : ""}的盘${stockDiff(line) > 0 ? "盈" : "亏"}`,
          severity: "error",
        });
      }
    }
  }

  return conflicts;
}
