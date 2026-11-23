# Transaction Builder Examples

Comprehensive examples demonstrating various use cases for the advanced transaction builder and helper utilities.

## Basic Examples

### Example 1: Simple Payment

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function sendPayment() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);
  
  const result = await createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
  })
    .addPayment(
      'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
      'USD',
      '100.0000000'
    )
    .execute();

  console.log('Transaction:', result.txHash);
  console.log('Status:', result.status);
}
```

### Example 2: Create Account with Trustlines

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function createNewAccount() {
  const sourceKeypair = Keypair.fromSecret(process.env.FUNDER_KEY!);
  const newAccount = Keypair.random();

  const result = await createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
  })
    .addCreateAccount(newAccount.publicKey(), '10.0000000')
    .addTrustline('USD')
    .addTrustline('EUR')
    .execute();

  console.log('New account created:', newAccount.publicKey());
  console.log('Transaction:', result.txHash);
}
```

### Example 3: Contract Invocation

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';

async function invokeContract() {
  const sourceKeypair = Keypair.fromSecret(process.env.ORACLE_KEY!);
  const contractAddress = process.env.CONTRACT_ADDRESS!;

  const result = await createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
    memo: 'Contract initialization',
  })
    .addContractInvocation(
      contractAddress,
      'initialize',
      [
        nativeToScVal('admin', { type: 'address' }),
        nativeToScVal(1000, { type: 'u64' }),
      ]
    )
    .execute();

  console.log('Contract invoked:', result.txHash);
}
```

## Helper-Based Examples

### Example 4: Using ContractOperations

```typescript
import { ContractOperations, ScValBuilder } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function useContractOperations() {
  const sourceKeypair = Keypair.fromSecret(process.env.ORACLE_KEY!);
  const contractOps = new ContractOperations(
    process.env.CONTRACT_ADDRESS!,
    sourceKeypair
  );

  // Single method call
  const result1 = await contractOps.call(
    'set_price',
    ScValBuilder.string('USD'),
    ScValBuilder.u64(100)
  );

  // Multiple methods in one transaction
  const result2 = await contractOps.batchCall([
    {
      method: 'set_price',
      args: [
        ScValBuilder.string('USD'),
        ScValBuilder.u64(100),
      ],
    },
    {
      method: 'set_price',
      args: [
        ScValBuilder.string('EUR'),
        ScValBuilder.u64(85),
      ],
    },
  ]);

  console.log('Batch execution:', result2.txHash);
}
```

### Example 5: Using PaymentHelper

```typescript
import { PaymentHelper } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function usePaymentHelper() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);
  const paymentHelper = new PaymentHelper(sourceKeypair);

  // Send single payment
  const result1 = await paymentHelper.send(
    'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
    'USD',
    '100.0000000',
    'Payment memo'
  );

  // Send batch payments
  const result2 = await paymentHelper.sendBatch([
    {
      destination: 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
      asset: 'USD',
      amount: '100.0000000',
    },
    {
      destination: 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU',
      asset: 'EUR',
      amount: '50.0000000',
    },
  ], 'Batch payment');

  console.log('Batch payments sent:', result2.txHash);
}
```

### Example 6: Using AccountSetupHelper

```typescript
import { AccountSetupHelper } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function useAccountSetupHelper() {
  const sourceKeypair = Keypair.fromSecret(process.env.FUNDER_KEY!);
  const setupHelper = new AccountSetupHelper(sourceKeypair);
  const newAccount = Keypair.random().publicKey();

  // Create account with trustlines
  const result = await setupHelper.createAccount(
    newAccount,
    '10.0000000',
    ['USD', 'EUR', 'GBP']
  );

  console.log('Account setup complete:', result.txHash);

  // Later: add more trustlines
  const result2 = await setupHelper.addTrustlines(['JPY', 'CHF']);
  console.log('Trustlines added:', result2.txHash);
}
```

## Advanced Examples

### Example 7: Complex Multi-Step Transaction

```typescript
import { ComplexTransactionHelper, ScValBuilder } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function complexTransaction() {
  const sourceKeypair = Keypair.fromSecret(process.env.ORACLE_KEY!);
  const marketFactory = process.env.MARKET_FACTORY_ADDRESS!;
  const treasuryAddress = process.env.TREASURY_ADDRESS!;

  const complexTx = new ComplexTransactionHelper(sourceKeypair)
    // Step 1: Setup trustlines
    .addTrustline('USD')
    .addTrustline('EUR')
    // Step 2: Create market via contract
    .addContractInvocation(
      marketFactory,
      'create_market',
      [
        ScValBuilder.string('BTC_USD'),
        ScValBuilder.u64(Math.floor(Date.now() / 1000)),
        ScValBuilder.u64(Math.floor(Date.now() / 1000) + 86400),
      ]
    )
    // Step 3: Send payment to treasury
    .addPayment(treasuryAddress, 'USD', '100.0000000')
    // Step 4: Initialize market contract
    .addContractInvocation(
      marketFactory,
      'initialize_market',
      [
        ScValBuilder.string('BTC_USD'),
        ScValBuilder.u64(1000),
      ]
    );

  // Dry-run first to check everything
  const { transaction, simulation } = await complexTx.dryRun('Complex market setup');
  
  console.log('Transaction is valid:', simulation.simulated);
  console.log('Estimated fee:', simulation.estimatedTotalFee);
  console.log('Step count:', complexTx.getStepCount());

  if (simulation.simulated) {
    // Execute for real
    const result = await complexTx.execute('Complex market setup');
    console.log('Complex transaction:', result.txHash);
  }
}
```

### Example 8: Simulation and Fee Estimation

```typescript
import { createTransactionBuilder, getNetworkPassphrase, getNetworkBaseFee } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function simulateAndEstimateFees() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);
  const baseFee = await getNetworkBaseFee();

  console.log('Current network base fee:', baseFee, 'stroops');

  const builder = createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: baseFee, // Use current network fee
    timeout: 300,
  })
    .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'USD', '100')
    .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'EUR', '50');

  // Dry-run to see what fees would be
  const { transaction, simulation } = await builder.dryRun();

  if (simulation.simulated) {
    console.log('Simulation successful');
    console.log('Base fee:', baseFee, 'stroops');
    console.log('Resource fee:', simulation.minResourceFee, 'stroops');
    console.log('Total fee:', simulation.estimatedTotalFee, 'stroops');
    console.log('Total fee in XLM:', simulation.estimatedTotalFee! / 10_000_000);
  } else {
    console.error('Simulation failed:', simulation.error);
  }
}
```

### Example 9: Validation Before Execution

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { TransactionValidator } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function validateBeforeExecution() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);
  const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';

  // Pre-validate using helper
  const validation = TransactionValidator.validatePayment(destination, 'USD', '100');
  
  if (!validation.valid) {
    console.error('Payment validation failed:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    return;
  }

  // Build transaction
  const builder = createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
  })
    .addPayment(destination, 'USD', '100');

  // Validate through transaction builder
  const result = await builder.validateOperations();
  
  if (!result.valid) {
    console.error('Transaction validation failed:');
    result.errors.forEach(err => console.error(`  - ${err}`));
    return;
  }

  console.log('All validations passed, executing...');
  const execResult = await builder.execute();
  console.log('Transaction:', execResult.txHash);
}
```

### Example 10: Retry with Exponential Backoff

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { TransactionRetry } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

async function retryTransaction() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);

  // Retry with exponential backoff
  const result = await TransactionRetry.retryWithBackoff(
    async () => {
      return createTransactionBuilder({
        sourceKeypair,
        networkPassphrase: getNetworkPassphrase('testnet'),
        baseFee: 100,
        timeout: 300,
      })
        .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'USD', '100')
        .execute();
    },
    5, // max retries
    1000 // initial delay in ms
  );

  console.log('Transaction succeeded:', result.txHash);
}

async function retryWithCondition() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);

  // Retry if transaction times out
  const result = await TransactionRetry.retryIf(
    async () => {
      return createTransactionBuilder({
        sourceKeypair,
        networkPassphrase: getNetworkPassphrase('testnet'),
        baseFee: 100,
        timeout: 300,
      })
        .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'USD', '100')
        .execute();
    },
    (result) => {
      if (result instanceof Error) {
        return true; // retry on error
      }
      // Retry if transaction timed out
      return result.status === 'TIMEOUT';
    },
    3, // max retries
    1000 // initial delay in ms
  );

  console.log('Transaction result:', result);
}
```

## Error Handling Examples

### Example 11: Comprehensive Error Handling

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function comprehensiveErrorHandling() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);

  try {
    const builder = createTransactionBuilder({
      sourceKeypair,
      networkPassphrase: getNetworkPassphrase('testnet'),
      baseFee: 100,
      timeout: 300,
    })
      .addPayment('INVALID_ADDRESS', 'USD', '100');

    // Validate first
    const validation = await builder.validateOperations();
    
    if (!validation.valid) {
      console.error('Validation errors:');
      validation.errors.forEach(err => console.error(`  ✗ ${err}`));
    }

    if (validation.warnings.length > 0) {
      console.warn('Warnings:');
      validation.warnings.forEach(warn => console.warn(`  ⚠ ${warn}`));
    }

    // Only proceed if validation passed
    if (!validation.valid) {
      return;
    }

    // Dry-run before execution
    const { transaction, simulation } = await builder.dryRun();
    
    if (!simulation.simulated) {
      console.error('Simulation failed:', simulation.error);
      return;
    }

    console.log('Simulation successful');
    console.log('Estimated fee:', simulation.estimatedTotalFee, 'stroops');

    // Execute
    const result = await builder.execute();

    if (result.status === 'SUCCESS') {
      console.log('✓ Transaction succeeded:', result.txHash);
    } else if (result.status === 'TIMEOUT') {
      console.error('✗ Transaction timed out:', result.txHash);
    } else if (result.status === 'FAILED') {
      console.error('✗ Transaction failed:', result.error);
    } else if (result.status === 'NOT_EXECUTED') {
      console.error('✗ Transaction not executed:', result.error);
    }
  } catch (err) {
    console.error('Unexpected error:', err instanceof Error ? err.message : String(err));
  }
}
```

### Example 12: Handling Transaction Inspection

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function inspectTransaction() {
  const sourceKeypair = Keypair.fromSecret(process.env.SENDER_KEY!);

  const builder = createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
  })
    .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'USD', '100')
    .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'EUR', '50');

  // Inspect operations
  console.log('Operation count:', builder.getOperationCount());
  
  const operations = builder.getOperations();
  operations.forEach((op, index) => {
    console.log(`Operation ${index}:`, {
      type: op.config.type,
      order: op.order,
      validated: op.validated,
      errors: op.errors,
    });
  });

  // Validate and inspect errors
  const validation = await builder.validateOperations();
  const validationErrors = builder.getValidationErrors();

  for (const [opIndex, result] of validationErrors) {
    if (!result.valid) {
      console.log(`Operation ${opIndex} validation errors:`);
      result.errors.forEach(err => console.error(`  - ${err}`));
    }
  }
}
```

## Integration with Existing Services

### Example 13: Integration with StellarService

```typescript
import { invokeContractProtected, readContractStateProtected } from '@/services/StellarService';
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair } from '@stellar/stellar-sdk';

async function integrateWithStellarService() {
  // Use StellarService for simple single-operation calls
  const txHash = await invokeContractProtected(
    process.env.CONTRACT_ADDRESS!,
    'simple_method',
    []
  );

  console.log('Simple invocation:', txHash);

  // Use TransactionBuilder for complex multi-operation transactions
  const sourceKeypair = Keypair.fromSecret(process.env.ORACLE_KEY!);

  const result = await createTransactionBuilder({
    sourceKeypair,
    networkPassphrase: getNetworkPassphrase('testnet'),
    baseFee: 100,
    timeout: 300,
  })
    .addContractInvocation(process.env.CONTRACT_ADDRESS!, 'method1', [])
    .addPayment('GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU', 'USD', '100')
    .addContractInvocation(process.env.CONTRACT_ADDRESS_2!, 'method2', [])
    .execute();

  console.log('Complex transaction:', result.txHash);

  // Read contract state (no fees, no state changes)
  const state = await readContractStateProtected(
    process.env.CONTRACT_ADDRESS!,
    'get_state',
    []
  );

  console.log('Contract state:', state);
}
```

## Environment Setup

All examples assume these environment variables are set:

```bash
# Required
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
export STELLAR_NETWORK=testnet
export HORIZON_URL=https://horizon-testnet.stellar.org

# For examples
export SENDER_KEY=S... # Secret key for sender
export ORACLE_KEY=S... # Secret key for oracle
export FUNDER_KEY=S... # Secret key for account funder
export CONTRACT_ADDRESS=C... # Contract address
export MARKET_FACTORY_ADDRESS=C... # Market factory contract
export TREASURY_ADDRESS=G... # Treasury account
```

## Running Examples

```bash
# Run a single example
npx ts-node examples/sendPayment.ts

# Run all examples
npm run examples:transaction
```

## Best Practices Summary

1. **Always validate first** - Use `validateOperations()` before execution
2. **Simulate before submitting** - Use `dryRun()` for important transactions
3. **Handle timeouts gracefully** - Implement retry logic
4. **Use appropriate fee levels** - Call `getNetworkBaseFee()` for current rates
5. **Log transaction hashes** - Always store txHash for tracking
6. **Check operation order** - Use `getOperations()` to verify sequence
7. **Implement comprehensive error handling** - Handle all result statuses
8. **Use type-safe builders** - Leverage TypeScript for compile-time checks
9. **Test in testnet first** - Always test complex transactions before production
10. **Monitor network conditions** - Adjust fees and timeouts based on network load
