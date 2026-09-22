// 数据层：演示用种子班次，首次加载写入 localStorage

import type { AuditState } from "./types";

function isoDaysAgo(days: number, hour = 8): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const SEED_STATE: AuditState = {
  shifts: [
    {
      id: "seed-1",
      date: new Date(isoDaysAgo(1)).toISOString().slice(0, 10),
      kind: "早班",
      cashier: "王磊",
      status: "已复核",
      createdAt: isoDaysAgo(1, 8),
      reviewedAt: isoDaysAgo(1, 9),
      reviewer: "站长 赵敏",
      versions: [
        {
          id: "seed-1-v1",
          version: 1,
          storeSales: 4280,
          cashSales: 1300,
          coupons: [
            { code: "CPN-3001", amount: 20 },
            { code: "CPN-3002", amount: 15 }
          ],
          inventory: [
            { sku: "SKU-001", name: "瓶装水 550ml", bookQty: 120, actualQty: 120 },
            { sku: "SKU-002", name: "功能饮料 250ml", bookQty: 80, actualQty: 78, reason: "损耗", basis: "冰柜临期破损 2 罐，已拍照留档" }
          ],
          createdAt: isoDaysAgo(1, 8)
        }
      ]
    },
    {
      id: "seed-2",
      date: new Date(isoDaysAgo(1)).toISOString().slice(0, 10),
      kind: "中班",
      cashier: "李娜",
      status: "待复核",
      createdAt: isoDaysAgo(1, 14),
      versions: [
        {
          id: "seed-2-v1",
          version: 1,
          storeSales: 3650,
          cashSales: 980,
          coupons: [{ code: "CPN-3003", amount: 30 }],
          inventory: [
            { sku: "SKU-001", name: "瓶装水 550ml", bookQty: 120, actualQty: 120 },
            { sku: "SKU-003", name: "薯片 大包装", bookQty: 40, actualQty: 42, reason: "错录", basis: "上架 2 袋未登记入库，已补录" }
          ],
          createdAt: isoDaysAgo(1, 14)
        }
      ]
    },
    {
      id: "seed-3",
      date: new Date(isoDaysAgo(0)).toISOString().slice(0, 10),
      kind: "早班",
      cashier: "王磊",
      status: "待复核",
      createdAt: isoDaysAgo(0, 8),
      versions: [
        {
          id: "seed-3-v1",
          version: 1,
          storeSales: 3120,
          cashSales: 760,
          coupons: [
            { code: "CPN-3002", amount: 15 },
            { code: "CPN-3002", amount: 15 },
            { code: "CPN-3004", amount: 10 }
          ],
          inventory: [
            { sku: "SKU-001", name: "瓶装水 550ml", bookQty: 120, actualQty: 115, reason: "损耗" },
            { sku: "SKU-004", name: "热狗面包", bookQty: 30, actualQty: 28 }
          ],
          createdAt: isoDaysAgo(0, 8)
        }
      ]
    }
  ]
};
