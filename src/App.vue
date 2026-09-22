<script setup lang="ts">
// 页面层：便利店交班稽核台。数据(src/data) / 规则(src/rules) / 页面(src/ui,src/App.vue) 三层分离。
import { computed, onMounted, onUnmounted, ref } from "vue";
import ShiftForm from "./ui/ShiftForm.vue";
import ShiftDetail from "./ui/ShiftDetail.vue";
import ConflictCenter from "./ui/ConflictCenter.vue";
import { getShifts, latestVersion, listConflicts, subscribe } from "./data/store";
import type { Shift } from "./data/types";

const tick = ref(0);
const bump = () => tick.value++;

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = subscribe(bump);
});
onUnmounted(() => unsubscribe?.());

const shifts = computed<Shift[]>(() => {
  void tick.value;
  return getShifts();
});

const kindFilter = ref("全部班次");
const statusFilter = ref("全部状态");
const conflictFilter = ref("全部");

const filteredShifts = computed(() =>
  shifts.value.filter((shift) => {
    if (kindFilter.value !== "全部班次" && shift.kind !== kindFilter.value) return false;
    if (statusFilter.value !== "全部状态" && shift.status !== statusFilter.value) return false;
    return true;
  })
);

const metrics = computed(() => {
  void tick.value;
  const reviewed = shifts.value.filter((shift) => shift.status === "已复核").length;
  const pending = shifts.value.length - reviewed;
  const sales = shifts.value.reduce(
    (sum, shift) => sum + latestVersion(shift).storeSales,
    0
  );
  const conflicts = listConflicts().length;
  return { total: shifts.value.length, reviewed, pending, sales, conflicts };
});

// 冻结更正模式
const formMode = ref<"create" | "correct">("create");
const correctingShift = ref<Shift | null>(null);
const formKey = ref(0);

function startCorrect(shift: Shift) {
  formMode.value = "correct";
  correctingShift.value = shift;
  formKey.value++;
  scrollTo({ top: 0, behavior: "smooth" });
}
function startCreate() {
  formMode.value = "create";
  correctingShift.value = null;
  formKey.value++;
}

function resetDemo() {
  if (!confirm("将清空本地稽核数据并恢复演示数据，确定继续？")) return;
  localStorage.removeItem("dfwlfront-7-convenience-audit-v1");
  location.reload();
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">加油站附属便利店 · 交班稽核</p>
          <h1>便利店交班稽核台</h1>
          <p class="subtitle">
            每班登记店内销售额、券码核销与实盘库存；同一券码跨班只计一次，重复提交整班拒绝；
            盘亏盘盈须定性并写依据方可复核；已复核班次冻结，更正只能带原因新建版本。
          </p>
        </div>
        <div class="top-actions">
          <div class="stack">
            <span class="tag">Vue3</span><span class="tag">TypeScript</span>
            <span class="tag">数据/规则/页面分层</span><span class="tag">零新增依赖</span>
          </div>
          <button type="button" class="secondary mini" @click="resetDemo">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article class="metric"><span>班次总数</span><strong>{{ metrics.total }}</strong></article>
        <article class="metric"><span>已复核冻结</span><strong>{{ metrics.reviewed }}</strong></article>
        <article class="metric"><span>待复核</span><strong>{{ metrics.pending }}</strong></article>
        <article class="metric"><span>店内销售累计</span><strong>¥{{ metrics.sales.toFixed(0) }}</strong></article>
        <article class="metric" :class="{ alert: metrics.conflicts > 0 }">
          <span>稽核命中</span><strong>{{ metrics.conflicts }}</strong>
        </article>
      </section>

      <section class="workspace">
        <ShiftForm :key="formKey" :mode="formMode" :shift="correctingShift"
                   @done="startCreate" @cancel="startCreate" />

        <section class="list-panel">
          <div class="toolbar">
            <h2>班次稽核列表</h2>
            <div class="filters">
              <select v-model="kindFilter">
                <option>全部班次</option>
                <option>早班</option>
                <option>中班</option>
                <option>晚班</option>
              </select>
              <select v-model="statusFilter">
                <option>全部状态</option>
                <option>待复核</option>
                <option>已复核</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredShifts.length === 0" class="empty">暂无匹配班次</div>
            <ShiftDetail v-for="shift in filteredShifts" :key="shift.id" :shift="shift"
                         @correct="startCorrect" />
          </div>
        </section>
      </section>

      <ConflictCenter v-model:filter-status="conflictFilter" :tick="tick" style="margin-top: 18px" />

      <footer class="foot-note">
        数据持久化于浏览器 localStorage，刷新后班次、券码占用、库存定性与版本链保持一致；
        业务规则集中在 <code>src/rules/auditRules.ts</code>，数据出入口集中在 <code>src/data/store.ts</code>。
      </footer>
    </div>
  </main>
</template>
