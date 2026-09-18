// 允许的文件格式（可配置）：终端管理员可在设置中维护，不写死。
// 存于 meta.allowed_formats（JSON 数组，小写扩展名，不含点）。
// 资产服务与上传接口都以此为准 —— 既保证通道可控，又可按需要放开格式。
export const DEFAULT_FORMATS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', // 图片
  'pdf', 'txt', 'md', 'csv', 'json',          // 常见文档
];

const KEY = 'allowed_formats';

export function getAllowedFormats(db) {
  try {
    const raw = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY)?.value;
    if (!raw) return [...DEFAULT_FORMATS];
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return [...DEFAULT_FORMATS];
    return list.map((x) => String(x).toLowerCase().replace(/^\./, '')).filter(Boolean);
  } catch {
    return [...DEFAULT_FORMATS];
  }
}

export function setAllowedFormats(db, list) {
  const clean = [
    ...new Set(
      (Array.isArray(list) ? list : String(list).split(/[,，\s]+/))
        .map((x) => String(x).toLowerCase().trim().replace(/^\./, ''))
        .filter((x) => /^[a-z0-9]{1,10}$/.test(x))
    ),
  ];
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(KEY, JSON.stringify(clean));
  return clean;
}

export function isAllowed(db, ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  return e.length > 0 && getAllowedFormats(db).includes(e);
}

// 常见扩展名 → Content-Type（未知类型按二进制流返回）
const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function contentTypeOf(ext) {
  return MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}
