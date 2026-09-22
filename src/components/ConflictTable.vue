<script setup lang="ts">
import type { Conflict } from "../audit/types";

defineProps<{ conflicts: Conflict[] }>();
</script>

<template>
  <section class="panel conflict-panel">
    <div class="panel-head">
      <h2>刷新一致性稽核</h2>
      <span class="muted">每次刷新对班次、券码、库存、版本链全量重算</span>
    </div>

    <div v-if="conflicts.length === 0" class="empty ok-empty">
      ✅ 班次 / 券码 / 库存 / 版本链全部一致，无冲突
    </div>

    <table v-else class="conflict-table">
      <thead>
        <tr>
          <th>班次</th>
          <th>券码</th>
          <th>差额</th>
          <th>触发规则</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(conflict, index) in conflicts" :key="`${conflict.shiftId}-${conflict.ruleId}-${conflict.couponCode}-${index}`">
          <td>{{ conflict.shiftLabel }}</td>
          <td><code v-if="conflict.couponCode !== '-'">{{ conflict.couponCode }}</code><span v-else class="muted">—</span></td>
          <td><span class="diff-chip loss">{{ conflict.diff }}</span></td>
          <td>
            <span class="rule-tag">{{ conflict.ruleId }} {{ conflict.ruleName }}</span>
          </td>
          <td class="detail-cell">{{ conflict.detail }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
