<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { newLineId } from "../audit/rules";
import type { Shift, ShiftDraft, SubmissionIssue } from "../audit/types";
import { SHIFT_TYPES, VARIANCE_REASONS } from "../audit/types";

const props = defineProps<{
  mode: "create" | "revise";
  target: Shift | null;
  initial: ShiftDraft | null;
}>();

const emit = defineEmits<{
  (e: "submit", draft: ShiftDraft): void;
  (e: "cancel"): void;
}>();

function emptyDraft(): ShiftDraft {
  return {
    date: new Date().toISOString().slice(0, 10),
    shiftType: "",
    cashier: "",
    inStoreSales: 0,
    coupons: [{ id: newLineId(), code: "", amount: 0 }],
    stock: [
      { id: newLineId(), product: "", bookQty: 0, actualQty: 0, reason: "", evidence: "" },
    ],
    revisionReason: "",
  };
}

const draft = reactive<ShiftDraft>(emptyDraft());
const issues = ref<SubmissionIssue[]>([]);

function syncInitial() {
  const source = props.initial;
  if (source) {
    Object.assign(draft, JSON.parse(JSON.stringify(source)) as ShiftDraft);
  } else {
    Object.assign(draft, emptyDraft());
  }
  issues.value = [];
}

watch(() => [props.mode, props.target?.id], syncInitial, { immediate: true });

function fieldIssue(field: string): string | undefined {
  return issues.value.find((item) => item.field === field)?.message;
}

function couponIssue(index: number): string | undefined {
  return issues.value.find((item) => item.field === `coupons.${index}`)?.message;
}

function stockIssues(index: number): string[] {
  return issues.value
    .filter((item) => item.field.startsWith(`stock.${index}.`))
    .map((item) => item.message);
}

function addCoupon() {
  draft.coupons.push({ id: newLineId(), code: "", amount: 0 });
}

function removeCoupon(index: number) {
  draft.coupons.splice(index, 1);
}

function addStockLine() {
  draft.stock.push({ id: newLineId(), product: "", bookQty: 0, actualQty: 0, reason: "", evidence: "" });
}

function removeStockLine(index: number) {
  draft.stock.splice(index, 1);
}

function submit() {
  // 页面仅做预检查漏；真正的整班规则在 store/rules 中再跑一遍
  emit("submit", JSON.parse(JSON.stringify(draft)) as ShiftDraft);
}

function notifyResult(result: { ok: boolean; issues: SubmissionIssue[] }) {
  issues.value = result.ok ? [] : result.issues;
  if (result.ok && props.mode === "create") {
    Object.assign(draft, emptyDraft());
  }
}

defineExpose({ notifyResult });
</script>

<template>
  <form class="panel form-panel" @submit.prevent="submit">
    <div class="panel-head">
      <h2>{{ mode === "create" ? "登记交班班次" : `更正：${target?.date} ${target?.shiftType}` }}</h2>
      <span v-if="mode === 'revise'" class="mode-tag">原值保留 · 新建版本</span>
    </div>

    <div class="form-grid">
      <div class="form-row form-row-3">
        <label>
          交班日期
          <input v-model="draft.date" type="date" />
          <em v-if="fieldIssue('date')" class="error-text">{{ fieldIssue('date') }}</em>
        </label>
        <label>
          班次
          <select v-model="draft.shiftType">
            <option value="">请选择</option>
            <option v-for="item in SHIFT_TYPES" :key="item" :value="item">{{ item }}</option>
          </select>
          <em v-if="fieldIssue('shiftType')" class="error-text">{{ fieldIssue('shiftType') }}</em>
        </label>
        <label>
          交班人
          <input v-model="draft.cashier" placeholder="姓名" />
          <em v-if="fieldIssue('cashier')" class="error-text">{{ fieldIssue('cashier') }}</em>
        </label>
      </div>

      <label>
        店内销售额（元）
        <input v-model.number="draft.inStoreSales" type="number" min="0" step="0.01" />
        <em v-if="fieldIssue('inStoreSales')" class="error-text">{{ fieldIssue('inStoreSales') }}</em>
      </label>

      <fieldset class="sub-block">
        <legend>券码核销 <small>同一券码跨班只计一次，重复将整班拒绝</small></legend>
        <div v-for="(coupon, index) in draft.coupons" :key="coupon.id" class="coupon-row">
          <input v-model="coupon.code" placeholder="券码，如 VIP8832" />
          <input v-model.number="coupon.amount" type="number" min="0" step="0.01" placeholder="核销金额" />
          <button type="button" class="danger small" :disabled="draft.coupons.length === 1" @click="removeCoupon(index)">删</button>
          <em v-if="couponIssue(index)" class="error-text">{{ couponIssue(index) }}</em>
        </div>
        <button type="button" class="secondary small" @click="addCoupon">+ 添加券码</button>
      </fieldset>

      <fieldset class="sub-block">
        <legend>实盘库存 <small>盘亏/盘盈必须选损耗、错录或盗损并写依据，未填不得复核</small></legend>
        <div v-for="(line, index) in draft.stock" :key="line.id" class="stock-row">
          <input v-model="line.product" placeholder="商品名" />
          <input v-model.number="line.bookQty" type="number" min="0" step="1" placeholder="账面" />
          <input v-model.number="line.actualQty" type="number" min="0" step="1" placeholder="实盘" />
          <span
            class="diff-chip"
            :class="line.actualQty - line.bookQty > 0 ? 'gain' : line.actualQty - line.bookQty < 0 ? 'loss' : ''"
          >
            {{ line.actualQty - line.bookQty > 0 ? `盘盈+${line.actualQty - line.bookQty}` : line.actualQty - line.bookQty < 0 ? `盘亏${line.actualQty - line.bookQty}` : "一致" }}
          </span>
          <select v-model="line.reason" :disabled="line.actualQty === line.bookQty">
            <option value="">定性原因</option>
            <option v-for="reason in VARIANCE_REASONS" :key="reason" :value="reason">{{ reason }}</option>
          </select>
          <input
            v-model="line.evidence"
            :disabled="line.actualQty === line.bookQty"
            placeholder="依据（单号 / 监控 / 复盘人）"
          />
          <button type="button" class="danger small" @click="removeStockLine(index)">删</button>
          <em v-for="message in stockIssues(index)" :key="message" class="error-text stock-error">{{ message }}</em>
        </div>
        <button type="button" class="secondary small" @click="addStockLine">+ 添加商品</button>
      </fieldset>

      <fieldset v-if="mode === 'revise'" class="sub-block revise-block">
        <legend>更正原因 <small>必填；保存后原 v{{ target?.versions.length }} 原样保留</small></legend>
        <textarea
          v-model="draft.revisionReason"
          placeholder="说明更正依据，如：按小票 XJ-0920-17 更正券码金额"
        />
        <em v-if="fieldIssue('revisionReason')" class="error-text">{{ fieldIssue('revisionReason') }}</em>
      </fieldset>

      <div class="form-actions">
        <button type="submit">{{ mode === "create" ? "保存交接（整班校验）" : "提交更正版本" }}</button>
        <button v-if="mode === 'revise'" type="button" class="secondary" @click="emit('cancel')">取消更正</button>
      </div>
    </div>
  </form>
</template>
