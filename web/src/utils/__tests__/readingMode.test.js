// readingMode 可见性/折叠规则单测
import { describe, it, expect } from 'vitest';
import {
  isSectionListed,
  isSectionDefaultOpen,
  isExampleProblemShown,
  isStepsDefaultOpen,
  isAnswerDefaultOpen,
  isSupplementShown,
  mediaSrc,
} from '../readingMode.js';

describe('section 可见性（三档 × 三 tier）', () => {
  it('速览：只列 core（旧卡无 tier 视为 core），且默认收起', () => {
    expect(isSectionListed('core', 'glance')).toBe(true);
    expect(isSectionListed(undefined, 'glance')).toBe(true); // 旧卡
    expect(isSectionListed('detail', 'glance')).toBe(false);
    expect(isSectionListed('extended', 'glance')).toBe(false);
    expect(isSectionDefaultOpen('core', 'glance')).toBe(false);
  });

  it('标准：全部列出；core 展开，detail/extended 折叠', () => {
    for (const t of ['core', 'detail', 'extended', undefined]) {
      expect(isSectionListed(t, 'standard')).toBe(true);
    }
    expect(isSectionDefaultOpen('core', 'standard')).toBe(true);
    expect(isSectionDefaultOpen(undefined, 'standard')).toBe(true);
    expect(isSectionDefaultOpen('detail', 'standard')).toBe(false);
    expect(isSectionDefaultOpen('extended', 'standard')).toBe(false);
  });

  it('完整：全部列出且默认展开', () => {
    for (const t of ['core', 'detail', 'extended']) {
      expect(isSectionListed(t, 'full')).toBe(true);
      expect(isSectionDefaultOpen(t, 'full')).toBe(true);
    }
  });
});

describe('例题与补充区块', () => {
  it('速览只显示题目标题；标准显示题干；完整默认展开解析与答案', () => {
    expect(isExampleProblemShown('glance')).toBe(false);
    expect(isExampleProblemShown('standard')).toBe(true);
    expect(isStepsDefaultOpen('standard')).toBe(false);
    expect(isAnswerDefaultOpen('standard')).toBe(false);
    expect(isStepsDefaultOpen('full')).toBe(true);
    expect(isAnswerDefaultOpen('full')).toBe(true);
  });

  it('速览隐藏易错点/图集等补充区块', () => {
    expect(isSupplementShown('glance')).toBe(false);
    expect(isSupplementShown('standard')).toBe(true);
    expect(isSupplementShown('full')).toBe(true);
  });
});

describe('mediaSrc', () => {
  it('http(s) 原样；相对路径拼 /api/assets', () => {
    expect(mediaSrc('https://cdn.x.com/a.svg')).toBe('https://cdn.x.com/a.svg');
    expect(mediaSrc('http://x.com/a.gif')).toBe('http://x.com/a.gif');
    expect(mediaSrc('quadratic/parabola-roots.svg')).toBe('/api/assets/quadratic/parabola-roots.svg');
  });
});
