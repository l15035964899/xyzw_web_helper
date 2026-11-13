export const TOKEN_RETRY_DELAYS_MS = [5_000, 15_000];

const RETRYABLE_CONNECTION_PATTERN =
  /未连接|连接已关闭|连接已断开|连接在建立前已关闭|连接超时|请求超时|WebSocket|socket|ECONN|ETIMEDOUT|1006|任务已停止/i;

/**
 * Determine whether a failed account can safely be retried from scratch.
 * Only a pure connection failure before any successful operation is retried,
 * preventing purchases, gifts, battles and other writes from being replayed.
 * @param {object} state Attempt outcome.
 * @param {number} state.successCount Successful operation count in this attempt.
 * @param {string|Error|null} state.error Last connection error.
 * @returns {boolean} Whether the account is eligible for a later retry.
 */
export function shouldRetryTokenAttempt({ successCount = 0, error = null }) {
  if (successCount > 0 || !error) return false;
  const message = typeof error === "string" ? error : error.message;
  return RETRYABLE_CONNECTION_PATTERN.test(String(message || ""));
}
