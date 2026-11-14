import { createJsonClient } from './http.mjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const joined = values => [...new Set(values.map(text).filter(Boolean))].join('; ') || null;

function locationName(location) {
  return text(location?.name) ?? joined([
    location?.city, location?.state?.name, location?.country?.name,
  ]);
}

export async function breezy(company, options) {
  if (typeof company !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(company)) {
    throw new TypeError('Company must be a public board identifier, without URLs or paths');
  }
  const getJson = options?.getJson ?? createJsonClient();
  const body = await getJson(`https://${encodeURIComponent(company)}.breezy.hr/json`);
  if (!Array.isArray(body)) throw new TypeError('breezy: unexpected job-list format');
  return body.map(job => {
    if (!job || typeof job !== 'object' || Array.isArray(job) ||
        !['string', 'number'].includes(typeof job.id) ||
        (typeof job.id === 'number' && !Number.isFinite(job.id)) ||
        !String(job.id).trim()) {
      throw new TypeError('breezy: job has no valid ID');
    }
    if (job.locations != null && !Array.isArray(job.locations)) {
      throw new TypeError('breezy: unexpected locations format');
    }
    const published = text(job.published_date);
    const timestamp = published ? Date.parse(published) : NaN;
    return {
      source: 'breezy', company, id: String(job.id),
      title: text(job.name),
      location: joined([locationName(job.location), ...(job.locations ?? []).map(locationName)]),
      remote: typeof job.location?.is_remote === 'boolean' ? job.location.is_remote : null,
      department: text(job.department),
      url: text(job.url),
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      updatedAt: null,
      // Free-text salaries do not reliably identify currency or a numeric range.
      salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null,
    };
  });
}
