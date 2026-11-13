export const RUN_EVENT = 'run-started';
export const JOB_EVENT = 'new-job';
export const MAX_BATCH_SIZE = 200;

function isPayPerEvent(actor) {
  const info = actor.getChargingManager?.()?.getPricingInfo?.();
  return info ? info.isPayPerEvent === true : true;
}

function validateChargeResult(result, requested) {
  if (!result || !Number.isInteger(result.chargedCount) ||
      result.chargedCount < 0 || result.chargedCount > requested ||
      typeof result.eventChargeLimitReached !== 'boolean') {
    throw new Error('Invalid charging response; stop without retrying the charge');
  }
  return {
    processedCount: result.chargedCount,
    chargedCount: result.chargedCount,
    stop: result.chargedCount < requested || result.eventChargeLimitReached,
  };
}

/** Recalculate before every batch. Without the budget calculator, use one job. */
export async function affordableBatchSize(actor, remaining) {
  if (!Number.isInteger(remaining) || remaining < 0) {
    throw new TypeError('Remaining job count must be a nonnegative integer');
  }
  if (remaining === 0) return 0;
  const limit = Math.min(remaining, MAX_BATCH_SIZE);
  if (!isPayPerEvent(actor)) return limit;
  const manager = actor.getChargingManager?.();
  if (typeof manager?.calculateMaxEventChargeCountWithinLimit !== 'function') {
    return 1;
  }
  const affordable = await manager.calculateMaxEventChargeCountWithinLimit(JOB_EVENT);
  if (affordable !== Infinity &&
      (!Number.isInteger(affordable) || affordable < 0)) {
    throw new Error('Invalid affordable event count; stop before saving a batch');
  }
  return Math.min(limit, affordable);
}

/** Never retry a charge: a failed response can follow a successful payment. */
export async function chargeOne(actor, eventName) {
  if (![RUN_EVENT, JOB_EVENT].includes(eventName)) {
    throw new TypeError('Unsupported billing event');
  }
  if (!isPayPerEvent(actor)) {
    return { processed: true, chargedCount: 0, stop: false };
  }
  const result = validateChargeResult(
    await actor.charge({ eventName, count: 1 }), 1);
  return {
    processed: result.processedCount === 1,
    chargedCount: result.chargedCount,
    stop: result.stop,
  };
}

/** The caller must select an affordable batch immediately before this call.
 * Save the whole batch once, then charge once. Only the first processedCount
 * IDs may be committed to state. Storage and charging failures propagate.
 */
export async function saveAndChargeBatch(actor, jobs) {
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > MAX_BATCH_SIZE) {
    throw new TypeError('A job batch must contain between 1 and 200 records');
  }
  await actor.pushData(jobs);
  if (!isPayPerEvent(actor)) {
    return { processedCount: jobs.length, chargedCount: 0, stop: false };
  }
  return validateChargeResult(
    await actor.charge({ eventName: JOB_EVENT, count: jobs.length }),
    jobs.length);
}

/** Single-record compatibility helper. */
export async function saveAndCharge(actor, job) {
  await actor.pushData(job);
  return chargeOne(actor, JOB_EVENT);
}
