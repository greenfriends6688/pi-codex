/**
 * fork:auth-throttle — Web 密码的全局指数退避。
 *
 * Pi Web 是单机单操作员的 Web 端，绑定在 127.0.0.1，路由层拿不到可信的客户端地址
 * （x-forwarded-for 可伪造，直连时根本没有）。与其按 IP 分桶（分桶在直连场景下等于
 * 没有），不如让所有失败共用一个计数器：一旦连续失败就把**所有**密码尝试挡一小会儿。
 * 受影响的「其他人」只有操作员本人，而有限延迟对他可接受，却把暴力破解压到大约
 * 每分钟一次。
 *
 * 状态挂在 globalThis 的 Symbol 上，这样 Next.js 热重载不会把计数器清零。
 */

export const AUTH_THROTTLE_BASE_DELAY_MS = 1_000;
export const AUTH_THROTTLE_MAX_DELAY_MS = 60_000;

/**
 * 最后一次失败后多久忘记计数器。它必须**大于**最大延迟，否则「等过一次封禁」
 * 就等于把退避重置回基础延迟，反而给攻击者送上一轮新的尝试机会。
 */
export const AUTH_THROTTLE_RESET_AFTER_MS = 5 * 60_000;

export interface AuthThrottleState {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

const STATE_KEY = "pi-web:auth-throttle";

function freshState(): AuthThrottleState {
  return { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
}

function getGlobalState(): AuthThrottleState {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(STATE_KEY);
  const existing = store[key];
  if (isState(existing)) return existing;
  const created = freshState();
  store[key] = created;
  return created;
}

function isState(value: unknown): value is AuthThrottleState {
  return typeof value === "object"
    && value !== null
    && typeof (value as AuthThrottleState).failures === "number"
    && typeof (value as AuthThrottleState).lastFailureAt === "number"
    && typeof (value as AuthThrottleState).blockedUntil === "number";
}

function expireIfStale(state: AuthThrottleState, now: number): void {
  if (state.failures > 0 && now - state.lastFailureAt >= AUTH_THROTTLE_RESET_AFTER_MS) {
    Object.assign(state, freshState());
  }
}

export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  const exponent = Math.min(failures - 1, 31);
  return Math.min(AUTH_THROTTLE_BASE_DELAY_MS * 2 ** exponent, AUTH_THROTTLE_MAX_DELAY_MS);
}

/** 还需要等待多少毫秒才能接受下一次尝试；0 表示可以尝试。 */
export function getAuthRetryAfterMs(
  now = Date.now(),
  state: AuthThrottleState = getGlobalState(),
): number {
  expireIfStale(state, now);
  return Math.max(0, state.blockedUntil - now);
}

/** 记录一次失败，并返回从此施加给下一次尝试的延迟。 */
export function recordAuthFailure(
  now = Date.now(),
  state: AuthThrottleState = getGlobalState(),
): number {
  expireIfStale(state, now);
  state.failures += 1;
  state.lastFailureAt = now;
  const delay = backoffDelayMs(state.failures);
  state.blockedUntil = now + delay;
  return delay;
}

export function recordAuthSuccess(state: AuthThrottleState = getGlobalState()): void {
  Object.assign(state, freshState());
}

/** `Retry-After` 头要整秒；被封禁期间最小为 1。 */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
