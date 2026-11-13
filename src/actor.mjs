import { parseInput } from './input.mjs';
import { run } from './run.mjs';
import { jobKey } from './diff.mjs';
import { chargeOne, affordableBatchSize, saveAndChargeBatch, RUN_EVENT } from './billing.mjs';

export const STATE_STORE = 'new-jobs-monitor-state';

/** Dataset writes, charges and the final state commit are separate operations.
 * Serialize persistent runs sharing a state key. Demo never accesses storage.
 */
export async function main(actor, { runJobs = run } = {}) {
  const input = parseInput(await actor.getInput());
  const demo = input.stateKey === 'demo';
  const notices = demo
    ? ['Demo mode never reads or saves history. Current matching jobs are eligible on every run, regardless of firstRun, and may be charged again.']
    : [];
  let store;
  let previous;
  if (!demo) {
    store = await actor.openKeyValueStore(STATE_STORE);
    const saved = await store.getValue(input.stateKey);
    if (saved !== null && saved !== undefined &&
        (typeof saved !== 'object' || Array.isArray(saved) ||
         Object.values(saved).some(value => value !== true))) {
      throw new TypeError('Stored state must be an object of seen IDs mapped to true');
    }
    previous = saved == null ? undefined : { ...saved };
  }

  const started = await chargeOne(actor, RUN_EVENT);
  const eventsCharged = { 'run-started': started.chargedCount, 'new-job': 0 };
  if (started.stop) {
    notices.push('Spending limit reached at run start. No boards were requested; pending jobs were not evaluated.');
    const output = {
      stateKey: input.stateKey, demo, maxNewJobs: input.maxNewJobs,
      budgetReached: true, maxNewJobsReached: false,
      availableJobs: 0, savedJobs: 0, processedJobs: 0, pendingJobs: null,
      eventsCharged, report: [], notice: notices.join(' '),
    };
    await actor.setValue('OUTPUT', output);
    return output;
  }

  const { stateKey, maxNewJobs, ...runInput } = input;
  if (demo) runInput.firstRun = 'all';
  const result = await runJobs(runInput, previous, { timeoutMs: 30000 });
  const candidates = result.newJobs;
  const nextState = { ...result.state };
  // Remove every output candidate before applying either limit. Filtered
  // observations and firstRun=none baselines retain the core's semantics.
  for (const job of candidates) {
    const key = jobKey(job);
    if (!Object.hasOwn(previous ?? {}, key)) delete nextState[key];
  }
  const report = result.report.map(item => ({ ...item, savedJobs: 0, processedJobs: 0 }));
  const reportByCompany = new Map(report.map(item => [`${item.source}:${item.company}`, item]));
  const outputLimit = Math.min(candidates.length, maxNewJobs);
  let savedJobs = 0;
  let processedJobs = 0;
  let budgetReached = false;

  while (savedJobs < outputLimit) {
    const size = await affordableBatchSize(actor, outputLimit - savedJobs);
    if (size === 0) {
      budgetReached = true;
      break;
    }
    const batch = candidates.slice(savedJobs, savedJobs + size);
    const outcome = await saveAndChargeBatch(actor, batch);
    savedJobs += batch.length;
    eventsCharged['new-job'] += outcome.chargedCount;
    for (let index = 0; index < batch.length; index += 1) {
      const job = batch[index];
      const companyReport = reportByCompany.get(`${job.source}:${job.company}`);
      if (companyReport) companyReport.savedJobs += 1;
      if (index < outcome.processedCount) {
        nextState[jobKey(job)] = true;
        processedJobs += 1;
        if (companyReport) companyReport.processedJobs += 1;
      }
    }
    if (outcome.stop) {
      budgetReached = true;
      break;
    }
  }

  const pendingJobs = candidates.length - processedJobs;
  const maxNewJobsReached = candidates.length > maxNewJobs && savedJobs === outputLimit;
  if (budgetReached) {
    notices.push('Spending limit reached. Only successfully charged output IDs are acknowledged; saved but uncharged jobs remain pending.');
  }
  if (maxNewJobsReached) {
    notices.push('maxNewJobs reached. Jobs beyond the output limit remain pending.');
  }
  if (demo && pendingJobs > 0) {
    notices.push('Pending count describes this run only; demo saves no queue or progress.');
  }
  const output = {
    stateKey, demo, maxNewJobs, budgetReached, maxNewJobsReached,
    availableJobs: candidates.length, savedJobs, processedJobs, pendingJobs,
    eventsCharged, report, notice: notices.length ? notices.join(' ') : null,
  };
  // Commit once, after output storage and all successful billing operations.
  // Earlier failures preserve the previous state and may cause duplicates.
  await actor.setValue('OUTPUT', output);
  if (!demo) await store.setValue(stateKey, nextState);
  return output;
}
