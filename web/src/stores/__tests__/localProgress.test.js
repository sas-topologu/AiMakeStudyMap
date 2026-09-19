import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const upload = vi.fn();
let current = 'https://lib-a';
vi.mock('../../api/client.js', () => ({
  api: { achievementsUpload: (items) => upload(items) },
  getTerminalBase: () => current,
}));

const { useLocalProgressStore } = await import('../localProgress.js');

// vitest node 环境无 localStorage → 提供内存 mock（跨 store 实例保留，模拟"切换数据源后重载"）
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('本地成果（离线产出 → 联网上报）', () => {
  beforeEach(() => {
    current = 'https://lib-a';
    setActivePinia(createPinia());
    localStorage.clear();
    upload.mockReset();
  });

  it('只升不降：后写的低状态不覆盖高状态', () => {
    const s = useLocalProgressStore();
    s.record('t.a', 'passed', { passSeconds: 12 });
    s.record('t.a', 'open');
    expect(s.stateOf('t.a')).toBe('passed');
    expect(s.items['t.a'].passSeconds).toBe(12);
  });

  it('merge：本地与库侧取更高者', () => {
    const s = useLocalProgressStore();
    s.record('t.a', 'passed');
    expect(s.merge('t.a', 'open')).toBe('passed'); // 本地更高
    expect(s.merge('t.a', 'lit')).toBe('lit'); // 库侧更高
    expect(s.merge('t.b', 'dim')).toBe('dim'); // 无本地记录
    expect(s.merge('t.a', null)).toBe('passed');
  });

  it('上报：全部待上报项一次发出；成功后清 pending，并采用库侧更高状态', async () => {
    const s = useLocalProgressStore();
    s.record('t.a', 'passed');
    s.record('t.b', 'passed');
    upload.mockResolvedValue({ accepted: 1, skipped: 1, states: { 't.b': 'lit' } });

    const r = await s.sync();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toEqual([
      { nodeId: 't.a', state: 'passed', passSeconds: null },
      { nodeId: 't.b', state: 'passed', passSeconds: null },
    ]);
    expect(r.accepted).toBe(1);
    expect(s.pending).toHaveLength(0);
    expect(s.stateOf('t.b')).toBe('lit'); // 库侧更高 → 采用库侧
    expect(s.stateOf('t.a')).toBe('passed'); // 本地成果保留展示
  });

  it('没有待上报项时不发请求', async () => {
    const s = useLocalProgressStore();
    await s.sync();
    expect(upload).not.toHaveBeenCalled();
  });

  it('上报失败时保留 pending，下次联网再试', async () => {
    const s = useLocalProgressStore();
    s.record('t.a', 'passed');
    upload.mockRejectedValue(new Error('OFFLINE'));
    await expect(s.sync()).rejects.toThrow('OFFLINE');
    expect(s.pending).toHaveLength(1);
  });

  it('按数据源分账：A 库的离线成果不会上报给 B 库', async () => {
    // 在 A 库离线通关
    let s = useLocalProgressStore();
    s.record('t.a', 'passed');
    expect(s.pending).toHaveLength(1);

    // 切到 B 库（真实场景是切换后重载 → 新 store 实例）
    current = 'https://lib-b';
    setActivePinia(createPinia());
    s = useLocalProgressStore();
    expect(s.pending).toHaveLength(0); // 看不到 A 的成果
    expect(s.stateOf('t.a')).toBeNull();

    s.record('t.b', 'passed');
    upload.mockResolvedValue({ accepted: 1, skipped: 0, states: {} });
    await s.sync();
    expect(upload.mock.calls[0][0]).toEqual([{ nodeId: 't.b', state: 'passed', passSeconds: null }]); // 只发 B 的

    // 切回 A 库：A 的成果仍在，且仍待上报
    current = 'https://lib-a';
    setActivePinia(createPinia());
    s = useLocalProgressStore();
    expect(s.pending).toEqual([{ nodeId: 't.a', state: 'passed', passSeconds: null }]);
    expect(s.merge('t.a', 'dim')).toBe('passed');
  });
});
