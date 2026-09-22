<script setup lang="ts">
// 页面层：班次登记表单。新建与“冻结后更正”共用；只负责采集与展示规则结论。
import { reactive, ref, watch } from "vue";
import { CATALOG, catalogName } from "../data/catalog";
import { correctShift, latestVersion, submitShift } from "../data/store";
import type {
  CouponLine,
  InventoryLine,
  RuleIssue,
  Shift,
  ShiftDraft,
  ShiftKind,
  VarianceReason
} from "../data/types";

const props = defineProps<{ mode: "create" | "correct"; shift: Shift | null }>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const SHIFT_KINDS: ShiftKind[] = ["早班", "中班", "晚班"];
const REASONS: VarianceReason[] = ["损耗", "错录", "盗损"];

interface CouponRow {
  code: string;
  amount: number | null;
}
interface InventoryRow {
  sku: string;
  name: string;
  bookQty: number | null;
  actualQty: number | null;
  reason: "" | VarianceReason;
  basis: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankForm() {
  return {
    date: today(),
    kind: "早班" as ShiftKind,
    cashier: "",
    storeSales: null as number | null,
    cashSales: null as number | null,
    correctionReason: ""
  };
}

const head = reactive(blankForm());
const coupons = ref<CouponRow[]>([{ code: "", amount: null }]);
const inventory = ref<InventoryRow[]>([
  { sku: "", name: "", bookQty: null, actualQty: null, reason: "", basis: "" }
]);
const returnedIssues = ref<RuleIssue[]>([]);
const formErrors = ref<string[]>([]);

function resetFromProps() {
  returnedIssues.value = [];
  formErrors.value = [];
  if (props.mode === "correct" && props.shift) {
    const v = latestVersion(props.shift);
    head.date = props.shift.date;
    head.kind = props.shift.kind;
    head.cashier = props.shift.cashier;
    head.storeSales = v.storeSales;
    head.cashSales = v.cashSales;
    head.correctionReason = "";
    coupons.value = v.coupons.map((line: CouponLine) => ({ code: line.code, amount: line.amount }));
    if (coupons.value.length === 0) coupons.value.push({ code: "", amount: null });
    inventory.value = v.inventory.map((line: InventoryLine) => ({
      sku: line.sku,
      name: line.name,
      bookQty: line.bookQty,
      actualQty: line.actualQty,
      reason: line.reason ?? "",
      basis: line.basis ?? ""
    }));
  } else {
    Object.assign(head, blankForm());
    coupons.value = [{ code: "", amount: null }];
    inventory.value = [
      { sku: "", name: "", bookQty: null, actualQty: null, reason: "", basis: "" }
    ];
  }
}

watch(() => [props.mode, props.shift?.id], resetFromProps, { immediate: true });

function addCoupon() {
  coupons.value.push({ code: "", amount: null });
}
function removeCoupon(index: number) {
  coupons.value.splice(index, 1);
}
function addInventory() {
  inventory.value.push({ sku: "", name: "", bookQty: null, actualQty: null, reason: "", basis: "" });
}
function removeInventory(index: number) {
  inventory.value.splice(index, 1);
}
function onSkuChange(row: InventoryRow) {
  row.name = row.sku ? catalogName(row.sku) : "";
}

function variance(row: InventoryRow): number {
  if (row.bookQty === null || row.actualQty === null) return 0;
  return row.actualQty - row.bookQty;
}

function varianceText(row: InventoryRow): string {
  const diff = variance(row);
  if (diff === 0) return "—";
  return `${diff > 0 ? "盘盈" : "盘亏"} ${Math.abs(diff)}`;
}

/** 表单完整性校验：规则层只管业务规则，空行/缺项在此拦截 */
function buildDraft(): ShiftDraft | null {
  const errors: string[] = [];
  if (!head.cashier.trim()) errors.push("请填写交班收银员");
  if (head.storeSales === null || head.storeSales < 0) errors.push("请填写店内销售额（不得为负）");
  if (head.cashSales === null || head.cashSales < 0) errors.push("请填写现金销售额（不得为负）");
  if (props.mode === "correct" && !head.correctionReason.trim()) {
    errors.push("更正已复核班次必须填写更正原因");
  }

  const couponLines: CouponLine[] = [];
  coupons.value.forEach((row, i) => {
    const code = row.code.trim();
    const empty = !code && row.amount === null;
    if (empty) return;
    if (!code) errors.push(`券码第 ${i + 1} 行缺少券码`);
    if (row.amount === null || row.amount < 0) errors.push(`券码第 ${i + 1} 行缺少核销金额`);
    if (code && row.amount !== null) couponLines.push({ code, amount: row.amount });
  });

  const inventoryLines: InventoryLine[] = [];
  inventory.value.forEach((row, i) => {
    const empty = !row.sku && row.bookQty === null && row.actualQty === null;
    if (empty) return;
    if (!row.sku) errors.push(`库存第 ${i + 1} 行未选择商品`);
    if (row.bookQty === null) errors.push(`库存第 ${i + 1} 行缺少账面数量`);
    if (row.actualQty === null) errors.push(`库存第 ${i + 1} 行缺少实盘数量`);
    if (!row.sku || row.bookQty === null || row.actualQty === null) return;

    const diff = row.actualQty - row.bookQty;
    if (diff !== 0) {
      if (!row.reason) errors.push(`「${row.name}」存在盘亏/盘盈，必须选择损耗、错录或盗损`);
      if (!row.basis.trim()) errors.push(`「${row.name}」存在盘亏/盘盈，必须填写定性依据`);
    }
    inventoryLines.push({
      sku: row.sku,
      name: row.name || catalogName(row.sku),
      bookQty: row.bookQty,
      actualQty: row.actualQty,
      reason: diff !== 0 ? (row.reason || undefined) : undefined,
      basis: diff !== 0 ? row.basis.trim() : undefined
    });
  });
  if (inventoryLines.length === 0) errors.push("每班至少登记一条实盘库存");

  formErrors.value = errors;
  if (errors.length > 0) return null;

  return {
    date: head.date,
    kind: head.kind,
    cashier: head.cashier.trim(),
    storeSales: Number(head.storeSales),
    cashSales: Number(head.cashSales),
    coupons: couponLines,
    inventory: inventoryLines,
    correctionReason: head.correctionReason
  };
}

function save() {
  const draft = buildDraft();
  if (!draft) return;

  const result =
    props.mode === "correct" && props.shift
      ? correctShift(props.shift.id, draft)
      : submitShift(draft);

  if (!result.ok) {
    // 规则层阻断：整班拒绝，页面不做任何落库
    returnedIssues.value = result.issues;
    return;
  }
  emit("done");
}
</script>

<template>
  <form class="panel shift-form" @submit.prevent="save">
    <div class="panel-title">
      <h2>{{ mode === "correct" ? "更正已复核班次" : "班次交班登记" }}</h2>
      <span v-if="mode === 'correct'" class="badge badge-frozen">冻结更正 · 原值保留</span>
    </div>
    <p v-if="mode === 'correct' && shift" class="form-hint">
      正在更正 {{ shift.date }} {{ shift.kind }}（{{ shift.cashier }}），当前为 v{{ latestVersion(shift).version }}。
      更正将新建 v{{ latestVersion(shift).version + 1 }}，日期/班次/收银员不可变更。
    </p>

    <div class="form-grid">
      <div class="row-3">
        <label>
          交班日期
          <input v-model="head.date" type="date" :disabled="mode === 'correct'" required />
        </label>
        <label>
          班次
          <select v-model="head.kind" :disabled="mode === 'correct'">
            <option v-for="k in SHIFT_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </label>
        <label>
          收银员
          <input v-model="head.cashier" type="text" placeholder="姓名"
                 :disabled="mode === 'correct'" required />
        </label>
      </div>

      <div class="row-2">
        <label>
          店内销售额（元）
          <input v-model.number="head.storeSales" type="number" min="0" step="0.01" required />
        </label>
        <label>
          其中现金销售额（元）
          <input v-model.number="head.cashSales" type="number" min="0" step="0.01" required />
        </label>
      </div>

      <fieldset>
        <legend>券码核销 <em>同一券码跨班只计一次，重复提交整班拒绝</em></legend>
        <div v-for="(row, i) in coupons" :key="i" class="line-row">
          <input v-model="row.code" class="grow" type="text" placeholder="券码，如 CPN-3001" />
          <input v-model.number="row.amount" type="number" min="0" step="0.01" placeholder="核销金额" />
          <button type="button" class="secondary mini" @click="removeCoupon(i)"
                  :disabled="coupons.length === 1">删除</button>
        </div>
        <button type="button" class="secondary mini" @click="addCoupon">+ 添加券码</button>
      </fieldset>

      <fieldset>
        <legend>实盘库存 <em>盘亏/盘盈须定性（损耗·错录·盗损）并写依据</em></legend>
        <div v-for="(row, i) in inventory" :key="i" class="inventory-block">
          <div class="line-row">
            <select v-model="row.sku" class="grow" @change="onSkuChange(row)">
              <option value="">选择商品</option>
              <option v-for="item in CATALOG" :key="item.sku" :value="item.sku">
                {{ item.sku }} · {{ item.name }}
              </option>
            </select>
            <button type="button" class="secondary mini" @click="removeInventory(i)"
                    :disabled="inventory.length === 1">删除</button>
          </div>
          <div class="row-3">
            <label>账面数量<input v-model.number="row.bookQty" type="number" min="0" /></label>
            <label>实盘数量<input v-model.number="row.actualQty" type="number" min="0" /></label>
            <label>
              盘差
              <input :value="varianceText(row)" disabled
                     :class="{ 'var-loss': variance(row) < 0, 'var-gain': variance(row) > 0 }" />
            </label>
          </div>
          <template v-if="variance(row) !== 0">
            <label>
              差异定性（必选）
              <select v-model="row.reason">
                <option value="">请选择损耗 / 错录 / 盗损</option>
                <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label>
              依据（必填，未填不得复核）
              <textarea v-model="row.basis" rows="2" placeholder="如：监控显示凌晨被盗、入库漏登、临期报损单号…"></textarea>
            </label>
          </template>
        </div>
        <button type="button" class="secondary mini" @click="addInventory">+ 添加商品行</button>
      </fieldset>

      <fieldset v-if="mode === 'correct'">
        <legend>更正原因 <em>必填，随新版本留档</em></legend>
        <textarea v-model="head.correctionReason" rows="2"
                  placeholder="说明为什么更正已复核班次，原值可在版本链中查看"></textarea>
      </fieldset>

      <ul v-if="formErrors.length" class="issue-list">
        <li v-for="(msg, i) in formErrors" :key="`f${i}`" class="issue issue-block">
          <span class="issue-tag">缺项</span>{{ msg }}
        </li>
      </ul>
      <ul v-if="returnedIssues.length" class="issue-list">
        <li v-for="(issue, i) in returnedIssues" :key="`r${i}`" class="issue issue-block">
          <span class="issue-tag">{{ issue.ruleCode }}</span>
          <strong>{{ issue.target }}</strong>：{{ issue.detail }}
        </li>
      </ul>

      <div class="form-actions">
        <button type="submit">{{ mode === "correct" ? "新建更正版本" : "保存交班（整班校验）" }}</button>
        <button v-if="mode === 'correct'" type="button" class="secondary" @click="emit('cancel')">取消更正</button>
      </div>
    </div>
  </form>
</template>
