<script setup lang="ts">
// 页面层：冲突稽核中心。列出班次、券码/对象、差额、触发规则。
import { computed } from "vue";
import { listConflicts } from "../data/store";
import type { RuleIssue } from "../data/types";

const props = defineProps<{ tick: number }>();

const filterStatus = defineModel<string>("filterStatus", { default: "全部" });

const all = computed<RuleIssue[]>(() => {
  void props.tick;
  return listConflicts();
});

const shown = computed(() =>
  filterStatus.value === "全部"
    ? all.value
    : all.value.filter((issue) => issue.kind === filterStatus.value)
);

const couponDup = computed(() =>
  all.value.filter((issue) => issue.ruleCode === "R-COUPON-UNIQUE")
);
const inventoryBlocking = computed(() =>
  all.value.filter((issue) => issue.ruleCode === "R-INV-REASON")
);
const totalCouponDiff = computed(() =>
  couponDup.value.reduce((sum, issue) => sum + issue.diff, 0)
);
const totalInventoryDiff = computed(() =>
  inventoryBlocking.value.reduce((sum, issue) => sum + Math.abs(issue.diff), 0)
);
</script>

<template>
  <section class="panel conflict-panel">
    <div class="panel-title">
      <h2>冲突稽核中心</h2>
      <div class="legend">
        <span class="legend-dot dot-conflict"></span>跨班冲突
        <span class="legend-dot dot-block"></span>复核阻断
      </div>
    </div>

    <div class="conflict-summary">
      <div><span>跨班重复券码</span><b>{{ couponDup.length }}</b></div>
      <div><span>应冲回金额</span><b>¥{{ totalCouponDiff.toFixed(2) }}</b></div>
      <div><span>未定性盘亏盘盈</span><b>{{ inventoryBlocking.length }}</b></div>
      <div><span>涉及差异数量</span><b>{{ totalInventoryDiff }}</b></div>
    </div>

    <div class="toolbar">
      <label class="inline-select">
        只看
        <select v-model="filterStatus">
          <option value="全部">全部</option>
          <option value="冲突">跨班冲突</option>
          <option value="阻断">复核阻断</option>
        </select>
      </label>
      <span class="muted small">规则与数据分离：结论全部由 src/rules/auditRules.ts 计算</span>
    </div>

    <table v-if="shown.length" class="conflict-table">
      <thead>
        <tr>
          <th>类型</th><th>班次</th><th>券码 / 对象</th><th>差额</th><th>触发规则</th><th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(issue, i) in shown" :key="i"
            :class="issue.kind === '阻断' ? 'row-block' : 'row-conflict'">
          <td>
            <span class="issue-tag" :class="issue.kind === '阻断' ? 'tag-block' : 'tag-conflict'">
              {{ issue.kind }}
            </span>
          </td>
          <td>{{ issue.shiftLabel }}</td>
          <td><code v-if="issue.targetType === 'coupon'">{{ issue.target }}</code>
              <span v-else>{{ issue.target }}</span></td>
          <td>
            <b v-if="issue.targetType === 'coupon'">¥{{ issue.diff.toFixed(2) }}</b>
            <b v-else :class="issue.diff < 0 ? 'var-loss' : 'var-gain'">
              {{ issue.diff > 0 ? "+" : "" }}{{ issue.diff }}
            </b>
          </td>
          <td><code class="rule-code">{{ issue.ruleCode }}</code><br /><span class="muted small">{{ issue.ruleText }}</span></td>
          <td class="basis">{{ issue.detail }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">稽核通过：券码无跨班重复，盘亏盘盈均已定性并附依据。</div>
  </section>
</template>
