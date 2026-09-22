// 数据层：便利店交班稽核的领域模型

export type ShiftKind = "早班" | "中班" | "晚班";
export type ShiftStatus = "待复核" | "已复核";
export type VarianceReason = "损耗" | "错录" | "盗损";

export type IssueKind = "冲突" | "阻断";

export interface CouponLine {
  code: string;
  amount: number;
}

export interface InventoryLine {
  sku: string;
  name: string;
  /** 接班/系统账面库存 */
  bookQty: number;
  /** 当班实盘库存 */
  actualQty: number;
  /** 盘亏或盘盈的定性：损耗 / 错录 / 盗损 */
  reason?: VarianceReason;
  /** 定性依据，未填不得复核 */
  basis?: string;
}

/** 班次内容快照：销售额、券码核销、实盘库存，全部随版本留档 */
export interface ShiftVersion {
  id: string;
  /** 版本号，从 1 开始；更正一次 +1 */
  version: number;
  storeSales: number;
  cashSales: number;
  coupons: CouponLine[];
  inventory: InventoryLine[];
  createdAt: string;
  /** 更正原因，初版为空 */
  correctionReason?: string;
  /** 上一版本 id，构成完整版本链 */
  previousVersionId?: string;
}

export interface Shift {
  id: string;
  date: string;
  kind: ShiftKind;
  cashier: string;
  versions: ShiftVersion[];
  status: ShiftStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewer?: string;
}

export interface ShiftDraft {
  date: string;
  kind: ShiftKind;
  cashier: string;
  storeSales: number;
  cashSales: number;
  coupons: CouponLine[];
  inventory: InventoryLine[];
  correctionReason: string;
}

export interface RuleIssue {
  kind: IssueKind;
  ruleCode: string;
  ruleText: string;
  shiftId: string;
  shiftLabel: string;
  /** 券码 / 对象：冲突必须落到具体券码；其他规则为对象名 */
  target: string;
  targetType: "coupon" | "inventory" | "shift";
  /** 差额：重复金额或盘亏盘盈数量，无差额时为 0 */
  diff: number;
  detail?: string;
}

export interface SubmitResult {
  ok: boolean;
  issues: RuleIssue[];
}

export interface AuditState {
  shifts: Shift[];
}
