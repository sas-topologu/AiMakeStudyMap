// 例题：title + problem（RichText，[[术语]] 夹层可用）
// steps 默认折叠（「查看解析 ▾」），answer 再嵌套一层（「查看答案」防剧透）
<template>
  <div class="example-item">
    <p class="example-title">📝 {{ example.title }}</p>
    <RichText v-if="showProblem" :text="example.problem" class="example-problem" @term="(n, e) => $emit('term', n, e)" />

    <template v-if="showProblem">
      <button class="collapse-head slim" :aria-expanded="stepsOpen" @click="stepsOpen = !stepsOpen">
        <span class="collapse-arrow" :class="{ open: stepsOpen }">▸</span>
        查看解析（{{ example.steps?.length ?? 0 }} 步）
      </button>
      <div class="collapse-grid" :class="{ closed: !stepsOpen }">
        <div class="collapse-inner">
          <ol class="example-steps">
            <li v-for="(s, i) in example.steps ?? []" :key="i">
              <RichText :text="s" @term="(n, e) => $emit('term', n, e)" />
            </li>
          </ol>
          <button class="collapse-head slim" :aria-expanded="answerOpen" @click="answerOpen = !answerOpen">
            <span class="collapse-arrow" :class="{ open: answerOpen }">▸</span>
            查看答案
          </button>
          <div class="collapse-grid" :class="{ closed: !answerOpen }">
            <div class="collapse-inner">
              <p class="example-answer">{{ example.answer }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import RichText from './RichText.vue';

const props = defineProps({
  example: { type: Object, required: true }, // { id, title, problem, steps[], answer }
  showProblem: { type: Boolean, default: true }, // 速览只显示标题
  stepsDefaultOpen: { type: Boolean, default: false },
  answerDefaultOpen: { type: Boolean, default: false },
});
defineEmits(['term']);

const stepsOpen = ref(props.stepsDefaultOpen);
const answerOpen = ref(props.answerDefaultOpen);

// 阅读模式切换 → 重置为模式默认
watch(
  () => [props.stepsDefaultOpen, props.answerDefaultOpen],
  ([s, a]) => {
    stepsOpen.value = s;
    answerOpen.value = a;
  },
);
</script>
