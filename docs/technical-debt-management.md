# Technical debt management

Technical debt is tracked as GitHub issues, not as an informal side list. Issues labeled `technical-debt` are the source of truth for ownership, prioritization, and remediation. The portfolio report is generated from those issues; it is a snapshot, not another place to edit records.

Before using the template, create the repository label `technical-debt` in **Settings → Issues → Labels** so GitHub can apply it automatically.

## Record a debt item

Create an issue with the **Technical debt** template. Describe the current constraint and its concrete cost, affected area, evidence, and a remediation plan with verifiable acceptance criteria. Link related incidents, code, or issues. Separate independent debts into separate issues so they can be owned, prioritized, and closed independently.

Every open item should have:

- One accountable owner (an assignee), an affected area, and a review date.
- An impact, likelihood, urgency, and effort estimate.
- A bounded remediation plan, acceptance criteria, and validation approach.
- The `technical-debt` label. Keep normal workflow labels such as `bug`, `security`, or `backend` as applicable.

Do not label feature requests or routine defects as technical debt unless they represent an ongoing cost caused by a design or implementation shortcut.

## Prioritize consistently

Rate each dimension from 1 to 5 and estimate remediation effort in engineering days. Use the same team member-day convention for the whole backlog; fractional days are allowed.

**Priority score = impact × likelihood × urgency ÷ effort (days).** A higher score means more expected ongoing risk or cost per unit of remediation effort. Re-score when scope, usage, incidents, or estimates materially change. Use the score to order discussion, not as a substitute for engineering judgment; document overrides in the issue.

| Rating | Impact (cost if it occurs) | Likelihood (chance/exposure) | Urgency (time sensitivity) |
|---|---|---|---|
| 1 | Negligible; localized inconvenience | Rare, isolated path | No time pressure |
| 2 | Small, easily worked around | Uncommon or limited exposure | Can wait for planned maintenance |
| 3 | Noticeable recurring drag or degraded behavior | Plausible under normal use | Should be addressed in the next few cycles |
| 4 | Major reliability, delivery, or user impact | Frequent or broad exposure | Near-term deadline or repeated incidents |
| 5 | Critical data, financial, security, or availability consequence | Already happening or highly likely | Immediate risk, active incident, or hard deadline |

Estimate effort for the smallest complete remediation, including necessary tests and rollout. If an item is too large to estimate, split it into independently deliverable steps or record the first discovery/remediation step and re-estimate after it.

**Safety override:** active security exposure, data loss, financial integrity, or a production incident is handled through the relevant incident/security process regardless of score. Link that work to the debt issue and set its urgency to 5; do not let the score delay an emergency response.

## Remediation plan and lifecycle

1. Triage new items during backlog review: confirm it is debt, ensure the evidence and estimates are actionable, assign an owner, and set a review date.
2. Sort the scored backlog by descending score. Break ties by older age, then lower issue number. Select work based on capacity, dependencies, and risk; record any deliberate departure from the ranking.
3. Keep the issue's plan current: scope, owner, effort, dependencies, milestones if needed, acceptance criteria, and validation. Link implementation PRs to the issue.
4. Close only when the agreed acceptance criteria are met and the remediation is deployed or otherwise effective. If only part is addressed, close the completed issue and create/link a follow-up for remaining debt.
5. Revisit open items monthly and whenever a material incident, architecture change, or estimate change affects priority. Close obsolete items with a short reason rather than deleting the history.

Reserve capacity for debt explicitly during planning. The team chooses the allocation; the report supplies visibility and does not assume a fixed percentage.

## Measure the portfolio

Generate a point-in-time report from open issues labeled `technical-debt`:

```powershell
gh issue list --state open --label technical-debt --limit 1000 --json number,title,labels,createdAt,body,state |
  node scripts/technical-debt-metrics.mjs
```

The report includes the open and scored item counts, items with missing/invalid scores, total estimated remediation days, aggregate exposure (sum of impact × likelihood), average priority score, median age, items older than 30/90 days, and the highest-ranked items. These metrics answer:

- **How much is recorded?** Open item count, total estimated days, and missing-score count.
- **How much risk is represented?** Aggregate exposure and ranked score, interpreted with the safety override and issue evidence.
- **Is the backlog getting stale?** Median age and counts older than 30 and 90 days.

Capture a dated report at each monthly review if a historical trend is needed. Compare the same measures over time; an increase in recorded debt can mean better discovery, not necessarily regression. The script does not call GitHub or modify issues.
