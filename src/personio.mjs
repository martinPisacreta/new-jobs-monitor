import { createHttpClient } from './http.mjs';
import { parsePersonioXml } from './personio-xml.mjs';

export async function personio(company, options) {
  if (typeof company !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(company)) {
    throw new TypeError('Company must be a public board identifier, without URLs or paths');
  }
  const getText = options?.getText ?? createHttpClient().getText;
  const board = encodeURIComponent(company);
  const xml = await getText(`https://${board}.jobs.personio.de/xml`);
  return parsePersonioXml(xml).map(job => {
    const timestamp = job.createdAt ? Date.parse(job.createdAt) : NaN;
    return {
      source: 'personio', company, id: job.id, title: job.name,
      location: job.office, remote: null, department: job.department,
      url: `https://${board}.jobs.personio.de/job/${encodeURIComponent(job.id)}`,
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      updatedAt: null, salaryMin: null, salaryMax: null,
      salaryCurrency: null, salaryPeriod: null,
    };
  });
}
