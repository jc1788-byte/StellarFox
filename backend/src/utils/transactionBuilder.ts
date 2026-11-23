/**
 * Advanced Transaction Builder for Stellar
 * 
 * Provides a fluent interface for building, validating, and executing
 * complex Stellar transactions with support for:
 * - Multiple operations in a single transaction
 * - Complex operation validation
 * - Dry-run simulation
 * - Fee optimization
 * - Operation grouping and sequencing
 * - Transaction history and retry logic
 */

import {
  Account,
  Address,
  Horizon,
  Keypair,
  Networks,
  Operation,
  rpc,
  Transaction,
  TransactionBuilder as StellarTransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Operation configuration for contract invocations
 */
export interface OperationConfig {
  type: 'invokeContract' | 'payment' | 'trustline' | 'accountCreation';
  contractAddress?: string;
  method?: string;
  args?: xdr.ScVal[];
  destination?: string;
  asset?: string;
  amount?: string;
  auth?: xdr.SorobanAuthorizationEntry[];
}

/**
 * Represents a single operation in a transaction
 */
export interface Operation {
  config: OperationConfig;
  order: number;
  validated: boolean;
  errors: string[];
}

/**
 * Transaction building configuration
 */
export interface TransactionConfig {
  sourceKeypair: Keypair;
  networkPassphrase: string;
  baseFee: number;
  timeout: number;
  memo?: string;
}

/**
 * Validation result for an operation
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Simulation result for transaction execution
 */
export interface SimulationResult {
  simulated: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  minResourceFee?: number;
  estimatedTotalFee?: number;
  results?: Array<{ returnValue?: xdr.ScVal; events?: unknown[] }>;
  error?: string;
}

/**
 * Transaction execution result
 */
export interface ExecutionResult {
  txHash?: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'NOT_EXECUTED';
  error?: string;
  returnValues?: unknown[];
  ledger?: number;
  timestamp?: string;
}

/**
 * Advanced Transaction Builder
 * 
 * Fluent interface for constructing complex multi-operation transactions
 * with comprehensive validation and error handling.
 */
export class TransactionBuilderAdvanced {
  private operations: Operation[] = [];
  private config: TransactionConfig;
  private sourceAccount: Account | null = null;
  private horizonServer: Horizon.Server;
  private sorobanServer: rpc.Server;
  private operationCounter = 0;
  private validationErrors: Map<number, ValidationResult> = new Map();

  constructor(config: TransactionConfig) {
    this.config = config;
    const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
    const rpcUrl = process.env.STELLAR_RPC_URL;

    if (!rpcUrl) {
      throw new Error('STELLAR_RPC_URL environment variable is required');
    }

    this.horizonServer = new Horizon.Server(horizonUrl);
    this.sorobanServer = new rpc.Server(rpcUrl);
  }

  /**
   * Add a contract invocation operation
   */
  public addContractInvocation(
    contractAddress: string,
    method: string,
    args: xdr.ScVal[],
    auth?: xdr.SorobanAuthorizationEntry[],
  ): this {
    this.operations.push({
      config: {
        type: 'invokeContract',
        contractAddress,
        method,
        args,
        auth: auth || [],
      },
      order: this.operationCounter++,
      validated: false,
      errors: [],
    });
    return this;
  }

  /**
   * Add a payment operation
   */
  public addPayment(
    destination: string,
    asset: string,
    amount: string,
  ): this {
    this.operations.push({
      config: {
        type: 'payment',
        destination,
        asset,
        amount,
      },
      order: this.operationCounter++,
      validated: false,
      errors: [],
    });
    return this;
  }

  /**
   * Add a trustline operation
   */
  public addTrustline(asset: string): this {
    this.operations.push({
      config: {
        type: 'trustline',
        asset,
      },
      order: this.operationCounter++,
      validated: false,
      errors: [],
    });
    return this;
  }

  /**
   * Add a create account operation
   */
  public addCreateAccount(destination: string, startingBalance: string): this {
    this.operations.push({
      config: {
        type: 'accountCreation',
        destination,
        amount: startingBalance,
      },
      order: this.operationCounter++,
      validated: false,
      errors: [],
    });
    return this;
  }

  /**
   * Initialize the source account from the network
   */
  public async initializeSourceAccount(): Promise<void> {
    try {
      this.sourceAccount = await this.horizonServer.loadAccount(
        this.config.sourceKeypair.publicKey(),
      );
    } catch (err) {
      throw new Error(`Failed to load source account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Validate all operations
   */
  public async validateOperations(): Promise<ValidationResult> {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    if (this.operations.length === 0) {
      allErrors.push('No operations added to transaction');
      return { valid: false, errors: allErrors, warnings: allWarnings };
    }

    for (const operation of this.operations) {
      const result = await this.validateOperation(operation);
      operation.validated = result.valid;
      this.validationErrors.set(operation.order, result);

      if (!result.valid) {
        allErrors.push(`Operation ${operation.order}: ${result.errors.join('; ')}`);
      }
      allWarnings.push(...result.warnings.map(w => `Operation ${operation.order}: ${w}`));
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  /**
   * Validate a single operation
   */
  private async validateOperation(operation: Operation): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (operation.config.type) {
      case 'invokeContract': {
        if (!operation.config.contractAddress) {
          errors.push('Contract address is required');
        } else if (!this.isValidStellarAddress(operation.config.contractAddress)) {
          errors.push('Invalid contract address format');
        }

        if (!operation.config.method) {
          errors.push('Method name is required');
        } else if (!/^[a-zA-Z0-9_]+$/.test(operation.config.method)) {
          errors.push('Method name contains invalid characters');
        }

        if (!operation.config.args || operation.config.args.length === 0) {
          warnings.push('No arguments provided for contract invocation');
        }
        break;
      }

      case 'payment': {
        if (!operation.config.destination) {
          errors.push('Destination address is required');
        } else if (!this.isValidStellarAddress(operation.config.destination)) {
          errors.push('Invalid destination address format');
        }

        if (!operation.config.amount) {
          errors.push('Amount is required');
        } else if (!this.isValidAmount(operation.config.amount)) {
          errors.push('Invalid amount format');
        }

        if (!operation.config.asset) {
          errors.push('Asset code is required');
        } else if (!/^[A-Z]{1,12}$/.test(operation.config.asset)) {
          errors.push('Invalid asset code format');
        }
        break;
      }

      case 'trustline': {
        if (!operation.config.asset) {
          errors.push('Asset code is required');
        } else if (!/^[A-Z]{1,12}$/.test(operation.config.asset)) {
          errors.push('Invalid asset code format');
        }
        break;
      }

      case 'accountCreation': {
        if (!operation.config.destination) {
          errors.push('Destination address is required');
        } else if (!this.isValidStellarAddress(operation.config.destination)) {
          errors.push('Invalid destination address format');
        }

        if (!operation.config.amount) {
          errors.push('Starting balance is required');
        } else if (!this.isValidAmount(operation.config.amount)) {
          errors.push('Invalid starting balance format');
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a Stellar address format
   */
  private isValidStellarAddress(address: string): boolean {
    try {
      // Check if it's a valid Stellar address (G or C prefix)
      return /^[GC][A-Z2-7]{55}$/.test(address) || /^T[A-Z0-9]{56}$/.test(address);
    } catch {
      return false;
    }
  }

  /**
   * Validate amount format
   */
  private isValidAmount(amount: string): boolean {
    try {
      const num = parseFloat(amount);
      return !isNaN(num) && num > 0 && /^\d+(\.\d{1,7})?$/.test(amount);
    } catch {
      return false;
    }
  }

  /**
   * Build the transaction
   */
  public async build(): Promise<Transaction> {
    if (!this.sourceAccount) {
      await this.initializeSourceAccount();
    }

    if (!this.sourceAccount) {
      throw new Error('Failed to initialize source account');
    }

    const validation = await this.validateOperations();
    if (!validation.valid) {
      throw new Error(`Transaction validation failed: ${validation.errors.join('; ')}`);
    }

    const builder = new StellarTransactionBuilder(this.sourceAccount, {
      fee: this.config.baseFee.toString(),
      networkPassphrase: this.config.networkPassphrase,
    });

    if (this.config.memo) {
      builder.addMemo({ type: 'text', value: this.config.memo });
    }

    // Sort operations by order and add them
    const sortedOps = [...this.operations].sort((a, b) => a.order - b.order);

    for (const operation of sortedOps) {
      this.addOperationToBuilder(builder, operation);
    }

    const transaction = builder.setTimeout(this.config.timeout).build();

    return transaction;
  }

  /**
   * Add an operation to the transaction builder
   */
  private addOperationToBuilder(
    builder: StellarTransactionBuilder,
    operation: Operation,
  ): void {
    const config = operation.config;

    switch (config.type) {
      case 'invokeContract': {
        if (!config.contractAddress || !config.method || !config.args) {
          throw new Error('Invalid contract invocation configuration');
        }

        const invokeContractHostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(config.contractAddress).toScAddress(),
            functionName: config.method,
            args: config.args,
          }),
        );

        builder.addOperation(
          Operation.invokeHostFunction({
            func: invokeContractHostFunction,
            auth: config.auth || [],
          }),
        );
        break;
      }

      case 'payment': {
        if (!config.destination || !config.amount || !config.asset) {
          throw new Error('Invalid payment configuration');
        }

        builder.addOperation(
          Operation.payment({
            destination: config.destination,
            asset: config.asset === 'XLM'
              ? StellarTransactionBuilder.native()
              : new StellarTransactionBuilder.asset(config.asset, config.destination),
            amount: config.amount,
          }),
        );
        break;
      }

      case 'trustline': {
        if (!config.asset) {
          throw new Error('Invalid trustline configuration');
        }

        builder.addOperation(
          Operation.changeTrust({
            asset: new StellarTransactionBuilder.asset(config.asset, this.config.sourceKeypair.publicKey()),
          }),
        );
        break;
      }

      case 'accountCreation': {
        if (!config.destination || !config.amount) {
          throw new Error('Invalid account creation configuration');
        }

        builder.addOperation(
          Operation.createAccount({
            destination: config.destination,
            startingBalance: config.amount,
          }),
        );
        break;
      }
    }
  }

  /**
   * Simulate the transaction
   */
  public async simulate(transaction: Transaction): Promise<SimulationResult> {
    try {
      const simulation = await this.sorobanServer.simulateTransaction(transaction as any);

      if ('error' in simulation && simulation.error) {
        return {
          simulated: false,
          status: 'FAILED',
          error: `Simulation error: ${JSON.stringify(simulation.error)}`,
        };
      }

      const simResult = simulation as Record<string, unknown>;
      const minResourceFee = simResult.minResourceFee ?? simResult.results?.[0]?.minResourceFee;
      const resourceFee = minResourceFee ? parseInt(String(minResourceFee), 10) : 0;
      const estimatedTotalFee = parseInt(transaction.fee, 10) + resourceFee;

      return {
        simulated: true,
        status: 'SUCCESS',
        minResourceFee: resourceFee,
        estimatedTotalFee,
        results: (simResult.results as any) ?? [],
      };
    } catch (err) {
      return {
        simulated: false,
        status: 'FAILED',
        error: `Simulation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Sign the transaction
   */
  public sign(transaction: Transaction): Transaction {
    transaction.sign(this.config.sourceKeypair);
    return transaction;
  }

  /**
   * Submit the transaction
   */
  public async submit(transaction: Transaction): Promise<ExecutionResult> {
    try {
      const response = await this.sorobanServer.sendTransaction(transaction as any);

      if (response.status !== 'PENDING') {
        return {
          status: 'FAILED',
          error: `Submit failed: ${response.status}`,
          txHash: response.hash,
        };
      }

      const txHash = response.hash;
      const startTime = Date.now();
      const maxWait = 30_000;

      // Poll for result
      while (Date.now() - startTime < maxWait) {
        const statusResponse = await this.sorobanServer.getTransaction(txHash);

        if (statusResponse.status === 'SUCCESS') {
          return {
            status: 'SUCCESS',
            txHash,
            ledger: (statusResponse as any).ledger,
            timestamp: new Date().toISOString(),
          };
        } else if (statusResponse.status === 'FAILED') {
          return {
            status: 'FAILED',
            txHash,
            error: `Transaction failed: ${JSON.stringify((statusResponse as any).resultXdr)}`,
          };
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return {
        status: 'TIMEOUT',
        txHash,
        error: 'Transaction timed out waiting for confirmation',
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: `Submit error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Build and simulate (dry-run)
   */
  public async dryRun(): Promise<{ transaction: Transaction; simulation: SimulationResult }> {
    const transaction = await this.build();
    const simulation = await this.simulate(transaction);
    return { transaction, simulation };
  }

  /**
   * Build, sign, and execute the transaction
   */
  public async execute(): Promise<ExecutionResult> {
    const transaction = await this.build();
    const simulation = await this.simulate(transaction);

    if (!simulation.simulated) {
      return {
        status: 'NOT_EXECUTED',
        error: simulation.error,
      };
    }

    this.sign(transaction);
    return this.submit(transaction);
  }

  /**
   * Get all operations
   */
  public getOperations(): Operation[] {
    return [...this.operations];
  }

  /**
   * Get validation errors for all operations
   */
  public getValidationErrors(): Map<number, ValidationResult> {
    return new Map(this.validationErrors);
  }

  /**
   * Clear all operations
   */
  public clear(): this {
    this.operations = [];
    this.operationCounter = 0;
    this.validationErrors.clear();
    return this;
  }

  /**
   * Get operation count
   */
  public getOperationCount(): number {
    return this.operations.length;
  }
}

/**
 * Factory function to create a new transaction builder
 */
export function createTransactionBuilder(config: TransactionConfig): TransactionBuilderAdvanced {
  return new TransactionBuilderAdvanced(config);
}

/**
 * Helper to get network passphrase based on environment
 */
export function getNetworkPassphrase(network: 'public' | 'testnet' = 'testnet'): string {
  return network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * Helper to get current base fee from the network
 */
export async function getNetworkBaseFee(horizonUrl?: string): Promise<number> {
  const url = horizonUrl ?? process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const horizonServer = new Horizon.Server(url);
  const feeStats = await horizonServer.feeStats();
  return parseInt(feeStats.p70_accepted_fee, 10);
}
