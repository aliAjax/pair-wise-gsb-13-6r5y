// 便利店交班稽核台 —— 数据层
// 唯一持久化出口：班次（含版本、券码、库存）整体存一个 envelope，保证刷新后一致。
import { buildVersion, freezeForReview } from "./rules";
import type { Shift, ShiftDraft } from "./types";
import { SHIFT_TYPES } from "./types";

const STORAGE_KEY = "dfwlfront-7-audit-v1";
const STORE_FORMAT = 1;

interface StoreEnvelope {
  format: number;
  shifts: Shift[];
}

/** 种子数据：覆盖已复核冻结、待复核待定性、更正版本链三种形态 */
function buildSeeds(): Shift[] {
  const reviewed: ShiftDraft = {
    date: "2026-09-21",
    shiftType: SHIFT_TYPES[0],
    cashier: "王芳",
    inStoreSales: 3860,
    coupons: [{ id: "seed-c-1", code: "VIP8832", amount: 20 }],
    stock: [
      { id: "seed-s-1", product: "矿泉水 550ml", bookQty: 120, actualQty: 118, reason: "损耗", evidence: "临期破损2瓶，报损单 CL-0921-03" },
      { id: "seed-s-2", product: "三明治", bookQty: 40, actualQty: 40, reason: "", evidence: "" },
    ],
    revisionReason: "",
  };

  const pending: ShiftDraft = {
    date: "2026-09-22",
    shiftType: SHIFT_TYPES[1],
    cashier: "李强",
    inStoreSales: 2980,
    coupons: [{ id: "seed-c-2", code: "VIP1024", amount: 15 }],
    stock: [
      // 盘盈 2 但尚未定性/写依据 —— 复核按钮应被规则拦下
      { id: "seed-s-3", product: "便当", bookQty: 60, actualQty: 62, reason: "", evidence: "" },
    ],
    revisionReason: "",
  };

  // 已复核班次的更正链：v1 已冻结 → 带原因追加 v2 → v2 再冻结，原值保留
  const correctedV1: ShiftDraft = {
    date: "2026-09-20",
    shiftType: SHIFT_TYPES[2],
    cashier: "赵敏",
    inStoreSales: 4120,
    coupons: [{ id: "seed-c-3", code: "VIP7701", amount: 30 }],
    stock: [
      { id: "seed-s-4", product: "瓶装咖啡", bookQty: 80, actualQty: 79, reason: "盗损", evidence: "监控显示非购物离场，已上报值班经理" },
    ],
    revisionReason: "",
  };
  const correctedV2: ShiftDraft = {
    ...correctedV1,
    inStoreSales: 4100,
    coupons: [{ id: "seed-c-4", code: "VIP7701", amount: 10 }],
    revisionReason: "券码 VIP7701 金额误录为30元，按支付小票 XJ-0920-17 更正为10元",
  };

  const v1 = freezeForReview(buildVersion(correctedV1, 1, "2026-09-20T22:05:00.000Z"), "2026-09-20T22:12:00.000Z");
  const v2 = freezeForReview(buildVersion(correctedV2, 2, "2026-09-21T09:20:00.000Z"), "2026-09-21T09:25:00.000Z");

  const shiftReviewedV1 = freezeForReview(
    buildVersion(reviewed, 1, "2026-09-21T14:05:00.000Z"),
    "2026-09-21T14:12:00.000Z",
  );

  return [
    {
      id: "seed-shift-2",
      date: pending.date,
      shiftType: SHIFT_TYPES[1],
      cashier: pending.cashier,
      versions: [buildVersion(pending, 1, "2026-09-22T14:02:00.000Z")],
      status: "待复核",
    },
    {
      id: "seed-shift-1",
      date: reviewed.date,
      shiftType: SHIFT_TYPES[0],
      cashier: reviewed.cashier,
      versions: [shiftReviewedV1],
      status: "已复核",
    },
    {
      id: "seed-shift-3",
      date: "2026-09-20",
      shiftType: SHIFT_TYPES[2],
      cashier: correctedV1.cashier,
      versions: [v1, v2],
      status: "已复核",
    },
  ];
}

function isValidEnvelope(value: unknown): value is StoreEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<StoreEnvelope>;
  return envelope.format === STORE_FORMAT && Array.isArray(envelope.shifts);
}

export function loadShifts(): Shift[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeds = buildSeeds();
      saveShifts(seeds);
      return seeds;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidEnvelope(parsed)) return buildSeeds();
    return parsed.shifts;
  } catch {
    return buildSeeds();
  }
}

export function saveShifts(shifts: Shift[]): void {
  const envelope: StoreEnvelope = { format: STORE_FORMAT, shifts };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function resetSeeds(): Shift[] {
  const seeds = buildSeeds();
  saveShifts(seeds);
  return seeds;
}
