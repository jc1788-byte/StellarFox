# Code Documentation Standards

This repository documents code for developers and API consumers. Documentation
must describe purpose and behavior, not restate the implementation.

## Required coverage

- **Public TypeScript/JavaScript exports**: every exported class, interface,
  type, enum, function, and constant requires a TSDoc/JSDoc block.
- **Soroban public APIs**: every production `pub fn` and public trait method
  requires a rustdoc summary.
- **Non-obvious private logic**: add an inline comment only when intent,
  invariants, assumptions, or trade-offs are not clear from the code.
- **HTTP endpoints**: retain the OpenAPI description, parameters, response
  codes, and examples for public routes.

The repository baseline is **25% of public TypeScript/JavaScript exports**.
New public exports must meet 100% documentation coverage. The baseline should
be raised after documentation batches; the CI regression floor is 25% and must
not decrease.

## TSDoc/JSDoc format

Use a block immediately above the declaration:

```ts
/**
 * Calculates a bettor's position after a valid market update.
 *
 * @param position - Existing position before the update
 * @returns The updated position
 * @throws {ValidationError} When the position is invalid
 */
export function updatePosition(position: Position): Position {
  // ...
}
```

For exported React components, describe what the component renders and its
meaningful props:

```tsx
/** Renders the market odds and outcome labels. */
export function OddsDisplay({ market }: OddsDisplayProps) {
  // ...
}
```

Use `@example` for public helpers or APIs that have non-obvious call semantics.
Do not duplicate parameter names or types from the signature.

## Rustdoc format

Every production public function must include a short summary above the
declaration:

```rust
/// Places a wager and returns the resulting position.
pub fn place_bet(/* ... */) {}
```

For public types and complex functions, also document purpose, parameters,
return values, errors, and panics when applicable.

## Validation

Run all code-documentation checks locally:

```sh
npm run docs:check
python3 contracts/scripts/check_rustdoc.py
npm run docs:coverage
```

`npm run docs:check` fails if documentation coverage is below the configured
baseline. It supports `--threshold` and `--json` for local or CI use:

```sh
python3 scripts/check-code-documentation.py --threshold 25
python3 scripts/check-code-documentation.py --threshold 25 --json
```

Documentation checks run in CI for pull requests and pushes. Pull requests that
add public APIs must include TSDoc/JSDoc or rustdoc for every new public symbol.

## Review checklist

- Public symbols have complete TSDoc/JSDoc or rustdoc.
- Comments explain behavior, constraints, and edge cases.
- OpenAPI documentation matches the implemented HTTP contract.
- Examples compile or are kept current.
- The documentation coverage floor did not decrease.
