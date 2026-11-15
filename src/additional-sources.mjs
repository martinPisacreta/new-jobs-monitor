import { createJsonClient } from './http.mjs';
import { normalizeWorkdayCompany } from './workday-company.mjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function record(source, company, id, fields) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError(`${source}: job has no valid ID`);
  }
  return {
    source, company, id,
    title: null, location: null, remote: null, department: null, url: null,
    publishedAt: null, updatedAt: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null,
    ...fields,
  };
}

export async function rippling(company, options = {}) {
  if (typeof company !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(company)) {
    throw new TypeError('Rippling company must be a board identifier without URLs or paths');
  }
  const getJson = options.getJson ?? createJsonClient(options);
  const body = await getJson(
    `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(company)}/jobs`,
  );
  if (!Array.isArray(body)) {
    throw new TypeError('rippling: unexpected job-list format');
  }
  return body.map(job => {
    const location = text(job?.workLocation?.label);
    return record('rippling', company, text(job?.uuid), {
      title: text(job?.name), location,
      remote: /\bremote\b/i.test(location ?? '') ? true : null,
      department: text(job?.department?.label), url: text(job?.url),
    });
  });
}

export async function workday(company, options = {}) {
  company = normalizeWorkdayCompany(company);
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new TypeError('Workday maxPages must be an integer between 1 and 100');
  }
  const [tenant, cluster, site] = company.split('/');
  const origin = `https://${tenant}.${cluster}.myworkdayjobs.com`;
  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const getJson = options.getJson ?? createJsonClient(options);
  const jobs = [];
  const seen = new Set();
  const pageSize = 20;
  let offset = 0;
  let initialTotal = null;
  let pagesFetched = 0;
  let truncated = true;
  let stopReason = 'max-pages';

  for (let page = 0; page < maxPages; page += 1) {
    const body = await getJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset, searchText: '' }),
    });
    if (!Array.isArray(body?.jobPostings) ||
        !Number.isInteger(body.total) || body.total < 0 ||
        body.jobPostings.length > pageSize) {
      throw new TypeError('workday: unexpected job-list format');
    }
    pagesFetched += 1;
    // Observed later pages can report zero while still containing jobs.
    if (initialTotal === null) initialTotal = body.total;
    let added = 0;
    for (const job of body.jobPostings) {
      const path = text(job?.externalPath);
      if (!path?.startsWith('/job/') || /[?#\\\s]/.test(path)) {
        throw new TypeError('workday: job has no valid externalPath');
      }
      const url = new URL(`/${encodeURIComponent(site)}${path}`, origin);
      if (url.origin !== origin ||
          !url.pathname.startsWith(`/${encodeURIComponent(site)}/job/`)) {
        throw new TypeError('workday: invalid public job URL');
      }
      if (seen.has(path)) continue;
      seen.add(path);
      const location = text(job.locationsText);
      jobs.push(record('workday', company, path, {
        title: text(job.title), location,
        remote: /\bremote\b/i.test(location ?? '') ? true : null,
        url: url.href,
      }));
      added += 1;
    }
    offset += body.jobPostings.length;
    if (body.jobPostings.length < pageSize) {
      truncated = false;
      stopReason = 'short-page';
      break;
    }
    if (added === 0) {
      stopReason = 'repeated-page';
      break;
    }
    if (initialTotal > 0 && jobs.length >= initialTotal) {
      truncated = false;
      stopReason = 'reported-total';
      break;
    }
  }
  options.onPagination?.({
    pagesFetched, pageSize, maxPages,
    totalReported: initialTotal, truncated, stopReason,
  });
  return jobs;
}
