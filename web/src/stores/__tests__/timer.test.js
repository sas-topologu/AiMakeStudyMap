import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const timerStart = vi.fn();
const timerCurrent = vi.fn();
vi.mock('../../api/client.js', () => ({
  api: { timerStart: (m) => timerStart(m), timerCurrent: () => timerCurrent() },
}));

const { useTimerStore } = await import('../timer.js');

// 离线时计时器必须仍可用（本地计时、不设上限）—— 否则"断网功能一个都不少"就是假的
describe('倒计时：联网走库、离线本地计时', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    timerStart.mockReset();
    timerCurrent.mockReset();
  });

  it('联网：采用库返回的计时与当日额度', async () => {
    const t = useTimerStore();
    const endsAt = new Date(Date.now() + 25 * 60000).toISOString();
    timerStart.mockResolvedValue({ endsAt, remainingSeconds: 1500 });
    timerCurrent.mockResolvedValue({
      timer: { endsAt, remainingSeconds: 1500 },
      daily: { usedSeconds: 0, remainingSeconds: 7200 },
    });

    const r = await t.start(25);

    expect(r.offline).toBeUndefined();
    expect(t.localOnly).toBe(false);
    expect(t.active).toBe(true);
    expect(t.remainingSeconds).toBe(1500);
    expect(t.dailyRemainingMinutes).toBe(120);
  });

  it('离线：退化为本地计时，不设上限、不占额度', async () => {
    const t = useTimerStore();
    timerStart.mockRejectedValue(Object.assign(new Error('offline'), { code: 'OFFLINE' }));

    const r = await t.start(25);

    expect(r.offline).toBe(true);
    expect(r.unlimited).toBe(true);
    expect(t.localOnly).toBe(true);
    expect(t.active).toBe(true);
    expect(t.remainingSeconds).toBe(1500);
    expect(t.daily.remainingSeconds).toBeNull(); // 不设上限
    expect(t.dailyRemainingMinutes).toBeNull();
  });

  it('业务拒绝（额度不足等）照旧抛出，不伪装成离线', async () => {
    const t = useTimerStore();
    timerStart.mockRejectedValue(Object.assign(new Error('quota'), { code: 'DAILY_LIMIT' }));

    await expect(t.start(25)).rejects.toThrow('quota');
    expect(t.localOnly).toBe(false);
  });
});
