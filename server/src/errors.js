// 统一业务错误：响应格式 { error: { code, message } }
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const errors = {
  unauthorized: (message = '未登录或凭证无效') => new ApiError(401, 'UNAUTHORIZED', message),
  forbiddenState: (message = '当前节点状态不允许该操作') =>
    new ApiError(403, 'FORBIDDEN_STATE', message),
  noTimer: (message = '没有进行中的倒计时') => new ApiError(409, 'NO_TIMER', message),
  dailyLimit: (message = '当日计时已达 120 分钟上限') => new ApiError(409, 'DAILY_LIMIT', message),
  noQuota: (message = '跃迁额度不足') => new ApiError(409, 'NO_QUOTA', message),
  forbidden: (message = '没有权限执行该操作') => new ApiError(403, 'FORBIDDEN', message),
  notFound: (message = '资源不存在') => new ApiError(404, 'NOT_FOUND', message),
  noRoute: (message = '无可用路线') => new ApiError(409, 'NO_ROUTE', message),
  validation: (message = '参数校验失败') => new ApiError(400, 'VALIDATION', message),
  rateLimited: (message = '请求过于频繁') => new ApiError(429, 'RATE_LIMITED', message),
};

// 全局错误处理（挂在所有路由之后）
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
}

// zod 校验请求体，失败抛 VALIDATION
export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(根)'}: ${i.message}`)
      .join('；');
    throw errors.validation(detail);
  }
  return result.data;
}
