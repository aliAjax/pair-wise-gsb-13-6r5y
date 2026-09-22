<script setup lang="ts">
import { computed, ref } from "vue";
import ConflictTable from "./components/ConflictTable.vue";
import ShiftFormPanel from "./components/ShiftFormPanel.vue";
import ShiftList from "./components/ShiftList.vue";
import { useAuditStore } from "./audit/store";
import { latestVersion } from "./audit/rules";
import type { Shift, ShiftDraft } from "./audit/types";
import { SHIFT_TYPES, SHIFT_STATUS } from "./audit/types";

const {
  shifts,
  conflicts,
  toast,
  createShift,
  reviewShift,
  reviseShift,
  draftFromVersion,
  clearToast,
  restoreSeeds,
} = useAuditStore();

const formRef = ref<InstanceType<typeof ShiftFormPanel> | null>(null);
const mode = ref<"create" | "revise">("create");
const reviseTarget = ref<Shift | null>(null);
const reviseInitial = ref<ShiftDraft | null>(null);

const shiftTypeFilter = ref("全部");
const statusFilter = ref("全部");

const filteredShifts = computed(() =>
  shifts.value.filter((shift) => {
    const typeOk = shiftTypeFilter.value === "全部" || shift.shiftType === shiftTypeFilter.value;
    const statusOk = statusFilter.value === "全部" || shift.status === statusFilter.value;
    return typeOk && statusOk;
  }),
);

const metrics = computed(() => {
  const pending = shifts.value.filter((shift) => shift.status === "待复核").length;
  const reviewed = shifts.value.filter((shift) => shift.status === "已复核").length;
  const couponCodes = new Set<string>();
  let couponAmount = 0;
  for (const shift of shifts.value) {
    const version = latestVersion(shift);
    if (!version) continue;
    for (const coupon of version.coupons) {
      couponCodes.add(coupon.code);
      couponAmount += coupon.amount;
    }
  }
  return [
    { label: "待复核班次", value: pending },
    { label: "已复核冻结班次", value: reviewed },
    { label: "在册有效券码", value: `${couponCodes.size} 张 / ¥${couponAmount}` },
    { label: "稽核冲突", value: conflicts.value.length, alert: conflicts.value.length > 0 },
  ];
});

function onSubmit(draft: ShiftDraft) {
  if (mode.value === "create") {
    const result = createShift(draft);
    formRef.value?.notifyResult(result);
  } else if (reviseTarget.value) {
    const result = reviseShift(reviseTarget.value.id, draft);
    formRef.value?.notifyResult(result);
    if (result.ok) exitRevise();
  }
}

function onRevise(shift: Shift) {
  mode.value = "revise";
  reviseTarget.value = shift;
  reviseInitial.value = draftFromVersion(shift);
}

function exitRevise() {
  mode.value = "create";
  reviseTarget.value = null;
  reviseInitial.value = null;
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">便利店交班稽核台 · 石油/零售前端闭环</p>
          <h1>加油站便利店交班稽核台</h1>
          <p class="subtitle">
            每班登记店内销售额、券码核销与实盘库存；同一券码跨班只计一次，重复提交整班拒绝。
            盘亏/盘盈必须定性并写依据才可复核；已复核班次冻结，更正只能带原因新建版本并保留原值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">无新增依赖</span>
          <button class="secondary small" type="button" @click="restoreSeeds">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric" :class="{ alert: item.alert }">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <ShiftFormPanel
          ref="formRef"
          :mode="mode"
          :target="reviseTarget"
          :initial="reviseInitial"
          @submit="onSubmit"
          @cancel="exitRevise"
        />

        <section class="list-panel">
          <div class="toolbar">
            <h2>班次列表</h2>
            <div class="filters">
              <select v-model="shiftTypeFilter">
                <option value="全部">全部班次</option>
                <option v-for="item in SHIFT_TYPES" :key="item" :value="item">{{ item }}</option>
              </select>
              <select v-model="statusFilter">
                <option value="全部">全部状态</option>
                <option v-for="item in SHIFT_STATUS" :key="item" :value="item">{{ item }}</option>
              </select>
            </div>
          </div>

          <ShiftList
            :shifts="filteredShifts"
            :conflicts="conflicts"
            @review="reviewShift"
            @revise="onRevise"
          />
        </section>
      </section>

      <ConflictTable :conflicts="conflicts" />

      <footer class="page-foot">
        <p>数据（localStorage 整体信封）、规则（src/audit/rules.ts 纯函数）、页面（src/components）三层分离；刷新即对券码、库存定性与冻结版本全量重算。</p>
      </footer>
    </div>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toast.type" @click="clearToast">
        {{ toast.text }}
      </div>
    </transition>
  </main>
</template>
