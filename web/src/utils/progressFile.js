// 个人进度文件：导出 / 导入的纯逻辑（与界面解耦，便于单测）
// 去中心化的要求是"数据能带走"：这份文件就是可以带走的东西。
export const FILE_KIND = 'starmap-progress';
export const FILE_VERSION = 1;

const LEVEL = { dim: 0, open: 1, passed: 2, lit: 3 };

// 把库侧进度 + 本地离线成果合成一份导出文件（同一节点取更高状态）
export function buildProgressFile({ source = null, states = [], local = [] } = {}, exportedAt = new Date().toISOString()) {
  const merged = new Map();
  for (const s of states) {
    if (s?.nodeId) merged.set(s.nodeId, { ...s });
  }
  for (const l of local) {
    if (!l?.nodeId) continue;
    const cur = merged.get(l.nodeId);
    if (!cur || (LEVEL[l.state] ?? 0) > (LEVEL[cur.state] ?? 0)) {
      // 离线产出的成果没有库见证 → 认证为否
      merged.set(l.nodeId, {
        nodeId: l.nodeId,
        state: l.state,
        passSeconds: l.passSeconds ?? null,
        litAt: null,
        certified: false,
      });
    }
  }
  return {
    kind: FILE_KIND,
    version: FILE_VERSION,
    exportedAt,
    source,
    states: [...merged.values()].sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId))),
  };
}

// 解析导入文件：返回 { ok: true, data } 或 { ok: false, error: '人话原因' }
export function parseProgressFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件内容不是一个进度对象' };
  }
  if (raw.kind !== FILE_KIND) return { ok: false, error: '这不是智点星谱的个人进度文件' };
  if (!Array.isArray(raw.states)) return { ok: false, error: '文件里没有进度数据（states）' };

  const states = raw.states
    .filter((s) => s && typeof s.nodeId === 'string' && s.state !== 'dim' && LEVEL[s.state] !== undefined)
    .map((s) => ({
      nodeId: s.nodeId,
      state: s.state,
      passSeconds: Number.isFinite(s.passSeconds) ? s.passSeconds : null,
      litAt: typeof s.litAt === 'string' ? s.litAt : null,
      certified: s.certified === true,
    }));

  if (states.length === 0) return { ok: false, error: '文件里没有可导入的进度' };
  return {
    ok: true,
    data: {
      version: Number(raw.version) || 1,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
      source: raw.source && typeof raw.source === 'object' ? raw.source : null,
      states,
    },
  };
}

// 文件名：starmap-progress-2026-09-19.json
export function progressFileName(exportedAt) {
  const day = String(exportedAt || new Date().toISOString()).slice(0, 10);
  return `starmap-progress-${day}.json`;
}
