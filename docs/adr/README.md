# Architecture Decision Records

Architecture Decision Records (ADRs) capture significant decisions about
StellarFox's architecture, including the context, alternatives, trade-offs, and
consequences. They complement the living [architecture overview](../architecture.md):
the overview describes the current system, while ADRs preserve why it is designed
that way.

## When to write an ADR

Write an ADR when a decision has a meaningful, lasting effect on system structure,
technology choices, data or service boundaries, security, or operations. Routine
implementation details do not need an ADR. If a change affects an existing
decision, update its status and write a new ADR describing the replacement rather
than rewriting the original rationale.

## Creating an ADR

1. Copy [`0000-template.md`](0000-template.md) to the next available number and a
   short, lowercase, hyphen-separated title, for example
   `0002-use-postgresql-for-persistence.md`.
2. Fill in the date, status, context, decision drivers, options considered,
   decision, and consequences. Record meaningful trade-offs, including drawbacks
   of the chosen option.
3. Submit the ADR with the change it documents, or in a focused documentation PR.
   Get feedback from the people reviewing the architectural change.
4. Once accepted, keep the decision and its rationale intact. If it is later
   replaced, mark it `superseded` and link to the replacing ADR.

Numbers are unique and sequential; do not reuse a number, including for rejected
or superseded decisions. Use these statuses:

- **proposed** — under discussion
- **accepted** — agreed and current
- **rejected** — considered but not selected
- **superseded** — replaced by a later ADR (link to it)

## Records

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-adopt-architecture-decision-records.md) | Adopt Architecture Decision Records | accepted |
