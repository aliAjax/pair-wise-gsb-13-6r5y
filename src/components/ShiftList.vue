<script setup lang="ts">
import { computed, ref } from "vue";
import { canReview, formatDiff, latestVersion, stockDiff } from "../audit/rules";
import type { Conflict, Shift } from "../audit/types";

const props = defineProps<{
  shifts: Shift[];
  conflicts: Conflict[];
}>();

const emit = defineEmits<{
  (e: "review", shiftId: string): void;
  (e: "revise", shift: Shift): void;
}>();

const expanded = ref<Record<string, boolean>>({});

function toggle(id: string) {
  expanded[id] = !expanded[id];
}

function conflictsOf(shiftId: string) {
  return props.conflicts.filter((item) => item.shiftId === shiftId);
}

const reviewBlockers = computed(() => {
  const map = new Map<string, string[]>();
  for (const shift of props.shifts) {
    if (shift.status === "待复核") map.set(shift.id, canReview(shift).issues);
  }
  return map;
});

function timeOf(value: string): string {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}
</script>

<template>
  <div class="record-grid">
    <div v-if="shifts.length === 0" class="empty">暂无班次数据</div>

    <article v-for="shift in shifts" :key="shift.id" class="record" :class="{ 'has-conflict': conflictsOf(shift.id).length > 0 }">
      <div class="record-head">
        <p class="record-title">{{ shift.date }} {{ shift.shiftType }} · {{ shift.cashier }}</p>
        <span class="status" :class="shift.status === '已复核' ? 'frozen' : 'pending'">{{ shift.status }}</span>
      </div>

      <div v-if="conflictsOf(shift.id).length" class="conflict-flags">
        <span v-for="conflict in conflictsOf(shift.id)" :key="conflict.ruleId + conflict.couponCode + conflict.diff" class="conflict-flag">
          {{ conflict.ruleId }} {{ conflict.ruleName }}
        </span>
      </div>

      <template v-for="version in [...shift.versions].reverse()" :key="version.version">
        <div v-show="version.version === latestVersion(shift).version || expanded[shift.id]" class="version-block" :class="{ current: version.version === latestVersion(shift).version }">
          <div class="version-head">
            <strong>v{{ version.version }}</strong>
            <span class="muted">{{ timeOf(version.createdAt) }}</span>
            <span v-if="version.reviewedAt" class="freeze-tag">已冻结 {{ timeOf(version.reviewedAt) }}</span>
            <span v-else class="wait-tag">待复核</span>
          </div>

          <div class="details">
            <span>店内销售额：<b>¥{{ version.inStoreSales }}</b></span>
            <span>券码核销：<b>{{ version.coupons.length }}</b> 张 / ¥{{ version.coupons.reduce((sum, c) => sum + c.amount, 0) }}</span>
          </div>

          <ul class="coupon-list">
            <li v-for="coupon in version.coupons" :key="coupon.id">
              <code>{{ coupon.code }}</code><span>¥{{ coupon.amount }}</span>
            </li>
          </ul>

          <table class="stock-table">
            <thead>
              <tr><th>商品</th><th>账面</th><th>实盘</th><th>差额</th><th>定性</th><th>依据</th></tr>
            </thead>
            <tbody>
              <tr v-for="line in version.stock" :key="line.id">
                <td>{{ line.product }}</td>
                <td>{{ line.bookQty }}</td>
                <td>{{ line.actualQty }}</td>
                <td>
                  <span
                    class="diff-chip"
                    :class="stockDiff(line) > 0 ? 'gain' : stockDiff(line) < 0 ? 'loss' : ''"
                  >{{ stockDiff(line) === 0 ? "一致" : formatDiff(stockDiff(line)) }}</span>
                </td>
                <td>
                  <span v-if="stockDiff(line) !== 0" class="reason-tag" :class="line.reason ? '' : 'missing'">
                    {{ line.reason || "未定性" }}
                  </span>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <span v-if="stockDiff(line) !== 0" :class="line.evidence ? '' : 'missing-text'">
                    {{ line.evidence || "缺依据，不得复核" }}
                  </span>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>

          <p v-if="version.revisionReason" class="revision-note">
            更正原因：{{ version.revisionReason }}
          </p>
        </div>
      </template>

      <div v-if="reviewBlockers.get(shift.id)?.length" class="blockers">
        <p v-for="message in reviewBlockers.get(shift.id)" :key="message">⛔ {{ message }}</p>
      </div>

      <div class="actions">
        <button
          v-if="shift.status === '待复核'"
          type="button"
          :disabled="(reviewBlockers.get(shift.id)?.length ?? 0) > 0"
          @click="emit('review', shift.id)"
        >
          复核并冻结
        </button>
        <button
          v-if="shift.status === '已复核'"
          class="secondary"
          type="button"
          @click="emit('revise', shift)"
        >
          更正（新建版本）
        </button>
        <button class="secondary small" type="button" @click="toggle(shift.id)">
          {{ expanded[shift.id] ? "收起版本" : `查看全部 ${shift.versions.length} 个版本` }}
        </button>
      </div>
    </article>
  </div>
</template>
