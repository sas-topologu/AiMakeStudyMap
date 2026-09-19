// 学习策略（可配置、可关闭）
// 计时/防沉迷、跃迁额度这类"约束"是个人端自己的事，不是库的规矩：
// 库管理员可在 /admin 里随时调整，也可以把整条约束关掉 —— 个人端全功能、少限制。
// 存于 meta 表（键前缀 policy_），随库走，个人端连上后按策略显示或隐藏入口。
import { errors } from '../errors.js';

export const POLICY_DEFAULTS = {
  timerEnabled: true, // 计时与防沉迷是否生效（关闭后计时器仍可用，但不再卡人）
  dailyLimitMinutes: 120, // 当日计时上限（分钟），仅 timerEnabled 时生效
  jumpQuotaEnabled: true, // 跃迁额度是否生效（关闭后跃迁不再扣额度、也不再有门槛）
};

const KEYS = {
  timerEnabled: 'policy_timer_enabled',
  dailyLimitMinutes: 'policy_daily_limit_minutes',
  jumpQuotaEnabled: 'policy_jump_quota_enabled',
};

const read = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
const write = (db, key, value) =>
  db
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, String(value));

export function getPolicy(db) {
  const policy = { ...POLICY_DEFAULTS };
  const t = read(db, KEYS.timerEnabled);
  if (t !== null) policy.timerEnabled = t === '1';
  const d = Number(read(db, KEYS.dailyLimitMinutes));
  if (Number.isFinite(d) && d > 0) policy.dailyLimitMinutes = Math.floor(d);
  const q = read(db, KEYS.jumpQuotaEnabled);
  if (q !== null) policy.jumpQuotaEnabled = q === '1';
  return policy;
}

export function setPolicy(db, patch = {}) {
  if (typeof patch.timerEnabled === 'boolean') {
    write(db, KEYS.timerEnabled, patch.timerEnabled ? '1' : '0');
  }
  if (typeof patch.jumpQuotaEnabled === 'boolean') {
    write(db, KEYS.jumpQuotaEnabled, patch.jumpQuotaEnabled ? '1' : '0');
  }
  if (patch.dailyLimitMinutes !== undefined) {
    const n = Number(patch.dailyLimitMinutes);
    if (!Number.isFinite(n) || n < 5 || n > 1440) {
      throw errors.validation('当日计时上限需在 5～1440 分钟之间');
    }
    write(db, KEYS.dailyLimitMinutes, String(Math.floor(n)));
  }
  return getPolicy(db);
}
