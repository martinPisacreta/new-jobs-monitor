const tenantPattern = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const sitePattern = '[a-z0-9][a-z0-9_-]*';
const shortPattern = new RegExp(`^(${tenantPattern})/(wd[0-9]+)/(${sitePattern})$`, 'i');
const publicUrlPattern = new RegExp(
  `^https://(${tenantPattern})\\.(wd[0-9]+)\\.myworkdayjobs\\.com/(?:(?:[a-z]{2}-[a-z]{2})/)?(${sitePattern})/?$`,
  'i',
);

/** Validate locally and use one company identity for URLs and short forms. */
export function normalizeWorkdayCompany(value) {
  if (typeof value !== 'string' || /[\s\\?#%]/.test(value)) {
    throw new TypeError('Workday company must be a public HTTPS board URL or tenant/wdN/site');
  }
  const match = shortPattern.exec(value) ?? publicUrlPattern.exec(value);
  if (!match) {
    throw new TypeError('Workday company must be a public HTTPS board URL on tenant.wdN.myworkdayjobs.com or tenant/wdN/site');
  }
  const [, tenant, cluster, site] = match;
  return `${tenant.toLowerCase()}/${cluster.toLowerCase()}/${site}`;
}
