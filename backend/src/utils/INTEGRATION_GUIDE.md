# Transaction Builder Integration Guide

This guide helps you integrate the advanced transaction builder into your StellarFox services.

## Table of Contents

1. [For API Routes](#for-api-routes)
2. [For Services](#for-services)
3. [For Background Jobs](#for-background-jobs)
4. [Common Patterns](#common-patterns)
5. [Error Handling](#error-handling)
6. [Testing](#testing)

## For API Routes

### Example: Market Creation Endpoint

Before (using StellarService):
```typescript
// routes/markets.routes.ts
import { invokeContractProtected } from '@/services/StellarService';

export async function createMarket(req, res) {
  const { name, startTime, endTime } = req.body;
  
  try {
    const txHash = await invokeContractProtected(
      process.env.MARKET_FACTORY_ADDRESS!,
      'create_market',
      [name, startTime, endTime]
    );
    
    res.json({ txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

After (using TransactionBuilder):
```typescript
// routes/markets.routes.ts
import { createTransactionBuilder, getNetworkPassphrase, getNetworkBaseFee } from '@/utils/transactionBuilder';
import { ComplexTransactionHelper, ScValBuilder } from '@/utils/transactionHelper';
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';

export async function createMarket(req, res) {
  const { name, startTime, endTime, treasuryAddress } = req.body;
  
  try {
    // Get oracle keypair from environment
    const oracleKeypair = Keypair.fromSecret(process.env.ORACLE_PRIVATE_KEY!);
    
    // Get current base fee from network
    const baseFee = await getNetworkBaseFee();
    
    // Create transaction
    const builder = createTransactionBuilder({
      sourceKeypair: oracleKeypair,
      networkPassphrase: getNetworkPassphrase('testnet'),
      baseFee,
      timeout: 300,
      memo: `Create market: ${name}`,
    });
    
    // Add operations
    builder.addContractInvocation(
      process.env.MARKET_FACTORY_ADDRESS!,
      'create_market',
      [
        nativeToScVal(name, { type: 'string' }),
        nativeToScVal(startTime, { type: 'u64' }),
        nativeToScVal(endTime, { type: 'u64' }),
      ]
    );
    
    // Validate before execution
    const validation = await builder.validateOperations();
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'Transaction validation failed',
        details: validation.errors 
      });
    }
    
    // Dry-run to estimate fees
    const { simulation } = await builder.dryRun();
    if (!simulation.simulated) {
      return res.status(400).json({
        error: 'Transaction simulation failed',
        details: simulation.error
      });
    }
    
    // Execute
    const result = await builder.execute();
    
    if (result.status === 'SUCCESS') {
      res.json({
        txHash: result.txHash,
        ledger: result.ledger,
        estimatedFee: simulation.estimatedTotalFee,
      });
    } else if (result.status === 'TIMEOUT') {
      res.status(504).json({
        error: 'Transaction timeout',
        txHash: result.txHash,
      });
    } else {
      res.status(500).json({
        error: 'Transaction execution failed',
        details: result.error,
        txHash: result.txHash,
      });
    }
  } catch (err) {
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### Example: Batch Payment Endpoint

```typescript
// routes/payments.routes.ts
import { PaymentHelper } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

export async function batchPayments(req, res) {
  const { payments } = req.body; // Array of { destination, asset, amount }
  
  try {
    const sourceKeypair = Keypair.fromSecret(process.env.PAYMENT_KEY!);
    const helper = new PaymentHelper(sourceKeypair);
    
    // Validate all payments first
    for (const payment of payments) {
      const validation = TransactionValidator.validatePayment(
        payment.destination,
        payment.asset,
        payment.amount
      );
      
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Invalid payment configuration',
          payment,
          details: validation.errors,
        });
      }
    }
    
    // Execute batch
    const result = await helper.sendBatch(payments, 'Batch payment');
    
    res.json({
      txHash: result.txHash,
      status: result.status,
      paymentCount: payments.length,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Batch payment failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
```

## For Services

### Example: Market Service Enhancement

```typescript
// services/MarketService.ts
import { ComplexTransactionHelper, ScValBuilder, ContractOperations } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

export class MarketService {
  private oracleKeypair: Keypair;
  private marketFactoryAddress: string;
  private treasuryAddress: string;

  constructor() {
    this.oracleKeypair = Keypair.fromSecret(process.env.ORACLE_PRIVATE_KEY!);
    this.marketFactoryAddress = process.env.MARKET_FACTORY_ADDRESS!;
    this.treasuryAddress = process.env.TREASURY_ADDRESS!;
  }

  /**
   * Initialize a new market with all required setup
   */
  async initializeMarket(marketData: {
    name: string;
    symbol: string;
    startTime: number;
    endTime: number;
    initialFunding: string;
  }) {
    const helper = new ComplexTransactionHelper(this.oracleKeypair);

    // Step 1: Setup trustlines
    helper
      .addTrustline('USD')
      .addTrustline('EUR')
      // Step 2: Create market
      .addContractInvocation(
        this.marketFactoryAddress,
        'create_market',
        [
          ScValBuilder.string(marketData.name),
          ScValBuilder.string(marketData.symbol),
          ScValBuilder.u64(marketData.startTime),
          ScValBuilder.u64(marketData.endTime),
        ]
      )
      // Step 3: Send initial funding
      .addPayment(
        this.treasuryAddress,
        'USD',
        marketData.initialFunding
      );

    // Dry-run first
    const { transaction, simulation } = await helper.dryRun(
      `Initialize market: ${marketData.name}`
    );

    if (!simulation.simulated) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    // Store market setup transaction
    await this.db.marketSetups.create({
      marketName: marketData.name,
      txHash: transaction.hash(),
      status: 'pending',
      estimatedFee: simulation.estimatedTotalFee,
    });

    // Execute
    const result = await helper.execute(
      `Initialize market: ${marketData.name}`
    );

    // Update market setup status
    if (result.status === 'SUCCESS') {
      await this.db.marketSetups.update(transaction.hash(), {
        txHash: result.txHash,
        status: 'confirmed',
        ledger: result.ledger,
      });
    } else {
      await this.db.marketSetups.update(transaction.hash(), {
        status: result.status === 'TIMEOUT' ? 'timeout' : 'failed',
        error: result.error,
      });
    }

    return result;
  }

  /**
   * Settle multiple markets in parallel
   */
  async settleMarkets(marketIds: string[]) {
    const contractOps = new ContractOperations(
      this.marketFactoryAddress,
      this.oracleKeypair
    );

    const calls = marketIds.map(id => ({
      method: 'settle_market',
      args: [ScValBuilder.string(id)],
    }));

    return contractOps.batchCall(calls);
  }
}
```

## For Background Jobs

### Example: Cron Job for Market Settlement

```typescript
// cron/marketSettlement.ts
import { CronJob } from 'cron';
import { ComplexTransactionHelper, TransactionRetry } from '@/utils/transactionHelper';
import { Keypair } from '@stellar/stellar-sdk';

export async function setupMarketSettlementJob() {
  const oracleKeypair = Keypair.fromSecret(process.env.ORACLE_PRIVATE_KEY!);

  // Run every hour
  const job = new CronJob('0 * * * *', async () => {
    console.log('Running market settlement job...');

    try {
      // Get markets that need settlement
      const marketsToSettle = await db.markets.findDueForSettlement();

      if (marketsToSettle.length === 0) {
        console.log('No markets to settle');
        return;
      }

      console.log(`Found ${marketsToSettle.length} markets to settle`);

      // Settle with retry logic
      const result = await TransactionRetry.retryWithBackoff(
        async () => {
          const helper = new ComplexTransactionHelper(oracleKeypair);

          // Add settlement operation for each market
          for (const market of marketsToSettle) {
            helper.addContractInvocation(
              process.env.MARKET_FACTORY_ADDRESS!,
              'settle_market',
              [ScValBuilder.string(market.id)]
            );
          }

          return helper.execute('Market settlement batch');
        },
        3, // max retries
        2000 // initial delay
      );

      // Log the result
      if (result.status === 'SUCCESS') {
        console.log(`Settlement successful: ${result.txHash}`);
        
        // Update market settlement status
        for (const market of marketsToSettle) {
          await db.markets.update(market.id, {
            status: 'settled',
            settlementTx: result.txHash,
            settledAt: new Date(),
          });
        }
      } else {
        console.error(`Settlement failed: ${result.error}`, {
          status: result.status,
          txHash: result.txHash,
        });

        // Retry next cycle
        await db.markets.updateMany(
          marketsToSettle.map(m => m.id),
          { settlementAttempts: { increment: 1 } }
        );
      }
    } catch (err) {
      console.error('Market settlement job error:', err);
      // Send alert
    }
  });

  job.start();
  console.log('Market settlement job started');
  return job;
}
```

## Common Patterns

### Pattern 1: Validate, Simulate, Execute

```typescript
async function safeTransactionExecution(builder) {
  // Step 1: Validate
  const validation = await builder.validateOperations();
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
  }

  // Step 2: Simulate
  const { simulation } = await builder.dryRun();
  if (!simulation.simulated) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  console.log('Estimated fee:', simulation.estimatedTotalFee);

  // Step 3: Execute
  const result = await builder.execute();
  return result;
}
```

### Pattern 2: With Retry and Timeout Handling

```typescript
async function robustTransactionExecution(builder) {
  return TransactionRetry.retryIf(
    async () => {
      const validation = await builder.validateOperations();
      if (!validation.valid) {
        throw new Error(`Validation failed`);
      }

      const result = await builder.execute();
      return result;
    },
    (result) => {
      if (result instanceof Error) {
        return true; // Always retry on error
      }
      // Retry only on timeout, not on permanent failure
      return result.status === 'TIMEOUT';
    },
    3, // max retries
    1000 // initial delay
  );
}
```

### Pattern 3: Fee Optimization

```typescript
async function optimizedTransaction(builder, targetFeeXLM) {
  const baseFee = await getNetworkBaseFee();
  const targetFeeStroops = targetFeeXLM * 10_000_000;
  const estimatedBaseFee = Math.max(baseFee, Math.floor(targetFeeStroops / 2));

  builder.config.baseFee = estimatedBaseFee;

  const { simulation } = await builder.dryRun();
  
  if (simulation.estimatedTotalFee! > targetFeeStroops) {
    console.warn(
      `Estimated fee ${simulation.estimatedTotalFee} stroops exceeds target ${targetFeeStroops}`
    );
  }

  return builder.execute();
}
```

## Error Handling

### Pattern 1: Comprehensive Error Handling

```typescript
async function executeWithErrorHandling() {
  try {
    const result = await builder.execute();

    if (result.status === 'SUCCESS') {
      console.log('✓ Success:', result.txHash);
      return { success: true, txHash: result.txHash };
    } else if (result.status === 'TIMEOUT') {
      console.error('✗ Timeout:', result.txHash);
      // Could retry with bumped fee
      return { success: false, error: 'timeout', txHash: result.txHash };
    } else if (result.status === 'FAILED') {
      console.error('✗ Failed:', result.error);
      return { success: false, error: result.error };
    } else if (result.status === 'NOT_EXECUTED') {
      console.error('✗ Not executed:', result.error);
      return { success: false, error: 'not_executed' };
    }
  } catch (err) {
    console.error('✗ Exception:', err instanceof Error ? err.message : String(err));
    return { success: false, error: 'exception' };
  }
}
```

### Pattern 2: Validation Error Details

```typescript
async function executeWithDetailedValidation() {
  const validation = await builder.validateOperations();
  
  if (!validation.valid) {
    const errors = builder.getValidationErrors();
    
    const errorReport = {
      totalOperations: builder.getOperationCount(),
      failedValidations: errors.size,
      details: Array.from(errors.entries()).map(([opIndex, result]) => ({
        operationIndex: opIndex,
        errors: result.errors,
        warnings: result.warnings,
      })),
    };

    throw new Error(JSON.stringify(errorReport, null, 2));
  }

  return builder.execute();
}
```

## Testing

### Unit Test Example

```typescript
import { createTransactionBuilder, getNetworkPassphrase } from '@/utils/transactionBuilder';
import { Keypair, Networks } from '@stellar/stellar-sdk';

describe('MarketService Integration', () => {
  let marketService: MarketService;
  let testKeypair: Keypair;

  beforeEach(() => {
    testKeypair = Keypair.random();
    marketService = new MarketService();
  });

  it('should validate market initialization transaction', async () => {
    const builder = createTransactionBuilder({
      sourceKeypair: testKeypair,
      networkPassphrase: Networks.TESTNET,
      baseFee: 100,
      timeout: 300,
    });

    builder.addContractInvocation(
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C',
      'create_market',
      []
    );

    const validation = await builder.validateOperations();
    expect(validation.valid).toBe(true);
  });

  it('should reject invalid market initialization', async () => {
    const builder = createTransactionBuilder({
      sourceKeypair: testKeypair,
      networkPassphrase: Networks.TESTNET,
      baseFee: 100,
      timeout: 300,
    });

    builder.addContractInvocation('INVALID', 'create_market', []);

    const validation = await builder.validateOperations();
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});
```

## Migration Checklist

- [ ] Review documentation
- [ ] Run test suite: `npm test -- src/__tests__/transactionBuilder.test.ts`
- [ ] Update relevant routes with TransactionBuilder
- [ ] Update services to use helpers
- [ ] Add comprehensive error handling
- [ ] Update logging to include transaction hashes
- [ ] Add monitoring for transaction status
- [ ] Test in testnet with real operations
- [ ] Update API responses with fee estimates
- [ ] Document new API changes
- [ ] Deploy to production with monitoring

## Support Resources

- **API Reference**: `TRANSACTION_BUILDER_README.md`
- **Usage Examples**: `TRANSACTION_EXAMPLES.md`
- **Test Cases**: `src/__tests__/transactionBuilder.test.ts`
- **Helper Functions**: `src/utils/transactionHelper.ts`

## Next Steps

1. Copy relevant patterns from examples
2. Update your routes/services
3. Add error handling
4. Test thoroughly
5. Monitor in production
