import { diffJobs, jobKey } from './diff.mjs';
import { createJsonClient } from './http.mjs';

function terms(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  return value.map(item => item.trim().toLowerCase()).filter(Boolean);
}

export function matchesFilters(job, keywords = [], locations = []) {
  const title = String(job.title ?? '').toLowerCase();
  const location = String(job.location ?? '').toLowerCase();
  return (!keywords.length || keywords.some(term => title.includes(term))) &&
    (!locations.length || locations.some(term => location.includes(term)));
}

/**
 * run(input, previousState?, options?) -> { newJobs, state, report }.
 * Persist state even when newJobs is empty. All observed jobs enter state,
 * including jobs excluded by filters. Changing filters does not reset history.
 * options.adapters and HTTP options allow tests without network requests.
 */
export async function run(input, previousState, options = {}) {
  if (!input || !Array.isArray(input.companies)) {
    throw new TypeError('companies must be an array');
  }
  const firstRun = input.firstRun ?? 'all';
  diffJobs([], previousState, { firstRun });
  const keywords = terms(input.keywords, 'keywords');
  const locations = terms(input.locations, 'locations');
  const companies = [];
  const seenCompanies = new Set();
  for (const entry of input.companies) {
    if (!entry || !['source', 'company'].every(field =>
      typeof entry[field] === 'string' && entry[field].trim() &&
      !entry[field].includes(':'))) {
      throw new TypeError('Each company needs nonempty source and company strings without colons');
    }
    const key = `${entry.source}:${entry.company}`;
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key);
      companies.push({ source: entry.source, company: entry.company });
    }
  }

  const adapters = options.adapters ?? await import('./sources.mjs');
  const getJson = createJsonClient(options);
  const results = await Promise.all(companies.map(async ({ source, company }) => {
    const started = performance.now();
    try {
      if (!Object.hasOwn(adapters, source) || typeof adapters[source] !== 'function') {
        throw new Error(`Unsupported source: ${source}`);
      }
      const jobs = await adapters[source](company, { getJson });
      if (!Array.isArray(jobs)) throw new TypeError('Source returned an invalid job list');
      const unique = new Map();
      for (const job of jobs) {
        if (job.source !== source || job.company !== company) {
          throw new TypeError('Source returned a mismatched job identity');
        }
        unique.set(jobKey(job), job);
      }
      return { jobs: [...unique.values()], report: {
        source, company, totalJobs: unique.size, newJobs: 0, error: null,
        durationMs: Math.round(performance.now() - started),
      } };
    } catch (error) {
      return { jobs: [], report: {
        source, company, totalJobs: null, newJobs: 0,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - started),
      } };
    }
  }));

  const diff = diffJobs(results.flatMap(result => result.jobs), previousState, { firstRun });
  const newJobs = diff.newJobs.filter(job => matchesFilters(job, keywords, locations));
  const reports = new Map(results.map(result =>
    [`${result.report.source}:${result.report.company}`, result.report]));
  for (const job of newJobs) reports.get(`${job.source}:${job.company}`).newJobs += 1;
  return { newJobs, state: diff.state, report: results.map(result => result.report) };
}

export default run;
