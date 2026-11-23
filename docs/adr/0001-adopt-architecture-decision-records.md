# 0001. Adopt Architecture Decision Records

- **Date:** 2026-11-21
- **Status:** accepted
- **Supersedes:** None
- **Superseded by:** None

## Context

StellarFox has architecture documentation describing the current system, but no
consistent place to record why significant architectural choices were made.
Without that rationale, future contributors may repeat analysis or change a
decision without understanding its constraints and trade-offs.

## Decision drivers

- Keep records easy to create, review, and read alongside code changes.
- Preserve the reasoning and alternatives behind significant decisions.
- Make the current status and history of a decision clear.
- Avoid introducing a tool or build dependency for documentation.

## Considered options

### Markdown ADRs in the repository

- Advantages: versioned with the code, easy to review in pull requests, readable
  without special tooling, and simple to link from existing documentation.
- Disadvantages: contributors must maintain numbering and cross-links manually.

### Decisions recorded only in pull requests or issues

- Advantages: no additional files or process.
- Disadvantages: rationale is difficult to discover later and can be separated
  from the architecture it explains.

### External decision-tracking tool

- Advantages: may provide dedicated workflows and metadata.
- Disadvantages: adds a separate system and access dependency, and records are
  less directly tied to code history.

## Decision

Use sequentially numbered Markdown ADRs under `docs/adr/`. Each record follows a
shared template and documents its context, decision drivers, considered options,
decision, and consequences. Maintain an index and statuses in the directory
README. Accepted records remain intact; a later decision supersedes an earlier
one by updating its status and linking to a new ADR.

## Consequences

- Architectural rationale is versioned and reviewable alongside implementation
  changes.
- Contributors have a consistent structure for recording alternatives and
  trade-offs.
- Numbering and index updates require light manual maintenance.
- Existing design choices are not retroactively documented unless the team
  identifies a specific decision worth recording.

## References

- [Architecture overview](../architecture.md)
- [ADR process](README.md)
