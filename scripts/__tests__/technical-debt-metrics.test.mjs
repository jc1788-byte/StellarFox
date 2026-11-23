import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, formatReport } from "../technical-debt-metrics.mjs";

const now = new Date("2026-11-20T00:00:00.000Z");
const issue = (number, { impact = 4, likelihood = 3, urgency = 5, effort = 2, days = 40 } = {}) => ({
  number,
  title: `Debt ${number}`,
  labels: [{ name: "technical-debt" }],
  state: "OPEN",
  createdAt: new Date(now.getTime() - days * 86_400_000).toISOString(),
  body: `### Impact\n${impact}\n\n### Likelihood\n${likelihood}\n\n### Urgency\n${urgency}\n\n### Effort (engineering days)\n${effort}`,
});

test("scores open debt issues and orders ties by age then issue number", () => {
  const report = buildReport([issue(8), issue(3), issue(2, { effort: 1, days: 10 }), {
    ...issue(1),
    state: "CLOSED",
  }], now);

  assert.equal(report.openCount, 3);
  assert.equal(report.scoredCount, 3);
  assert.equal(report.estimatedDays, 5);
  assert.equal(report.exposure, 36);
  assert.deepEqual(report.topItems.map((item) => item.number), [2, 3, 8]);
  assert.equal(report.olderThan30Days, 2);
  assert.match(formatReport(report), /Technical debt metrics — 2026-11-20/);
});

test("counts incomplete scores and excludes unlabeled issues", () => {
  const incomplete = issue(4);
  incomplete.body = "### Impact\n6\n\n### Likelihood\n3\n\n### Effort (engineering days)\n0";
  const report = buildReport([incomplete, { ...issue(5), labels: [] }], now);

  assert.equal(report.openCount, 1);
  assert.equal(report.incompleteCount, 1);
  assert.equal(report.scoredCount, 0);
  assert.equal(report.averageScore, null);
  assert.equal(report.exposure, 0);
  assert.equal(report.estimatedDays, 0);
});

test("rejects non-array input instead of producing misleading metrics", () => {
  assert.throws(() => buildReport({}), /Expected a JSON array/);
});
