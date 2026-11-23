# Advanced Transaction Builder

A comprehensive TypeScript library for building, validating, simulating, and executing complex Stellar transactions with full support for Soroban contract interactions, traditional Stellar operations, and advanced error handling.

## Features

✅ **Fluent API** - Method chaining for intuitive transaction construction
✅ **Multi-Operation Support** - Combine multiple operations in a single transaction
✅ **Comprehensive Validation** - Built-in validation for all operation types
✅ **Dry-Run Simulation** - Test transactions before submission
✅ **Fee Optimization** - Automatic resource fee calculation
✅ **Operation Sequencing** - Maintain operation order across complex transactions
✅ **Error Handling** - Detailed error messages and validation feedback
✅ **Circuit Breaker** - Resilience against network failures
✅ **TypeScript Support** - Full type safety

## Installation

The transaction builder is included in the StellarFox backend. Import it directly:

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
```

## Quick Start

### Basic Usage

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair, Networks } from '@stellar/stellar-sdk';

// Initialize configuration
const sourceKeypair = Keypair.fromSecret('YOUR_SECRET_KEY');
const config = {
  sourceKeypair,
  networkPassphrase: getNetworkPassphrase('testnet'), // or 'public'
  baseFee: 100, // stroops
  timeout: 300, // seconds
  memo: 'Optional transaction memo',
};

// Create builder
const builder = createTransactionBuilder(config);

// Add operations
builder
  .addContractInvocation('CAAAA...', 'initialize', [])
  .addPayment('GDZST...', 'USD', '100.0000000')
  .addTrustline('EUR');

// Execute (build, sign, and submit)
const result = await builder.execute();
console.log('Transaction hash:', result.txHash);
console.log('Status:', result.status);
```

### Dry-Run (Simulation Only)

```typescript
// Build and simulate without submitting
const { transaction, simulation } = await builder.dryRun();

console.log('Simulated:', simulation.simulated);
console.log('Estimated fee:', simulation.estimatedTotalFee);
console.log('Resource fee:', simulation.minResourceFee);

if (!simulation.simulated) {
  console.error('Simulation failed:', simulation.error);
}
```

## API Reference

### TransactionBuilderAdvanced

The main class for building transactions.

#### Constructor

```typescript
new TransactionBuilderAdvanced(config: TransactionConfig)
```

**Parameters:**
- `config.sourceKeypair` - Keypair for signing transactions
- `config.networkPassphrase` - Network passphrase (TESTNET or PUBLIC)
- `config.baseFee` - Base fee in stroops (typically 100-1000)
- `config.timeout` - Transaction timeout in seconds (typically 300)
- `config.memo` - Optional transaction memo (text)

#### Adding Operations

All operation methods return `this` for method chaining.

##### Contract Invocation

```typescript
addContractInvocation(
  contractAddress: string,
  method: string,
  args: xdr.ScVal[],
  auth?: xdr.SorobanAuthorizationEntry[]
): this
```

**Example:**
```typescript
import { nativeToScVal } from '@stellar/stellar-sdk';

builder.addContractInvocation(
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C',
  'transfer',
  [
    nativeToScVal('recipient', { type: 'address' }),
    nativeToScVal('1000', { type: 'i128' }),
  ]
);
```

##### Payment

```typescript
addPayment(
  destination: string,
  asset: string,
  amount: string
): this
```

**Example:**
```typescript
builder.addPayment(
  'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
  'USD',
  '100.0000000'
);

// For native XLM
builder.addPayment(destination, 'XLM', '50.0000000');
```

##### Trustline

```typescript
addTrustline(asset: string): this
```

**Example:**
```typescript
builder.addTrustline('USD');
builder.addTrustline('EUR');
```

##### Create Account

```typescript
addCreateAccount(
  destination: string,
  startingBalance: string
): this
```

**Example:**
```typescript
builder.addCreateAccount(
  'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
  '10.0000000'
);
```

#### Account Initialization

```typescript
initializeSourceAccount(): Promise<void>
```

Loads the source account from Horizon. Called automatically during `build()`, but can be called explicitly for better error handling.

#### Validation

```typescript
validateOperations(): Promise<ValidationResult>
```

Returns a `ValidationResult` object:
```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

**Example:**
```typescript
const validation = await builder.validateOperations();

if (!validation.valid) {
  console.error('Validation errors:');
  validation.errors.forEach(err => console.error(`  - ${err}`));
}

if (validation.warnings.length > 0) {
  console.warn('Warnings:');
  validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
}
```

#### Building Transactions

```typescript
build(): Promise<Transaction>
```

Builds and validates the transaction. Requires source account to be initialized.

```typescript
const transaction = await builder.build();
console.log('Transaction XDR:', transaction.toXDR());
```

#### Simulation

```typescript
simulate(transaction: Transaction): Promise<SimulationResult>
```

Simulates transaction execution without submitting to the network.

Returns a `SimulationResult` object:
```typescript
interface SimulationResult {
  simulated: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  minResourceFee?: number;
  estimatedTotalFee?: number;
  results?: Array<{ returnValue?: xdr.ScVal; events?: unknown[] }>;
  error?: string;
}
```

**Example:**
```typescript
const transaction = await builder.build();
const simulation = await builder.simulate(transaction);

if (simulation.simulated) {
  console.log('Estimated total fee:', simulation.estimatedTotalFee, 'stroops');
}
```

#### Signing

```typescript
sign(transaction: Transaction): Transaction
```

Signs the transaction with the source keypair.

```typescript
const transaction = await builder.build();
builder.sign(transaction);
```

#### Submission

```typescript
submit(transaction: Transaction): Promise<ExecutionResult>
```

Submits a signed transaction to the network and polls for confirmation.

Returns an `ExecutionResult` object:
```typescript
interface ExecutionResult {
  txHash?: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'NOT_EXECUTED';
  error?: string;
  returnValues?: unknown[];
  ledger?: number;
  timestamp?: string;
}
```

**Example:**
```typescript
const transaction = await builder.build();
builder.sign(transaction);
const result = await builder.submit(transaction);

if (result.status === 'SUCCESS') {
  console.log('Transaction submitted:', result.txHash);
} else if (result.status === 'TIMEOUT') {
  console.error('Transaction timed out');
} else {
  console.error('Transaction failed:', result.error);
}
```

#### Full Execution

```typescript
execute(): Promise<ExecutionResult>
```

Builds, signs, and submits the transaction in one call.

```typescript
const result = await builder.execute();
```

#### Dry-Run

```typescript
dryRun(): Promise<{ transaction: Transaction; simulation: SimulationResult }>
```

Builds and simulates without signing or submitting.

```typescript
const { transaction, simulation } = await builder.dryRun();
```

#### Querying

```typescript
getOperations(): Operation[]
getOperationCount(): number
getValidationErrors(): Map<number, ValidationResult>
```

#### Clearing

```typescript
clear(): this
```

Removes all operations and resets the builder state. Returns `this` for chaining.

```typescript
builder.clear();
```

## Validation Rules

### Contract Invocation

- ✓ Contract address must be a valid Stellar contract address (C-prefixed)
- ✓ Method name must contain only alphanumeric characters and underscores
- ✓ At least one argument should be provided (warning if missing)

### Payment

- ✓ Destination must be a valid Stellar account address (G-prefixed)
- ✓ Amount must be positive and valid (max 7 decimal places)
- ✓ Asset code must be 1-12 uppercase letters (or 'XLM' for native)

### Trustline

- ✓ Asset code must be 1-12 uppercase letters

### Create Account

- ✓ Destination must be a valid Stellar account address
- ✓ Starting balance must be at least 1 XLM and valid format

## Error Handling

### Validation Errors

```typescript
try {
  const validation = await builder.validateOperations();
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
  }
} catch (err) {
  console.error('Validation error:', err);
}
```

### Execution Errors

```typescript
try {
  const result = await builder.execute();
  
  if (result.status === 'FAILED') {
    console.error('Transaction failed:', result.error);
    console.error('Transaction hash:', result.txHash);
  } else if (result.status === 'TIMEOUT') {
    console.error('Transaction timed out. Hash:', result.txHash);
  } else if (result.status === 'NOT_EXECUTED') {
    console.error('Transaction was not executed:', result.error);
  }
} catch (err) {
  console.error('Execution error:', err);
}
```

## Advanced Usage

### Multi-Operation Transaction

```typescript
const contractAddress = 'CAAAA...';
const destination = 'GDZST...';
const newAccount = Keypair.random().publicKey();

const result = await builder
  .addTrustline('USD')
  .addTrustline('EUR')
  .addPayment(destination, 'USD', '100')
  .addPayment(destination, 'EUR', '50')
  .addCreateAccount(newAccount, '10.0000000')
  .addContractInvocation(contractAddress, 'settle', [])
  .execute();
```

### Simulation Before Submission

```typescript
// Test the transaction
const { transaction, simulation } = await builder.dryRun();

if (!simulation.simulated) {
  throw new Error(`Simulation failed: ${simulation.error}`);
}

console.log('Transaction is valid!');
console.log('Estimated fee:', simulation.estimatedTotalFee);

// Now submit for real
const result = await builder.execute();
```

### Custom Fee Calculation

```typescript
import { getNetworkBaseFee } from '@/utils/transactionBuilder';

// Get current network base fee
const baseFee = await getNetworkBaseFee();
console.log('Current base fee:', baseFee);

// Use in configuration
const config = {
  sourceKeypair,
  networkPassphrase: getNetworkPassphrase('testnet'),
  baseFee: baseFee * 2, // Use 2x the network average
  timeout: 300,
};
```

### Validation Inspection

```typescript
await builder.validateOperations();
const errors = builder.getValidationErrors();

for (const [operationIndex, result] of errors) {
  console.log(`Operation ${operationIndex}:`);
  result.errors.forEach(err => console.error(`  Error: ${err}`));
  result.warnings.forEach(warn => console.warn(`  Warning: ${warn}`));
}
```

## Environment Variables

Required:
- `STELLAR_RPC_URL` - Soroban RPC endpoint (e.g., `https://soroban-testnet.stellar.org`)
- `HORIZON_URL` - Horizon server endpoint (defaults to testnet)

Optional:
- `STELLAR_NETWORK` - 'public' or 'testnet' (defaults to testnet)

## Testing

```typescript
import { createTransactionBuilder } from '@/utils/transactionBuilder';
import { Keypair, Networks } from '@stellar/stellar-sdk';

const testConfig = {
  sourceKeypair: Keypair.random(),
  networkPassphrase: Networks.TESTNET,
  baseFee: 100,
  timeout: 300,
};

const builder = createTransactionBuilder(testConfig);

// Test validation
const validation = await builder
  .addPayment('INVALID', 'USD', '100')
  .validateOperations();

expect(validation.valid).toBe(false);
```

## Integration with StellarService

The advanced transaction builder complements the existing `StellarService`:

```typescript
import { invokeContractProtected } from '@/services/StellarService';
import { createTransactionBuilder } from '@/utils/transactionBuilder';

// For simple single-operation invocations, use StellarService
const txHash = await invokeContractProtected(
  contractAddress,
  'method',
  args
);

// For complex multi-operation transactions, use TransactionBuilder
const result = await builder
  .addContractInvocation(contractAddress, 'method1', [])
  .addPayment(destination, 'USD', '100')
  .addContractInvocation(contractAddress2, 'method2', [])
  .execute();
```

## Best Practices

1. **Always initialize source account** - Call `initializeSourceAccount()` or let `build()` do it
2. **Validate before simulation** - Call `validateOperations()` to catch errors early
3. **Use dry-run for testing** - Always simulate before submitting important transactions
4. **Handle timeout errors** - Retry with bumped fees if transaction times out
5. **Check operation order** - Use `getOperations()` to verify ordering
6. **Clear between builds** - Call `clear()` when reusing builder instances
7. **Log transaction hashes** - Always store txHash for transaction tracking
8. **Set appropriate timeouts** - Adjust based on network conditions

## Troubleshooting

### "STELLAR_RPC_URL environment variable is required"

Ensure `STELLAR_RPC_URL` is set:
```bash
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

### "Failed to load source account"

Check:
- Keypair is valid (has sequence number >= 0)
- Account exists on the network
- Horizon URL is accessible

### "Transaction validation failed"

Check validation details:
```typescript
const validation = await builder.validateOperations();
console.error('Errors:', validation.errors);
console.error('Warnings:', validation.warnings);
```

### "Simulation failed"

Possible causes:
- Invalid contract address
- Invalid method name
- Incorrect argument types
- Contract does not implement the method

### "Transaction timed out"

The builder automatically retries with bumped fees (up to 3 times). If still timing out:
- Check network status
- Increase base fee
- Increase timeout value

## License

Same as StellarFox project.
