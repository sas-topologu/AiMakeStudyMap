// 跃迁额度：月赠 1、存储上限 2
export function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// 跨月刷新：quota_month 不是当前月份时发放 1 点额度（上限 2），返回最新额度
export function refreshQuota(db, user) {
  const month = currentMonth();
  if (user.quota_month === month) return user.jump_quota;
  const quota = Math.min(2, user.jump_quota + 1);
  db.prepare('UPDATE users SET jump_quota = ?, quota_month = ? WHERE id = ?').run(
    quota,
    month,
    user.id
  );
  return quota;
}

export function getQuota(db, userId) {
  const row = db.prepare('SELECT jump_quota FROM users WHERE id = ?').get(userId);
  return row ? row.jump_quota : 0;
}

// 扣减 1 点额度（调用方需先确认额度充足）
export function consumeQuota(db, userId) {
  db.prepare('UPDATE users SET jump_quota = jump_quota - 1 WHERE id = ?').run(userId);
  return getQuota(db, userId);
}
