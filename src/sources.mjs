import { createJsonClient } from './http.mjs';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const joined = values => [...new Set(values.map(text).filter(Boolean))].join('; ') || null;

function identifier(company) {
  if (typeof company !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(company)) {
    throw new TypeError('Company must be a public board identifier, without URLs or paths');
  }
  return encodeURIComponent(company);
}

function date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function period(value) {
  const key = text(value)?.toLowerCase();
  return ({
    year: 'year', yearly: 'year', annual: 'year', annually: 'year', '1 year': 'year',
    month: 'month', monthly: 'month', '1 month': 'month',
    week: 'week', weekly: 'week', '1 week': 'week',
    day: 'day', daily: 'day', '1 day': 'day',
    hour: 'hour', hourly: 'hour', '1 hour': 'hour',
  })[key] ?? null;
}

function remote(explicit, workplace, location) {
  if (typeof explicit === 'boolean') return explicit;
  const type = text(workplace)?.toLowerCase();
  if (type === 'remote') return true;
  if (['hybrid', 'onsite', 'on-site', 'on site'].includes(type)) return false;
  return /\bremote\b/i.test(location ?? '') ? true : null;
}

function list(body, field, source) {
  const jobs = field === null ? body : body?.[field];
  if (!Array.isArray(jobs)) throw new TypeError(`${source}: unexpected job-list format`);
  return jobs;
}

function record(source, company, id, fields) {
  if (!['string', 'number'].includes(typeof id) ||
      (typeof id === 'number' && !Number.isFinite(id)) || !String(id).trim()) {
    throw new TypeError(`${source}: job has no valid ID`);
  }
  return {
    source, company, id: String(id),
    title: null, location: null, remote: null, department: null, url: null,
    publishedAt: null, updatedAt: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null,
    ...fields,
  };
}

function transport(options) {
  return options?.getJson ?? createJsonClient();
}

export async function greenhouse(company, options) {
  const board = identifier(company);
  const body = await transport(options)(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  return list(body, 'jobs', 'greenhouse').map(job => {
    const location = text(job.location?.name);
    return record('greenhouse', company, job.id, {
      title: text(job.title), location, remote: remote(null, null, location),
      department: joined((job.departments ?? []).map(item => item.name)),
      url: text(job.absolute_url),
      publishedAt: date(job.first_published), updatedAt: date(job.updated_at),
    });
  });
}

export async function lever(company, options) {
  const board = identifier(company);
  const body = await transport(options)(`https://api.lever.co/v0/postings/${board}?mode=json`);
  return list(body, null, 'lever').map(job => {
    const location = joined([job.categories?.location, ...(job.categories?.allLocations ?? [])]);
    const salary = job.salaryRange;
    return record('lever', company, job.id, {
      title: text(job.text), location, remote: remote(null, job.workplaceType, location),
      department: text(job.categories?.department) ?? text(job.categories?.team),
      url: text(job.hostedUrl), publishedAt: date(job.createdAt),
      salaryMin: number(salary?.min), salaryMax: number(salary?.max),
      salaryCurrency: text(salary?.currency), salaryPeriod: period(salary?.interval),
    });
  });
}

export async function ashby(company, options) {
  const board = identifier(company);
  const body = await transport(options)(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
  return list(body, 'jobs', 'ashby').filter(job => job.isListed !== false).map(job => {
    const location = joined([job.location, ...(job.secondaryLocations ?? []).map(item => item.location)]);
    // Use the published summary, not a blend of location-specific tiers.
    const salaries = (job.compensation?.summaryComponents ?? [])
      .filter(item => item.compensationType === 'Salary');
    const salary = job.shouldDisplayCompensationOnJobPostings === false || salaries.length !== 1
      ? null : salaries[0];
    return record('ashby', company, job.id, {
      title: text(job.title), location,
      remote: remote(job.isRemote, job.workplaceType, location),
      department: text(job.department), url: text(job.jobUrl),
      publishedAt: date(job.publishedAt),
      salaryMin: number(salary?.minValue), salaryMax: number(salary?.maxValue),
      salaryCurrency: text(salary?.currencyCode), salaryPeriod: period(salary?.interval),
    });
  });
}

export async function workable(company, options) {
  const board = identifier(company);
  const body = await transport(options)(`https://apply.workable.com/api/v1/widget/accounts/${board}`);
  return list(body, 'jobs', 'workable').map(job => {
    const locations = (job.locations ?? []).filter(item => item.hidden !== true)
      .map(item => joined([item.city, item.region, item.country]));
    const location = joined(locations) ?? joined([job.city, job.state, job.country]);
    return record('workable', company, job.shortcode, {
      title: text(job.title), location, remote: remote(job.telecommuting, null, location),
      department: text(job.department), url: text(job.url) ?? text(job.shortlink),
      publishedAt: date(job.published_on),
    });
  });
}

export async function recruitee(company, options) {
  const board = identifier(company);
  const body = await transport(options)(`https://${board}.recruitee.com/api/offers/`);
  return list(body, 'offers', 'recruitee').map(job => {
    const location = text(job.location) ?? joined([job.city, job.state_name, job.country]);
    const salary = job.salary && typeof job.salary === 'object' ? job.salary : null;
    return record('recruitee', company, job.id, {
      title: text(job.title), location,
      remote: remote(job.remote, job.hybrid === true ? 'hybrid' : job.on_site === true ? 'onsite' : null, location),
      department: text(job.department), url: text(job.careers_url),
      publishedAt: date(job.published_at), updatedAt: date(job.updated_at),
      salaryMin: number(salary?.min), salaryMax: number(salary?.max),
      salaryCurrency: text(salary?.currency), salaryPeriod: period(salary?.period),
    });
  });
}


export async function smartrecruiters(company, options) {
  const board = identifier(company);
  const getJson = transport(options);
  const result = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 60; page += 1) {
    const body = await getJson(`https://api.smartrecruiters.com/v1/companies/${board}/postings?limit=100&offset=${offset}`);
    const jobs = list(body, 'content', 'smartrecruiters');
    if (!Number.isSafeInteger(body.totalFound) || body.totalFound < 0) {
      throw new TypeError('smartrecruiters: invalid totalFound');
    }
    for (const job of jobs) {
      const location = joined([job.location?.city, job.location?.region, job.location?.country]);
      const item = record('smartrecruiters', company, job.id, {
        title: text(job.name), location,
        remote: remote(job.location?.remote, null, location),
        department: text(job.department?.label),
        url: `https://jobs.smartrecruiters.com/${board}/${encodeURIComponent(String(job.id))}`,
        publishedAt: date(job.releasedDate),
      });
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
    offset += jobs.length;
    if (offset >= body.totalFound) return result;
    if (!jobs.length) throw new Error('smartrecruiters: empty page before totalFound');
  }
  options?.onWarning?.(`SmartRecruiters reached the 60-page limit; returning ${result.length} unique jobs from ${offset} postings read. Coverage is incomplete.`);
  return result;
}

export { breezy } from './breezy.mjs';
export { personio } from './personio.mjs';
