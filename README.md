# New Jobs Monitor: Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, Breezy HR, Personio

Monitor public ATS boards and pay per newly observed matching job, plus a run-started event. The example uses stateless demo mode, which can return and charge the same current jobs on every run.

Track Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, Breezy HR, Personio, Workday and Rippling boards without maintaining your own scraper. Each run compares published job IDs with persistent history and saves matching jobs it has not processed before.

## Quick start

The example input uses three small boards and the special demo key. Demo never reads or saves history. Use a persistent key such as default for daily monitoring:

```json
{
  "companies": [
    { "source": "ashby", "company": "linear" },
    { "source": "workable", "company": "huggingface" },
    { "source": "recruitee", "company": "bunq" }
  ],
  "stateKey": "demo",
  "maxNewJobs": 1000,
  "firstRun": "all",
  "keywords": [],
  "locations": []
}
```

With `firstRun: "all"`, the initial run returns existing matching jobs. Choose `"none"` to establish history without returning the initial jobs. This setting applies only when a persistent state key has no saved history. Demo always uses all, even if firstRun is none.

## Find a company identifier

Use the board identifier rather than a company name or full URL:

| Source | Where to look | Example identifier |
| --- | --- | --- |
| Greenhouse | Board path on `boards.greenhouse.io` or `job-boards.greenhouse.io`; custom career pages may link to these boards. | `stripe` |
| Lever | First path segment after `jobs.lever.co/`. | `palantir` |
| Ashby | First path segment after `jobs.ashbyhq.com/`. | `ramp` |
| Workable | Company path after `apply.workable.com/`; a `/j/` link identifies a job rather than its company board. | `huggingface` |
| Recruitee | Company subdomain in `company.recruitee.com`; a custom career domain may require inspecting its underlying board links. | `bunq` |
| SmartRecruiters | Company segment after `/v1/companies/` in the public API URL, also the first path segment after `jobs.smartrecruiters.com/`. Identifiers are case-sensitive. | `LinkedIn3` |
| Breezy HR | Company subdomain in `company.breezy.hr`. | `breezy` |
| Personio | Company subdomain in `company.jobs.personio.de`. | `personio` |

Identifiers can differ from company names. The Actor does not discover identifiers or follow custom career sites. A missing or inaccessible board appears as an error in the report.

## Input

- `companies`: 1–200 objects containing a supported `source` and a `company` identifier. Duplicate source/company pairs are queried once.
- `stateKey`: 1–60 letters, numbers, hyphens or underscores. Omitted or blank values use `default` with persistent history. The example prefills `demo`, which never reads or saves history and returns current matching jobs again on every run. Use separate persistent keys for independent lists.
- `maxNewJobs`: integer from 1 to 10000; defaults to 1000. Limits dataset output per run. Excess candidates remain pending for persistent keys.
- `firstRun`: `all` or `none`; defaults to `all`.
- `keywords`: up to 50 nonempty title substrings.
- `locations`: up to 50 nonempty location substrings.

Matching ignores case. Any keyword may match and any location may match; when both lists are populated, both conditions must pass. Empty lists disable their filter. Location filtering searches published location text, not the `remote` flag.

## Output

The default dataset contains one item per saved job. This shortened example uses a job from the saved Stripe response:

```json
{
  "source": "greenhouse",
  "company": "stripe",
  "id": "8172487",
  "title": "Abuse Investigator",
  "location": "Dublin",
  "url": "https://stripe.com/jobs/search?gh_jid=8172487"
}
```

Every item has 14 fields: `source`, `company`, `id`, `title`, `location`, `remote`, `department`, `url`, `publishedAt`, `updatedAt`, `salaryMin`, `salaryMax`, `salaryCurrency` and `salaryPeriod`. Missing values are null. Available dates use ISO UTC. Salaries come from structured source fields without currency conversion or parsing salary text.

The default key-value store's `OUTPUT` record contains the per-company `report`, counts of available, saved and processed jobs, charged event counts, and `budgetReached`. It also includes `demo`, `maxNewJobs`, `maxNewJobsReached`, `pendingJobs` and a `notice`. Pending jobs include candidates beyond the output limit and saved but uncharged jobs. If the budget stops the run before boards are requested, pendingJobs is null because candidates were not evaluated. In demo, pendingJobs describes only this run; there is no saved queue. Report `newJobs` counts matching candidates before a spending-limit stop; `savedJobs` and `processedJobs` show how many were delivered and acknowledged. Failed boards have `totalJobs: null` and an error message.

## Run daily

After deployment, save the input as an Apify Task and create a daily Schedule for that Task. Choose a persistent stateKey such as default instead of demo, and keep it between runs. Demo intentionally repeats current matching jobs and their charges. Prevent overlapping runs that share a key: state updates are not protected by a distributed lock.

For keys other than demo, history is stored in the named key-value store `new-jobs-monitor-state`, under your selected key. Runs in the same Apify account that use the same key share history; the key is not an access-control boundary. A different key starts independent history.

## Pricing

- `run-started`: $0.005 per valid run, including runs with no new jobs.
- `new-job`: $0.001 per newly observed matching job successfully charged.

Initial jobs returned by `firstRun: "all"` count as new to this history. Establishing a baseline with `firstRun: "none"` does not produce job events.

Before each batch, the Actor calculates how many new-job events fit the remaining spending limit when the charging manager supports that calculation. It saves up to 200 jobs in one dataset write, then charges that batch once. Without the calculator, it uses batches of one. If fewer events are charged than requested, only the first chargedCount jobs are acknowledged and processing stops. Persistent state is committed once at the end. Saved but uncharged jobs and jobs beyond maxNewJobs remain pending. Demo commits no history and may return and charge current jobs again on later runs. Check OUTPUT for pendingJobs, notices and charged counts.

Dataset writes, charges and state updates are separate operations. If a storage or charging failure prevents the final state commit, restarting may return and charge jobs again. Inspect the failed run's dataset and charges before restarting.

## What can you do with it?

### Start a daily hiring feed
Collect matching jobs from selected public company boards into a dataset. Keep the same persistent state key between runs so previously processed job IDs are remembered.

```json
{
  "companies": [{"source": "ashby", "company": "linear"}],
  "stateKey": "daily-hiring",
  "firstRun": "all",
  "maxNewJobs": 100
}
```

### Monitor future additions
Establish a baseline without returning the jobs already present on the first run. Subsequent runs using this key can return newly observed matching IDs.

```json
{
  "companies": [{"source": "recruitee", "company": "bunq"}],
  "stateKey": "future-additions",
  "firstRun": "none",
  "maxNewJobs": 100
}
```

### Build a focused research dataset
Filter job titles and published location text before saving matching jobs. This example searches the Stripe board for investigator roles in Dublin; results depend on the current board contents.

```json
{
  "companies": [{"source": "greenhouse", "company": "stripe"}],
  "stateKey": "role-research",
  "keywords": ["Investigator"],
  "locations": ["Dublin"],
  "maxNewJobs": 100
}
```

### Combine different hiring systems
Read boards hosted by different supported systems in one run. Source and company fields keep the resulting records attributable to their boards.

```json
{
  "companies": [
    {"source": "smartrecruiters", "company": "LinkedIn3"},
    {"source": "breezy", "company": "breezy"},
    {"source": "personio", "company": "personio"}
  ],
  "stateKey": "combined-boards",
  "maxNewJobs": 1000
}
```

## How much does it cost?

The event prices are USD 0.005 per valid run plus USD 0.001 per newly observed matching job successfully charged.

- A valid run with no charged new-job events: USD 0.005 + (0 × USD 0.001) = **USD 0.005**.
- A run with 100 charged new-job events: USD 0.005 + (100 × USD 0.001) = **USD 0.105**.

Initial matching jobs returned with `firstRun: "all"` count toward job events. A baseline established with `firstRun: "none"` produces no job events. These calculations cover the listed event prices; check your Apify account for any additional applicable platform charges.

Dataset writes, charges and history commits are separate operations. A failure before history is committed can cause a restarted run to return and charge jobs again; inspect the failed run before restarting.

## FAQ

### What counts as a new job?
A new job is a first-observed ID in the selected history, not necessarily a recently published vacancy. Edits and reappearances of previously observed IDs do not count as new.

### Can I change filters later?
Yes, but history includes observed IDs excluded by earlier filters, so changing filters does not return those jobs retroactively. Use a separate state key when you want independent history; keyword and location matching ignores case and searches substrings.

### What happens if a company board fails?
Other successful boards can still return results, and the failed board's previous history is preserved. Inspect the per-company report in the key-value store's `OUTPUT` record; a failure does not mean the board is empty.

### What are the main limits?
Input accepts 1–200 boards, up to 50 title keywords and 50 location filters, and `maxNewJobs` from 1 to 10000. The Actor uses supported public endpoints without browser scraping, login or identifier discovery; SmartRecruiters coverage is capped at 60 pages of up to 100 postings per company.

### How do I schedule a daily run?
Save the input as an Apify Task and create a daily Schedule for that Task. Keep a persistent state key and prevent overlapping runs using the same key; `demo` never saves history and can return and charge the same jobs again.

### How do I export CSV or JSON?
Open the run's default dataset in Apify and select a CSV or JSON export. The dataset contains job records; the separate `OUTPUT` record contains the run report and processing counts.

## Integrations

Start runs through the Apify API using the same input fields shown above. Configure Apify webhooks to notify your system about run lifecycle events. In an automation workflow, start the run, wait for completion and retrieve its dataset and `OUTPUT` report.

## Limits and behavior

- A failed company does not stop successful companies or erase its previous history. Failure is not evidence of an empty board.
- All observed IDs enter history, including jobs excluded by filters. Changing filters therefore does not return previously observed jobs. Use a new key when you intentionally want fresh history.
- Removed jobs remain recorded. Reappearing jobs and edits to existing IDs are not new jobs. New means first observed ID, not necessarily newly published.
- Requests default to a 30-second timeout, with at most four simultaneous requests. HTTP 429 and 5xx receive at most one retry. Excessive Retry-After waits stop that board attempt without an early retry. Transport errors and other HTTP errors are not retried.
- SmartRecruiters reads at most 60 pages of 100 postings per company; if that limit cuts a board short, the jobs read are returned and the company report carries a warning. Breezy HR and Personio do not publish structured salary data, so salary fields stay null there; Personio also leaves `remote` null.
- Coverage depends on each public endpoint. There is no browser, proxy, login, identifier discovery or automatic fallback scraping. History grows with observed IDs.

The earlier core live test returned 1627 jobs followed by zero new jobs. Seven boards succeeded in both rounds; Spotify timed out in round two with the test's five-second override, and the tested Workable `hackthebox` and Recruitee `mollie` identifiers returned 404. The 30-second default has not been revalidated against those boards. The Actor wrapper is tested offline; deployment, platform billing and scheduling require platform validation.

## Workday and Rippling


| Source | Board identifier |
| --- | --- |
| Workday | Public HTTPS board URL on `tenant.wdN.myworkdayjobs.com`, optionally with a locale, or `tenant/wdN/site`. |
| Rippling | Board slug from `ats.rippling.com/<slug>`. |

The other eight sources keep the identifiers documented above. Workday URL and short forms normalize to one company identity and share ID history. Foreign hosts, credentials, ports, query strings and fragments are rejected before requests.

```json
{
  "companies": [
    {
      "source": "workday",
      "company": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
    },
    {
      "source": "rippling",
      "company": "rippling"
    }
  ],
  "stateKey": "additional-boards",
  "firstRun": "none",
  "workdayMaxPages": 10
}
```

`workdayMaxPages` accepts integers from 1 to 100 and defaults to 10 per company. Each page contains up to 20 jobs: the default retrieves at most 200 jobs per company. Workday reports `pagesFetched`, `pageSize`, `maxPages`, `totalReported`, `truncated` and `stopReason`. Page caps and repeated pages may leave results incomplete. The initial reported total is retained when later pages report zero.

All sources in a run share one HTTP client with up to four concurrent requests. Only requests to the same Workday hostname (`*.myworkdayjobs.com`) or `api.rippling.com` wait at least 1.5 seconds after the previous response has been consumed. Different hostnames have independent queues. Host queues and waits do not occupy HTTP concurrency slots; the other eight sources have no added pause. Existing retry behavior is retained. Missing dates and salary fields remain null; relative Workday dates are not converted into absolute dates. Rippling completeness beyond its returned array has not been established.

