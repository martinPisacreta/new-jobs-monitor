import { setTimeout as delay } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** One shared client per run. Slots cover fetch and response consumption. */
export function createHttpClient({
  fetchImpl = globalThis.fetch,
  concurrency = 4,
  sleep = delay,
  now = Date.now,
  timeoutMs = 30000,
  maxRetryWaitMs = 30000,
  minIntervalMs = 0,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new TypeError('concurrency must be an integer from 1 to 4');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isFinite(maxRetryWaitMs) || maxRetryWaitMs < 0) {
    throw new TypeError('Invalid HTTP timeout or retry wait limit');
  }
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new TypeError('minIntervalMs must be a nonnegative number');
  }
  const hosts = new Map();
  let active = 0;
  const waiting = [];

  async function acquire() {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise(resolve => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  // Host queues and cooldowns do not occupy global HTTP slots.
  async function acquireHost(url) {
    if (minIntervalMs === 0) return () => {};
    const hostname = new URL(url).hostname;
    if (hostname !== 'api.rippling.com' &&
        !hostname.endsWith('.myworkdayjobs.com')) return () => {};
    let state = hosts.get(hostname);
    if (!state) {
      state = { tail: Promise.resolve(), finishedAt: null };
      hosts.set(hostname, state);
    }
    const previous = state.tail;
    let unlock;
    state.tail = new Promise(resolve => { unlock = resolve; });
    try {
      await previous;
      if (state.finishedAt !== null) {
        const remaining = state.finishedAt + minIntervalMs - now();
        if (remaining > 0) await sleep(remaining);
      }
    } catch (error) {
      unlock();
      throw error;
    }
    return () => {
      state.finishedAt = now();
      unlock();
    };
  }

  function retryWait(value) {
    if (!value?.trim()) return 1000;
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - now()) : 1000;
  }

  async function request(url, format, init = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const releaseHost = await acquireHost(url);
      await acquire();
      let wait;
      try {
        const headers = new Headers(init.headers);
        if (!headers.has('Accept')) {
          headers.set('Accept', format === 'text' ? 'application/xml, text/xml' : 'application/json');
        }
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        const response = await fetchImpl(url, {
          ...init,
          headers: Object.fromEntries([...headers].map(([key, value]) => [key === 'accept' ? 'Accept' : key, value])),
          redirect: 'error',
          signal,
        });
        if (response.ok) {
          return await (format === 'text' ? response.text() : response.json());
        }
        const error = new HttpError(response.status, url);
        const retryable = response.status === 429 ||
          (response.status >= 500 && response.status <= 599);
        const retryAfter = response.headers.get('retry-after');
        await response.body?.cancel();
        if (!retryable || attempt === 1) throw error;
        wait = retryWait(retryAfter);
        if (wait > maxRetryWaitMs) {
          error.message += '; Retry-After exceeds the run wait limit; no early retry';
          throw error;
        }
      } finally {
        release();
        releaseHost();
      }
      // Retry waits also occur outside HTTP slots and host locks.
      await sleep(wait);
    }
  }

  return {
    getJson: (url, init) => request(url, 'json', init),
    getText: (url, init) => request(url, 'text', init),
  };
}

export function createJsonClient(options) {
  return createHttpClient(options).getJson;
}
