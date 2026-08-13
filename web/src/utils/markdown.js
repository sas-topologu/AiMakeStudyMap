// 极简 Markdown 渲染器（无依赖）
// 顺序约束：必须先提取 [[术语]]，再转义 HTML，再渲染其余语法，最后还原术语为可点击按钮
// 支持：段落、**加粗**、`行内代码`、- 无序列表、1. 有序列表
const TERM_OPEN = String.fromCharCode(1); // 术语占位符起始
const TERM_CLOSE = String.fromCharCode(2); // 术语占位符结束

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

export function renderMarkdown(src) {
  const terms = [];
  // 1) 提取 [[术语]] 为占位符（避免后续转义/行内语法破坏）
  let text = String(src ?? '').replace(/\[\[([^\[\]]+)\]\]/g, (_, name) => {
    terms.push(name.trim());
    return `${TERM_OPEN}${terms.length - 1}${TERM_CLOSE}`;
  });

  // 2) HTML 转义
  text = escapeHtml(text);

  // 3) 行内语法
  const inline = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  // 4) 块级：段落 / 列表
  const html = [];
  let para = [];
  let list = null; // { tag: 'ul'|'ol', items: [] }
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<${list.tag}>${list.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${list.tag}>`);
      list = null;
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) {
      flushPara();
      flushList();
    } else if ((m = line.match(/^[-*]\s+(.+)/))) {
      flushPara();
      if (list?.tag !== 'ul') flushList();
      list = list ?? { tag: 'ul', items: [] };
      list.items.push(m[1]);
    } else if ((m = line.match(/^\d+[.、]\s*(.+)/))) {
      flushPara();
      if (list?.tag !== 'ol') flushList();
      list = list ?? { tag: 'ol', items: [] };
      list.items.push(m[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  // 5) 还原术语占位符为可点击按钮（名称在此单独转义）
  const termRe = new RegExp(`${TERM_OPEN}(\\d+)${TERM_CLOSE}`, 'g');
  return html.join('').replace(termRe, (_, i) => {
    const name = terms[Number(i)];
    const safe = escapeHtml(name);
    return `<button type="button" class="term" data-term="${safe}">${safe}</button>`;
  });
}

// 提取文本中的全部 [[术语]] 名（不经渲染，供调试/预取）
export function extractTerms(src) {
  return [...String(src ?? '').matchAll(/\[\[([^\[\]]+)\]\]/g)].map((m) => m[1].trim());
}
