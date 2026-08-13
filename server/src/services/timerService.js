// 倒计时与防沉迷
// - 倒计时不可取消；开启即把分钟数累加进 daily_usage（按自然日）
// - 当日累计上限 120 分钟；闯关必须有进行中的倒计时
import { errors } from '../errors.js';

export const DAILY_LIMIT_MINUTES = 120;

export function createTimerService(db) {
  // userId -> { endsAt, minutes }（内存存储，进程重启即失效；额度已落库不受影响）
  const active = new Map();

  const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  function usedSeconds(userId) {
    const row = db
      .prepare('SELECT seconds FROM daily_usage WHERE user_id = ? AND day = ?')
      .get(userId, today());
    return row ? row.seconds : 0;
  }

  // 开启倒计时：先校验并累计当日额度，再登记内存计时
  function start(userId, minutes) {
    const used = usedSeconds(userId);
    if (used + minutes * 60 > DAILY_LIMIT_MINUTES * 60) {
      throw errors.dailyLimit(
        `当日计时额度不足：已用 ${Math.floor(used / 60)} 分钟，上限 ${DAILY_LIMIT_MINUTES} 分钟`
      );
    }
    db.prepare(
      `INSERT INTO daily_usage (user_id, day, seconds) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`
    ).run(userId, today(), minutes * 60);

    const endsAt = Date.now() + minutes * 60 * 1000;
    active.set(userId, { endsAt, minutes });
    return { endsAt: new Date(endsAt).toISOString(), remainingSeconds: minutes * 60 };
  }

  // 当前进行中的计时（无或已过期返回 null）
  function current(userId) {
    const t = active.get(userId);
    if (!t || t.endsAt <= Date.now()) return null;
    return {
      endsAt: new Date(t.endsAt).toISOString(),
      remainingSeconds: Math.round((t.endsAt - Date.now()) / 1000),
    };
  }

  // 闯关前置：无进行中或已过期的计时 → NO_TIMER
  function requireActiveTimer(userId) {
    const t = active.get(userId);
    if (!t || t.endsAt <= Date.now()) {
      throw errors.noTimer('请先开启倒计时再闯关');
    }
    return t;
  }

  function dailyStatus(userId) {
    const used = usedSeconds(userId);
    return {
      usedSeconds: used,
      remainingSeconds: Math.max(0, DAILY_LIMIT_MINUTES * 60 - used),
    };
  }

  return { start, current, requireActiveTimer, dailyStatus };
}
