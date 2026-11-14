export const SOURCES = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters', 'breezy', 'personio'];
export const MAX_COMPANIES = 200;

function filters(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 ||
      value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new TypeError(`${name} must contain at most 50 nonempty strings`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

export function parseInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Input must be an object');
  }
  if (!Array.isArray(input.companies) || input.companies.length < 1 ||
      input.companies.length > MAX_COMPANIES) {
    throw new TypeError('Provide between 1 and 200 companies');
  }
  const companies = [];
  const seen = new Set();
  for (const entry of input.companies) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !SOURCES.includes(entry.source) || typeof entry.company !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.company)) {
      throw new TypeError('Each company needs a supported source and a board identifier without URLs or paths');
    }
    const key = `${entry.source}:${entry.company}`;
    if (!seen.has(key)) {
      seen.add(key);
      companies.push({ source: entry.source, company: entry.company });
    }
  }
  const stateKey = input.stateKey === undefined ||
    (typeof input.stateKey === 'string' && !input.stateKey.trim())
    ? 'default' : input.stateKey;
  if (typeof stateKey !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(stateKey)) {
    throw new TypeError('stateKey must contain 1 to 60 letters, numbers, hyphens or underscores');
  }
  const firstRun = input.firstRun === undefined ? 'all' : input.firstRun;
  if (!['all', 'none'].includes(firstRun)) {
    throw new TypeError('firstRun must be all or none');
  }
  const maxNewJobs = input.maxNewJobs === undefined ? 1000 : input.maxNewJobs;
  if (!Number.isInteger(maxNewJobs) || maxNewJobs < 1 || maxNewJobs > 10000) {
    throw new TypeError('maxNewJobs must be an integer between 1 and 10000');
  }
  return { companies, stateKey, firstRun, maxNewJobs,
    keywords: filters(input.keywords, 'keywords'),
    locations: filters(input.locations, 'locations') };
}
