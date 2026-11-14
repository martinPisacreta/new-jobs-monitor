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
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new TypeError('concurrency must be an integer from 1 to 4');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isFinite(maxRetryWaitMs) || maxRetryWaitMs < 0) {
    throw new TypeError('Invalid HTTP timeout or retry wait limit');
  }
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

  function retryWait(value) {
    if (!value?.trim()) return 1000;
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - now()) : 1000;
  }

  async function request(url, format) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await acquire();
      let wait;
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: format === 'text' ? 'application/xml, text/xml' : 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
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
      }
      // Waiting never occupies a slot. Only HTTP 429 and 5xx qualify for retry.
      await sleep(wait);
    }
  }

  return {
    getJson: url => request(url, 'json'),
    getText: url => request(url, 'text'),
  };
}

export function createJsonClient(options) {
  return createHttpClient(options).getJson;
}
