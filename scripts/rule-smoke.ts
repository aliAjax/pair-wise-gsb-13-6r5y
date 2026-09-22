// 规则层冒烟验证（不入仓库依赖，临时脚本，用 esbuild 转译后 node 执行）
import { validateShiftSubmission, reviewShift, detectStateConflicts } from "../src/rules/auditRules";
import type { AuditState, ShiftDraft } from "../src/data/types";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

const baseDraft = (over: Partial<ShiftDraft> = {}): ShiftDraft => ({
  date: "2026-09-22",
  kind: "早班",
  cashier: "测试员",
  storeSales: 1000,
  cashSales: 200,
  coupons: [{ code: "CPN-X1", amount: 10 }],
  inventory: [{ sku: "SKU-001", name: "瓶装水", bookQty: 10, actualQty: 10 }],
  correctionReason: "",
  ...over
});

const stateWithOneShift: AuditState = {
  shifts: [
    {
      id: "s1",
      date: "2026-09-21",
      kind: "早班",
      cashier: "甲",
      status: "已复核",
      createdAt: "2026-09-21T00:00:00.000Z",
      reviewedAt: "2026-09-21T01:00:00.000Z",
      reviewer: "站长",
      versions: [
        {
          id: "s1-v1",
          version: 1,
          storeSales: 500,
          cashSales: 100,
          coupons: [{ code: "CPN-A", amount: 20 }],
          inventory: [{ sku: "SKU-001", name: "瓶装水", bookQty: 10, actualQty: 10 }],
          createdAt: "2026-09-21T00:00:00.000Z"
        }
      ]
    }
  ]
};

console.log("1. 合法提交通过");
{
  const r = validateShiftSubmission(baseDraft(), { shifts: [] });
  assert("ok=true 且无命中", r.ok && r.issues.length === 0, r);
}

console.log("2. R-COUPON-DUP 班内重复码整班拒绝");
{
  const r = validateShiftSubmission(
    baseDraft({ coupons: [{ code: "CPN-DUP", amount: 15 }, { code: "CPN-DUP", amount: 15 }] }),
    { shifts: [] }
  );
  assert("ok=false", !r.ok);
  assert("命中 R-COUPON-DUP", r.issues.some((i) => i.ruleCode === "R-COUPON-DUP"));
  assert("差额=重复计额15", r.issues.find((i) => i.ruleCode === "R-COUPON-DUP")?.diff === 15);
}

console.log("3. R-COUPON-UNIQUE 跨班已核销码拒绝");
{
  const r = validateShiftSubmission(
    baseDraft({ coupons: [{ code: "CPN-A", amount: 20 }] }),
    stateWithOneShift
  );
  assert("ok=false", !r.ok);
  const hit = r.issues.find((i) => i.ruleCode === "R-COUPON-UNIQUE");
  assert("命中 R-COUPON-UNIQUE", !!hit);
  assert("target 是券码", hit?.target === "CPN-A");
  assert("差额=20", hit?.diff === 20);
}

console.log("4. R-SALES-NONNEG 负销售额拒绝");
{
  const r = validateShiftSubmission(baseDraft({ storeSales: -1 }), { shifts: [] });
  assert("ok=false 且命中", !r.ok && r.issues.some((i) => i.ruleCode === "R-SALES-NONNEG"));
}

console.log("5. R-INV-REASON 盘亏未定性不得复核");
{
  const shift = structuredClone(stateWithOneShift.shifts[0]);
  shift.versions[0].inventory = [{ sku: "SKU-002", name: "薯片", bookQty: 10, actualQty: 8 }];
  const issues = reviewShift(shift);
  assert("复核被阻断", issues.length === 1 && issues[0].ruleCode === "R-INV-REASON");
  assert("差额为盘亏 -2", issues[0].diff === -2);

  shift.versions[0].inventory[0] = { ...shift.versions[0].inventory[0], reason: "损耗" };
  const issues2 = reviewShift(shift);
  assert("只选原因没写依据仍阻断", issues2.length === 1);

  shift.versions[0].inventory[0] = {
    ...shift.versions[0].inventory[0],
    reason: "损耗",
    basis: "临期破损"
  };
  assert("定性+依据齐全可复核", reviewShift(shift).length === 0);
}

console.log("6. R-INV-REASON 盘盈同样适用");
{
  const shift = structuredClone(stateWithOneShift.shifts[0]);
  shift.versions[0].inventory = [{ sku: "SKU-002", name: "薯片", bookQty: 10, actualQty: 12, reason: "错录", basis: "入库漏登" }];
  assert("盘盈已定性可复核", reviewShift(shift).length === 0);
}

console.log("7. 更正规则：待复核班次不得开版本、更正必须写原因、身份不可变");
{
  const pending = structuredClone(stateWithOneShift.shifts[0]);
  pending.id = "s2";
  pending.status = "待复核";
  const st: AuditState = { shifts: [pending] };
  const noReason = validateShiftSubmission(
    baseDraft({ date: pending.date, kind: pending.kind, cashier: pending.cashier }),
    st,
    "s2"
  );
  assert("待复核班次更正被 R-FROZEN 拒绝", !noReason.ok && noReason.issues.some((i) => i.ruleCode === "R-FROZEN"));

  const frozen = stateWithOneShift;
  const r = validateShiftSubmission(
    baseDraft({ date: "2026-09-21", kind: "早班", cashier: "甲" }), // 有原因? -> 没有
    frozen,
    "s1"
  );
  assert("已复核但无更正原因被拒", !r.ok && r.issues.some((i) => i.detail?.includes("更正必须填写原因")));

  const changedIdentity = validateShiftSubmission(
    baseDraft({ date: "2026-09-21", kind: "早班", cashier: "乙", correctionReason: "记错人了" }),
    frozen,
    "s1"
  );
  assert("更改收银员命中 R-IDENTITY", changedIdentity.issues.some((i) => i.ruleCode === "R-IDENTITY"));

  // 更正使用同券码（本班自身历史版本）不应算跨班重复
  const sameCoupon = validateShiftSubmission(
    baseDraft({
      date: "2026-09-21",
      kind: "早班",
      cashier: "甲",
      coupons: [{ code: "CPN-A", amount: 20 }],
      correctionReason: "金额录入更正"
    }),
    frozen,
    "s1"
  );
  assert("本班自身历史券码不构成跨班冲突", sameCoupon.ok, sameCoupon.issues);
}

console.log("8. detectStateConflicts 冲突表含班次/券码/差额/规则");
{
  const twoShifts: AuditState = structuredClone(stateWithOneShift);
  twoShifts.shifts.push({
    id: "s2",
    date: "2026-09-22",
    kind: "中班",
    cashier: "乙",
    status: "待复核",
    createdAt: "2026-09-22T06:00:00.000Z",
    versions: [
      {
        id: "s2-v1",
        version: 1,
        storeSales: 300,
        cashSales: 0,
        coupons: [{ code: "CPN-A", amount: 20 }],
        inventory: [{ sku: "SKU-003", name: "口香糖", bookQty: 5, actualQty: 3 }],
        createdAt: "2026-09-22T06:00:00.000Z"
      }
    ]
  });
  const issues = detectStateConflicts(twoShifts);
  const couponHit = issues.find((i) => i.target === "CPN-A");
  assert("列出重复券码", !!couponHit);
  assert("归责到后一班次 s2", couponHit?.shiftId === "s2");
  assert("差额 20", couponHit?.diff === 20);
  assert("规则码正确", couponHit?.ruleCode === "R-COUPON-UNIQUE");
  assert("标签包含班次信息", /中班.*乙/.test(couponHit?.shiftLabel ?? ""));
  const invHit = issues.find((i) => i.ruleCode === "R-INV-REASON");
  assert("同时列出未定性盘亏", invHit?.diff === -2);
}

console.log("9. 已复核班次历史版本的券码在更正后仍留痕：v1码A, v2码B，两码都占用");
{
  const st: AuditState = {
    shifts: [
      {
        ...stateWithOneShift.shifts[0],
        versions: [
          stateWithOneShift.shifts[0].versions[0],
          {
            id: "s1-v2",
            version: 2,
            storeSales: 520,
            cashSales: 100,
            coupons: [{ code: "CPN-B", amount: 30 }],
            inventory: [{ sku: "SKU-001", name: "瓶装水", bookQty: 10, actualQty: 10 }],
            createdAt: "2026-09-21T02:00:00.000Z",
            correctionReason: "补录券码",
            previousVersionId: "s1-v1"
          }
        ]
      }
    ]
  };
  const useA = validateShiftSubmission(baseDraft({ coupons: [{ code: "CPN-A", amount: 1 }] }), st);
  const useB = validateShiftSubmission(baseDraft({ coupons: [{ code: "CPN-B", amount: 1 }] }), st);
  assert("历史 v1 的 CPN-A 仍占用", !useA.ok);
  assert("当前 v2 的 CPN-B 占用", !useB.ok);

  const conflicts = detectStateConflicts(st);
  assert("同一班次跨版本相同/不同券码都不报跨班冲突", conflicts.length === 0, conflicts);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
