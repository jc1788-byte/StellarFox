# Transaction Builder - Quick Reference Card

## Installation & Setup

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

const config = {
  sourceKeypair: Keypair.fromSecret('S...'),
  networkPassphrase: getNetworkPassphrase('testnet'), // or 'public'
  baseFee: 100, // stroops
  timeout: 300, // seconds
  memo: 'Optional memo',
};

const builder = createTransactionBuilder(config);
```

## Core Operations

### Add Contract Invocation
```typescript
builder.addContractInvocation(
  'CAAAA...', // contract address
  'method_name',
  [arg1, arg2, ...] // xdr.ScVal[]
);
```

### Add Payment
```typescript
builder.addPayment(
  'GDZST...', // destination
  'USD', // asset code (or 'XLM')
  '100.0000000' // amount
);
```

### Add Trustline
```typescript
builder.addTrustline('USD'); // asset code
```

### Add Create Account
```typescript
builder.addCreateAccount(
  'GDZST...', // destination
  '10.0000000' // starting balance
);
```

## Execution Methods

### Full Execution (Validate → Simulate → Sign → Submit)
```typescript
const result = await builder.execute();
// Returns: ExecutionResult { txHash, status, error?, ledger?, timestamp? }
```

### Dry-Run (No Submission)
```typescript
const { transaction, simulation } = await builder.dryRun();
// Returns: { transaction, simulation: SimulationResult }
```

### Manual Workflow
```typescript
const tx = await builder.build();
const sim = await builder.simulate(tx);
builder.sign(tx);
const result = await builder.submit(tx);
```

### Validation Only
```typescript
const validation = await builder.validateOperations();
if (!validation.valid) {
  console.error(validation.errors); // string[]
}
```

## Result Statuses

```typescript
result.status // 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'NOT_EXECUTED'

if (result.status === 'SUCCESS') {
  console.log('✓ Transaction:', result.txHash);
}
```

## Helper Classes

### ScValBuilder - Type Conversion
```typescript
import { ScValBuilder } from '@/utils/transactionHelper';

const args = [
  ScValBuilder.string('value'),
  ScValBuilder.address('GDZST...'),
  ScValBuilder.u64(1000),
  ScValBuilder.i128(BigInt('1000000')),
  ScValBuilder.bool(true),
  ScValBuilder.vec([val1, val2]),
];
```

### ContractOperations
```typescript
import { ContractOperations } from '@/utils/transactionHelper';

const ops = new ContractOperations(contractAddress, sourceKeypair);

// Single call
await ops.call('method', arg1, arg2);

// Batch calls (multiple methods in one transaction)
await ops.batchCall([
  { method: 'method1', args: [arg1] },
  { method: 'method2', args: [arg2] },
]);
```

### PaymentHelper
```typescript
import { PaymentHelper } from '@/utils/transactionHelper';

const helper = new PaymentHelper(sourceKeypair);

// Single payment
await helper.send(destination, 'USD', '100', 'memo');

// Batch payments
await helper.sendBatch([
  { destination, asset: 'USD', amount: '100' },
  { destination, asset: 'EUR', amount: '50' },
]);
```

### ComplexTransactionHelper
```typescript
import { ComplexTransactionHelper } from '@/utils/transactionHelper';

const helper = new ComplexTransactionHelper(sourceKeypair)
  .addTrustline('USD')
  .addPayment(dest, 'USD', '100')
  .addContractInvocation(contract, 'method', args);

const result = await helper.execute('memo');
// or: const { transaction, simulation } = await helper.dryRun();
```

## Validation

### Quick Validation
```typescript
import { TransactionValidator } from '@/utils/transactionHelper';

TransactionValidator.isValidAddress(addr); // boolean
TransactionValidator.isValidAmount(amt); // boolean
TransactionValidator.isValidAssetCode(code); // boolean
TransactionValidator.isValidContractAddress(addr); // boolean
TransactionValidator.isValidMethodName(name); // boolean

// Validate payment
const { valid, errors } = TransactionValidator.validatePayment(dest, asset, amt);
```

## Retry Logic

```typescript
import { TransactionRetry } from '@/utils/transactionHelper';

// Retry with exponential backoff
const result = await TransactionRetry.retryWithBackoff(
  () => builder.execute(),
  3, // max retries
  1000 // initial delay (ms)
);

// Retry with condition
const result = await TransactionRetry.retryIf(
  () => builder.execute(),
  (result) => result instanceof Error || result.status === 'TIMEOUT',
  3,
  1000
);
```

## Common Patterns

### Safe Execution (Validate → Simulate → Execute)
```typescript
const validation = await builder.validateOperations();
if (!validation.valid) throw new Error('Validation failed');

const { simulation } = await builder.dryRun();
if (!simulation.simulated) throw new Error('Simulation failed');

const result = await builder.execute();
```

### With Error Handling
```typescript
try {
  const result = await builder.execute();
  
  if (result.status === 'SUCCESS') {
    console.log('✓ Success:', result.txHash);
  } else if (result.status === 'TIMEOUT') {
    console.error('✗ Timeout:', result.txHash);
  } else if (result.status === 'FAILED') {
    console.error('✗ Failed:', result.error);
  }
} catch (err) {
  console.error('✗ Exception:', err.message);
}
```

### Fee Estimation
```typescript
import { getNetworkBaseFee } from '@/utils/transactionBuilder';

const baseFee = await getNetworkBaseFee();
console.log('Current base fee:', baseFee, 'stroops');

const { simulation } = await builder.dryRun();
console.log('Estimated total fee:', simulation.estimatedTotalFee, 'stroops');
```

## Operation Inspection

```typescript
builder.getOperationCount(); // number
builder.getOperations(); // Operation[]

const errors = builder.getValidationErrors(); // Map<number, ValidationResult>

builder.clear(); // Reset builder
```

## Environment Variables

```bash
# Required
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Optional
export HORIZON_URL=https://horizon-testnet.stellar.org
export STELLAR_NETWORK=testnet # or 'public'
```

## Typical Execution Flow

```
1. Create builder with config
   ↓
2. Add operations using fluent API
   ↓
3. Validate operations
   ↓
4. Simulate to estimate fees
   ↓
5. Execute (build, sign, submit)
   ↓
6. Poll for result
   ↓
7. Return execution result
```

## Error Messages Cheat Sheet

| Error | Cause | Fix |
|-------|-------|-----|
| "Contract address is required" | Missing contract address | Provide valid C-prefixed address |
| "Invalid contract address format" | Wrong address format | Use C-prefixed address |
| "Invalid destination address" | Wrong destination format | Use G-prefixed address |
| "Invalid amount format" | Negative/zero amount | Use positive amount |
| "Invalid asset code format" | Asset too long/not uppercase | Use 1-12 uppercase letters |
| "Transaction validation failed" | One or more operations invalid | Check validation.errors |
| "Simulation failed" | Contract/method not found | Check contract and method |
| "Transaction timed out" | Took too long to confirm | Retry or increase fee |
| "STELLAR_RPC_URL not set" | Missing environment variable | Set required env var |

## Validation Rules Quick Check

| Field | Valid | Invalid |
|-------|-------|---------|
| Contract Address | `C` + 55 chars | `G...`, `CAAA` |
| Destination | `G` + 55 chars | `C...`, short address |
| Amount | `100.1234567` | `100.12345678`, `-100`, `0` |
| Asset | `USD`, `XXXX` | `VERYLONGASSET`, `usd` |
| Method | `init_market` | `init-market`, `init market` |

## Example: Complete Market Setup

```typescript
import { ComplexTransactionHelper, ScValBuilder } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

const setup = new ComplexTransactionHelper(sourceKeypair)
  .addTrustline('USD')
  .addTrustline('EUR')
  .addContractInvocation(
    process.env.MARKET_FACTORY!,
    'create_market',
    [
      ScValBuilder.string('BTC_USD'),
      ScValBuilder.u64(Math.floor(Date.now() / 1000)),
      ScValBuilder.u64(Math.floor(Date.now() / 1000) + 86400),
    ]
  )
  .addPayment(treasuryAddress, 'USD', '1000.0000000');

const result = await setup.execute('Market setup transaction');
console.log('Market created:', result.txHash);
```

## Cheat Sheet Commands

```bash
# Run tests
npm test -- src/__tests__/transactionBuilder.test.ts

# Check types
npm run build -- --noEmit

# View documentation
cat src/utils/TRANSACTION_BUILDER_README.md
cat src/utils/TRANSACTION_EXAMPLES.md
cat src/utils/INTEGRATION_GUIDE.md
```

## Key Links

- **Full Documentation**: `src/utils/TRANSACTION_BUILDER_README.md`
- **13 Examples**: `src/utils/TRANSACTION_EXAMPLES.md`
- **Integration Guide**: `src/utils/INTEGRATION_GUIDE.md`
- **Test Suite**: `src/__tests__/transactionBuilder.test.ts`
- **Helpers**: `src/utils/transactionHelper.ts`

## Remember

✓ Always validate before executing
✓ Always simulate before submitting  
✓ Always handle errors gracefully
✓ Always log transaction hashes
✓ Always use current network fees
✓ Always test in testnet first
