#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const SCORE_FIELDS = ["Impact", "Likelihood", "Urgency"];

function fieldValue(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^### ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m"));
  return match ? match[1].trim() : "";
}

function numericField(body, heading) {
  const value = fieldValue(body, heading);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function issueLabels(issue) {
  return (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function buildReport(input, now = new Date()) {
  if (!Array.isArray(input)) throw new TypeError("Expected a JSON array of GitHub issues.");

  const items = input
    .filter((issue) => issueLabels(issue).includes("technical-debt"))
    .filter((issue) => !issue.state || issue.state.toLowerCase() === "open")
    .map((issue) => {
      const body = issue.body || "";
      const dimensions = Object.fromEntries(
        SCORE_FIELDS.map((heading) => [heading.toLowerCase(), numericField(body, heading)]),
      );
      const effort = numericField(body, "Effort (engineering days)");
      const validDimensions = SCORE_FIELDS.every(
        (heading) => dimensions[heading.toLowerCase()] >= 1 && dimensions[heading.toLowerCase()] <= 5,
      );
      const validEffort = effort !== null && effort > 0;
      const complete = validDimensions && validEffort;
      const exposure =
        dimensions.impact >= 1 &&
        dimensions.impact <= 5 &&
        dimensions.likelihood >= 1 &&
        dimensions.likelihood <= 5
          ? dimensions.impact * dimensions.likelihood
          : null;
      const createdAt = issue.createdAt ? new Date(issue.createdAt) : null;
      const ageDays =
        createdAt && Number.isFinite(createdAt.getTime())
          ? Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000))
          : null;

      return {
        number: issue.number,
        title: issue.title || "(untitled)",
        ...dimensions,
        effort,
        complete,
        exposure,
        score: complete
          ? (dimensions.impact * dimensions.likelihood * dimensions.urgency) / effort
          : null,
        ageDays,
      };
    });

  const scored = items
    .filter((item) => item.complete)
    .sort((a, b) => b.score - a.score || (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.number - b.number);
  const ages = items.map((item) => item.ageDays).filter((age) => age !== null);
  const exposures = items.map((item) => item.exposure).filter((value) => value !== null);

  return {
    asOf: now.toISOString().slice(0, 10),
    openCount: items.length,
    scoredCount: scored.length,
    incompleteCount: items.length - scored.length,
    undatedCount: items.filter((item) => item.ageDays === null).length,
    estimatedDays: items.reduce(
      (sum, item) => sum + (item.effort !== null && item.effort > 0 ? item.effort : 0),
      0,
    ),
    exposure: exposures.reduce((sum, value) => sum + value, 0),
    averageScore: scored.length
      ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
      : null,
    medianAgeDays: median(ages),
    olderThan30Days: ages.filter((age) => age > 30).length,
    olderThan90Days: ages.filter((age) => age > 90).length,
    topItems: scored.slice(0, 10),
  };
}

export function formatReport(report) {
  const average = report.averageScore === null ? "n/a" : report.averageScore.toFixed(2);
  const medianAge = report.medianAgeDays === null ? "n/a" : `${report.medianAgeDays} days`;
  const rows = report.topItems.length
    ? report.topItems
        .map(
          (item) =>
            `| #${item.number} | ${item.title.replace(/\|/g, "\\|")} | ${item.score.toFixed(2)} | ${item.effort} | ${item.ageDays ?? "unknown"} |`,
        )
        .join("\n")
    : "| — | No scored debt items | — | — | — |";

  return [
    `## Technical debt metrics — ${report.asOf}`,
    "",
    `- Open items: ${report.openCount} (${report.scoredCount} scored; ${report.incompleteCount} incomplete)`,
    `- Estimated remediation: ${report.estimatedDays.toFixed(1)} engineering days`,
    `- Aggregate exposure (impact × likelihood): ${report.exposure}`,
    `- Average priority score: ${average}`,
    `- Median age: ${medianAge}; older than 30 days: ${report.olderThan30Days}; older than 90 days: ${report.olderThan90Days}`,
    `- Items without a usable creation date: ${report.undatedCount}`,
    "",
    "| Issue | Debt item | Score | Effort (days) | Age (days) |",
    "|---|---|---:|---:|---:|",
    rows,
    "",
    "Priority score = impact × likelihood × urgency ÷ effort (engineering days).",
    "",
  ].join("\n");
}

async function main() {
  let json = "";
  for await (const chunk of process.stdin) json += chunk;
  if (!json.trim()) throw new Error("Provide the `gh issue list --json ...` array on stdin.");
  const issues = JSON.parse(json);
  process.stdout.write(formatReport(buildReport(issues)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Technical debt report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
