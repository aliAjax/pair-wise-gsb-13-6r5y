// 便利店交班稽核台 —— 领域数据层（仅类型，不含任何规则与界面逻辑）

export const SHIFT_TYPES = ["早班", "中班", "晚班"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export const SHIFT_STATUS = ["待复核", "已复核"] as const;
export type ShiftStatus = (typeof SHIFT_STATUS)[number];

/** 盘亏/盘盈定性原因 */
export const VARIANCE_REASONS = ["损耗", "错录", "盗损"] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

/** 券码核销登记，amount 为该券码抵扣/核销金额 */
export interface Coupon {
  id: string;
  code: string;
  amount: number;
}

/**
 * 单个商品的库存实盘行。
 * diff > 0 为盘盈，diff < 0 为盘亏；
 * 一旦存在 diff，复核前必须补齐 reason 与 evidence。
 */
export interface StockLine {
  id: string;
  product: string;
  bookQty: number;
  actualQty: number;
  reason: VarianceReason | "";
  evidence: string;
}

/** 班次的一次版本：初版为 v1，对已复核班次的更正只能追加新版本 */
export interface ShiftVersion {
  version: number;
  inStoreSales: number;
  coupons: Coupon[];
  stock: StockLine[];
  createdAt: string;
  /** 更正原因；初版为空，后续版本必填 */
  revisionReason: string;
  /** 已复核版本的冻结校验值，用于刷新后发现篡改 */
  checksum: string;
  reviewedAt: string;
}

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  shiftType: ShiftType;
  cashier: string;
  versions: ShiftVersion[];
  status: ShiftStatus;
}

/** 编辑器/新建表单使用的草稿 */
export interface ShiftDraft {
  date: string;
  shiftType: ShiftType | "";
  cashier: string;
  inStoreSales: number;
  coupons: Array<{ id: string; code: string; amount: number }>;
  stock: StockLine[];
  revisionReason: string;
}

export interface Conflict {
  ruleId: string;
  ruleName: string;
  shiftId: string;
  shiftLabel: string;
  couponCode: string;
  diff: string;
  detail: string;
  severity: "error" | "warn";
}

/** 提交（保存/更正）时整班拒绝的原因明细 */
export interface SubmissionIssue {
  field: string;
  message: string;
}

export interface ActionResult {
  ok: boolean;
  issues: SubmissionIssue[];
}
