<script setup lang="ts">
// 页面层：班次稽核卡片，展示最新版本、版本链、冲突命中，并触发复核/更正
import { computed, ref } from "vue";
import { conflictsOfShift, latestVersion, review } from "../data/store";
import type { RuleIssue, Shift, ShiftVersion } from "../data/types";

const props = defineProps<{ shift: Shift }>();
const emit = defineEmits<{ correct: [shift: Shift] }>();

const selectedVersionId = ref<string | null>(null);
const reviewer = ref("");
const reviewErrors = ref<RuleIssue[]>([]);

const version = computed<ShiftVersion>(() => {
  const list = props.shift.versions;
  return list.find((v) => v.id === selectedVersionId.value) ?? latestVersion(props.shift);
});

const issues = computed(() => conflictsOfShift(props.shift.id));
const blockers = computed(() => issues.value.filter((issue) => issue.kind === "阻断"));

const digitalSales = computed(() =>
  Math.max(0, version.value.storeSales - version.value.cashSales)
);
const couponTotal = computed(() =>
  version.value.coupons.reduce((sum, line) => sum + line.amount, 0)
);

function doReview() {
  reviewErrors.value = review(props.shift.id, reviewer.value);
  if (reviewErrors.value.length === 0) reviewer.value = "";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <article class="record" :class="{ frozen: shift.status === '已复核' }">
    <div class="record-head">
      <div>
        <p class="record-title">{{ shift.date }} {{ shift.kind }} · {{ shift.cashier }}</p>
        <p class="record-sub">登记于 {{ fmtTime(shift.createdAt) }}</p>
      </div>
      <span class="status" :class="shift.status === '已复核' ? 'status-ok' : 'status-wait'">
        {{ shift.status }}
      </span>
    </div>

    <div v-if="shift.versions.length > 1" class="version-tabs">
      <button v-for="v in shift.versions" :key="v.id" type="button"
              class="mini tab"
              :class="{ active: v.id === version.id }"
              @click="selectedVersionId = v.id">
        v{{ v.version }}<span v-if="v.version === latestVersion(shift).version">（当前）</span>
      </button>
    </div>

    <div v-if="version.correctionReason" class="correction-banner">
      <strong>v{{ version.version }} 更正原因：</strong>{{ version.correctionReason }}
    </div>

    <div class="details">
      <span>店内销售额：<b>¥{{ version.storeSales.toFixed(2) }}</b></span>
      <span>现金：<b>¥{{ version.cashSales.toFixed(2) }}</b></span>
      <span>电子支付：<b>¥{{ digitalSales.toFixed(2) }}</b></span>
      <span>券码核销：<b>{{ version.coupons.length }} 张 / ¥{{ couponTotal.toFixed(2) }}</b></span>
    </div>

    <div class="sub-block">
      <p class="sub-title">券码核销</p>
      <ul class="plain-list">
        <li v-for="(line, i) in version.coupons" :key="`${line.code}-${i}`">
          <code>{{ line.code }}</code><span>¥{{ line.amount.toFixed(2) }}</span>
        </li>
        <li v-if="version.coupons.length === 0" class="muted">本班无券码核销</li>
      </ul>
    </div>

    <div class="sub-block">
      <p class="sub-title">实盘库存</p>
      <table class="inv-table">
        <thead>
          <tr><th>商品</th><th>账面</th><th>实盘</th><th>盘差</th><th>定性</th><th>依据</th></tr>
        </thead>
        <tbody>
          <tr v-for="line in version.inventory" :key="line.sku">
            <td>{{ line.sku }}<br /><span class="muted">{{ line.name }}</span></td>
            <td>{{ line.bookQty }}</td>
            <td>{{ line.actualQty }}</td>
            <td :class="line.actualQty - line.bookQty < 0 ? 'var-loss' : line.actualQty - line.bookQty > 0 ? 'var-gain' : ''">
              {{ line.actualQty - line.bookQty === 0
                ? "0"
                : `${line.actualQty - line.bookQty > 0 ? "+" : ""}${line.actualQty - line.bookQty}` }}
            </td>
            <td>{{ line.reason ?? "—" }}</td>
            <td class="basis">{{ line.basis ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul v-if="issues.length" class="issue-list">
      <li v-for="(issue, i) in issues" :key="i" class="issue"
          :class="issue.kind === '阻断' ? 'issue-block' : 'issue-conflict'">
        <span class="issue-tag">{{ issue.ruleCode }}</span>
        <span class="issue-target">{{ issue.target }}</span>
        差额 <b>{{ issue.targetType === 'coupon' ? '¥' : '' }}{{ issue.targetType === 'coupon' ? issue.diff.toFixed(2) : issue.diff }}</b>
        — {{ issue.detail }}
      </li>
    </ul>

    <div v-if="shift.status === '已复核'" class="review-meta">
      ✅ {{ shift.reviewer }} 于 {{ shift.reviewedAt ? fmtTime(shift.reviewedAt) : "" }} 复核冻结
    </div>

    <div class="actions">
      <template v-if="shift.status === '待复核'">
        <input v-model="reviewer" class="reviewer-input" type="text" placeholder="复核人姓名" />
        <button type="button" @click="doReview">复核通过并冻结</button>
      </template>
      <button v-else type="button" class="secondary" @click="emit('correct', shift)">
        更正（新建版本）
      </button>
    </div>
    <ul v-if="reviewErrors.length" class="issue-list">
      <li v-for="(issue, i) in reviewErrors" :key="`rv${i}`" class="issue issue-block">
        <span class="issue-tag">{{ issue.ruleCode }}</span>{{ issue.target }}：{{ issue.detail }}
      </li>
    </ul>
    <p v-if="shift.status === '待复核' && blockers.length === 0 && issues.length === 0" class="muted small">
      无阻断项，可复核
    </p>
  </article>
</template>
