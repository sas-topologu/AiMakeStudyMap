// 可折叠节：标题行（徽标 + 展开箭头 + 勘误按钮）+ 200ms 高度过渡
// 手动折叠状态为内存态；mode 变化（defaultOpen 变化）时重置手动状态
<template>
  <section class="panel collapse-section">
    <button class="collapse-head" :aria-expanded="open" @click="toggle">
      <span class="collapse-arrow" :class="{ open }">▸</span>
      <h2>{{ heading }}</h2>
      <span v-if="badge" class="tier-badge" :class="badgeClass">{{ badge }}</span>
      <span
        class="errata-btn inline"
        title="提交勘误"
        @click.stop="$emit('errata')"
      >✎</span>
    </button>
    <div class="collapse-grid" :class="{ closed: !open }">
      <div class="collapse-inner">
        <slot />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  heading: { type: String, required: true },
  badge: { type: String, default: '' },
  badgeClass: { type: String, default: '' },
  defaultOpen: { type: Boolean, default: true },
});
defineEmits(['errata']);

const override = ref(null); // null=跟随模式默认值
const open = computed(() => override.value ?? props.defaultOpen);

watch(
  () => props.defaultOpen,
  () => {
    override.value = null; // 切换阅读模式时重置手动折叠状态
  },
);

function toggle() {
  override.value = !open.value;
}
</script>
