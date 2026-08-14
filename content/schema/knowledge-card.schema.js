import { z } from 'zod';

// 节点 id：点分层级，如 math.equation.quadratic
export const nodeIdPattern = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
const nodeId = z
  .string()
  .regex(nodeIdPattern, '节点 id 须为点分层级格式，如 math.equation.quadratic');

// 例题（教学用，分步详解；与闯关题库 questionBank 分离，避免泄题）
const exampleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  problem: z.string().min(1), // 可用 Markdown 与 [[术语]]
  steps: z.array(z.string().min(1)).min(1),
  answer: z.string().min(1),
});

// 节内工具表（v2.1）：公式表/口诀/对照表
const toolsSchema = z.object({
  heading: z.string().min(1),
  rows: z.array(z.string().min(1)).min(1),
});

// 正文中以 [[术语]] 标注可点击的专业名词/参数/算子
// tier 折叠分级：core 核心概念（任何模式展开）；detail 推导/详细论证（标准模式折叠可点）；
// extended 拓展阅读（默认折叠）
// v2.1：examples/pitfalls 可内嵌在本节（跟随知识点）；tools 为节内工具表
const sectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1), // Markdown
  tier: z.enum(['core', 'detail', 'extended']).default('core'),
  examples: z.array(exampleSchema).default([]),
  pitfalls: z.array(z.string().min(1)).default([]),
  tools: toolsSchema.optional(),
});

// 图片/动画：src 为 http(s) URL，或相对 content/assets/ 的路径（如 quadratic/parabola.svg）
const mediaSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'animation']),
  src: z.string().min(1),
  caption: z.string().optional(),
  core: z.boolean().default(false), // 最能代表本卡的核心图（建议 ≤1 个，超出不阻断）
});

// 星图粒子拼形用的核心标注（1~3 个）：formula=公式文本；image=media id
const emblemSchema = z.object({
  type: z.enum(['formula', 'image']),
  content: z.string().min(1),
  caption: z.string().optional(),
});

const questionBase = {
  id: z.string().min(1),
  stem: z.string().min(1),
  explanation: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
};

// choice：answer 为正确选项下标
const choiceQuestionSchema = z.object({
  ...questionBase,
  type: z.literal('choice'),
  options: z.array(z.string().min(1)).min(2),
  answer: z.number().int().nonnegative(),
});

// fill：无 options，answer 为标准答案字符串
const fillQuestionSchema = z.object({
  ...questionBase,
  type: z.literal('fill'),
  answer: z.string().min(1),
});

const questionSchema = z.discriminatedUnion('type', [
  choiceQuestionSchema,
  fillQuestionSchema,
]);

// 知识卡 = 一个知识节点，一卡一文件
export const knowledgeCardSchema = z
  .object({
    id: nodeId,
    title: z.string().min(1),
    subject: z.string().min(1), // 学科（星系）
    category: z.enum(['自然科学', '人文科学']),
    credibility: z.enum(['verified', 'disputed']), // 前端绿/黄标识
    difficulty: z.number().int().min(1).max(5),
    summary: z.string().min(1), // 一段话摘要
    objectives: z.array(z.string().min(1)).default([]), // 学习目标
    sections: z.array(sectionSchema).min(1),
    media: z.array(mediaSchema).default([]), // 图示与动画演示
    examples: z.array(exampleSchema).default([]), // 例题（分步详解）
    pitfalls: z.array(z.string().min(1)).default([]), // 易错点
    emblems: z.array(emblemSchema).default([]), // 核心标注（粒子拼形素材）
    // 术语表：定义文本中也可用 [[...]] 引用其他术语（多级嵌套）
    terms: z.record(z.string(), z.string().min(1)),
    // 后续关系由其他节点的 prerequisites 反向推导，不单独存储
    relations: z
      .object({
        prerequisites: z.array(nodeId).default([]),
        related: z.array(nodeId).default([]),
      })
      .default({ prerequisites: [], related: [] }),
    questionBank: z.array(questionSchema).min(6, '每节点题库不少于 6 题'),
    version: z.number().int().min(1),
  })
  .superRefine((card, ctx) => {
    // choice 题 answer 必须是合法选项下标
    for (const q of card.questionBank) {
      if (q.type === 'choice' && q.answer >= q.options.length) {
        ctx.addIssue({
          code: 'custom',
          message: `题目 ${q.id} 的 answer 超出 options 下标范围`,
          path: ['questionBank'],
        });
      }
    }
    // 重复 id 检查（media/顶级 examples/各节内嵌 examples 各自唯一）
    const dupCheck = (items, label, pathName) => {
      const seen = new Set();
      for (const m of items) {
        if (seen.has(m.id)) {
          ctx.addIssue({ code: 'custom', message: `${label} id 重复：${m.id}`, path: [pathName] });
        }
        seen.add(m.id);
      }
    };
    dupCheck(card.media, 'media', 'media');
    dupCheck(card.examples, 'examples', 'examples');
    const secExamples = card.sections.flatMap((s) => s.examples);
    dupCheck(secExamples, '节内 examples', 'sections');
    // emblems 中 type=image 的 content 必须等于本卡某个 media.id
    const mediaIds = new Set(card.media.map((m) => m.id));
    for (const e of card.emblems) {
      if (e.type === 'image' && !mediaIds.has(e.content)) {
        ctx.addIssue({
          code: 'custom',
          message: `emblem 引用了不存在的 media id：${e.content}`,
          path: ['emblems'],
        });
      }
    }
  });

// 提取文本中全部 [[术语]]
export function extractTerms(text) {
  const terms = [];
  const re = /\[\[([^\[\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) terms.push(m[1]);
  return terms;
}
