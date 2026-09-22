// 数据层：门店商品目录（SKU 账面库存的基础数据）

export interface CatalogItem {
  sku: string;
  name: string;
  unit: string;
}

export const CATALOG: readonly CatalogItem[] = [
  { sku: "SKU-001", name: "瓶装水 550ml", unit: "瓶" },
  { sku: "SKU-002", name: "功能饮料 250ml", unit: "罐" },
  { sku: "SKU-003", name: "薯片 大包装", unit: "袋" },
  { sku: "SKU-004", name: "热狗面包", unit: "个" },
  { sku: "SKU-005", name: "口香糖", unit: "盒" },
  { sku: "SKU-006", name: "机油 1L", unit: "瓶" }
];

export function catalogName(sku: string): string {
  return CATALOG.find((item) => item.sku === sku)?.name ?? sku;
}
