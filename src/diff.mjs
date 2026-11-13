/** Persistent, cumulative state: { 'source:company:id': true }.
 * Pass undefined/null for the first run. An empty object means an existing
 * baseline with no jobs. Removed jobs remain seen; reappearances are not new.
 * Inputs are never mutated. Persist the returned state after a successful run.
 */
export function jobKey(job) {
  if (!job || typeof job !== 'object') {
    throw new TypeError('Each job must be an object');
  }
  for (const field of ['source', 'company']) {
    if (typeof job[field] !== 'string' || !job[field].trim() || job[field].includes(':')) {
      throw new TypeError(`Job ${field} must be a nonempty string without colons`);
    }
  }
  if (!['string', 'number'].includes(typeof job.id) ||
      (typeof job.id === 'number' && !Number.isFinite(job.id)) ||
      !String(job.id).trim()) {
    throw new TypeError('Job id must be a nonempty string or finite number');
  }
  return `${job.source}:${job.company}:${job.id}`;
}

export function diffJobs(currentJobs, previousState, { firstRun = 'all' } = {}) {
  if (!Array.isArray(currentJobs)) {
    throw new TypeError('currentJobs must be an array');
  }
  if (!['all', 'none'].includes(firstRun)) {
    throw new TypeError('firstRun must be all or none');
  }
  const initial = previousState === undefined || previousState === null;
  if (!initial && (typeof previousState !== 'object' || Array.isArray(previousState))) {
    throw new TypeError('previousState must be an object, null, or undefined');
  }

  const state = Object.fromEntries(Object.keys(previousState ?? {}).map(key => [key, true]));
  const newJobs = [];
  for (const job of currentJobs) {
    const key = jobKey(job);
    if (Object.hasOwn(state, key)) continue;
    state[key] = true;
    if (!initial || firstRun === 'all') newJobs.push(job);
  }
  return { newJobs, state };
}
