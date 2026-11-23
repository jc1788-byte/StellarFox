/**
 * Transaction Helper Utilities
 * 
 * High-level helpers for common transaction patterns and integration
 * with the existing StellarService. These utilities provide convenient
 * abstractions for frequently used transaction scenarios.
 */

import { xdr, Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import {
  createTransactionBuilder,
  getNetworkPassphrase,
  getNetworkBaseFee,
  TransactionConfig,
  ExecutionResult,
} from './transactionBuilder';

/**
 * Helper to convert common JavaScript types to Stellar ScVal
 */
export class ScValBuilder {
  /**
   * Convert a string to ScVal
   */
  static string(value: string): xdr.ScVal {
    return nativeToScVal(value, { type: 'string' });
  }

  /**
   * Convert an address to ScVal
   */
  static address(value: string): xdr.ScVal {
    return nativeToScVal(value, { type: 'address' });
  }

  /**
   * Convert a number to ScVal (u64)
   */
  static u64(value: number | bigint): xdr.ScVal {
    return nativeToScVal(typeof value === 'number' ? BigInt(value) : value, { type: 'u64' });
  }

  /**
   * Convert a number to ScVal (i128)
   */
  static i128(value: number | bigint): xdr.ScVal {
    return nativeToScVal(typeof value === 'number' ? BigInt(value) : value, { type: 'i128' });
  }

  /**
   * Convert a boolean to ScVal
   */
  static bool(value: boolean): xdr.ScVal {
    return nativeToScVal(value, { type: 'bool' });
  }

  /**
   * Convert an array to ScVal
   */
  static vec(values: xdr.ScVal[]): xdr.ScVal {
    return xdr.ScVal.scvVec(values);
  }

  /**
   * Convert an object to ScVal map
   */
  static map(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
    const mapEntries = entries.map(([key, value]) => ({
      key: () => this.string(key),
      value: () => value,
    }));
    return xdr.ScVal.scvMap(mapEntries as any);
  }
}

/**
 * Common contract operation patterns
 */
export class ContractOperations {
  private contractAddress: string;
  private sourceKeypair: Keypair;

  constructor(contractAddress: string, sourceKeypair: Keypair) {
    this.contractAddress = contractAddress;
    this.sourceKeypair = sourceKeypair;
  }

  /**
   * Initialize a contract with given parameters
   */
  async initialize(...params: xdr.ScVal[]): Promise<ExecutionResult> {
    const config = await this.buildConfig();
    return createTransactionBuilder(config)
      .addContractInvocation(this.contractAddress, 'initialize', params)
      .execute();
  }

  /**
   * Call a contract method
   */
  async call(method: string, ...args: xdr.ScVal[]): Promise<ExecutionResult> {
    const config = await this.buildConfig();
    return createTransactionBuilder(config)
      .addContractInvocation(this.contractAddress, method, args)
      .execute();
  }

  /**
   * Batch call multiple contract methods in a single transaction
   */
  async batchCall(calls: Array<{ method: string; args: xdr.ScVal[] }>): Promise<ExecutionResult> {
    const config = await this.buildConfig();
    const builder = createTransactionBuilder(config);

    for (const call of calls) {
      builder.addContractInvocation(this.contractAddress, call.method, call.args);
    }

    return builder.execute();
  }

  /**
   * Get transaction configuration with current network settings
   */
  private async buildConfig(): Promise<TransactionConfig> {
    const baseFee = await getNetworkBaseFee();
    return {
      sourceKeypair: this.sourceKeypair,
      networkPassphrase: getNetworkPassphrase(
        (process.env.STELLAR_NETWORK as 'public' | 'testnet') || 'testnet',
      ),
      baseFee: baseFee,
      timeout: 300,
    };
  }
}

/**
 * Payment operation helper
 */
export class PaymentHelper {
  private sourceKeypair: Keypair;

  constructor(sourceKeypair: Keypair) {
    this.sourceKeypair = sourceKeypair;
  }

  /**
   * Send a single payment
   */
  async send(
    destination: string,
    asset: string,
    amount: string,
    memo?: string,
  ): Promise<ExecutionResult> {
    const config = await this.buildConfig(memo);
    return createTransactionBuilder(config)
      .addPayment(destination, asset, amount)
      .execute();
  }

  /**
   * Send multiple payments in a single transaction
   */
  async sendBatch(
    payments: Array<{ destination: string; asset: string; amount: string }>,
    memo?: string,
  ): Promise<ExecutionResult> {
    const config = await this.buildConfig(memo);
    const builder = createTransactionBuilder(config);

    for (const payment of payments) {
      builder.addPayment(payment.destination, payment.asset, payment.amount);
    }

    return builder.execute();
  }

  /**
   * Get transaction configuration with current network settings
   */
  private async buildConfig(memo?: string): Promise<TransactionConfig> {
    const baseFee = await getNetworkBaseFee();
    return {
      sourceKeypair: this.sourceKeypair,
      networkPassphrase: getNetworkPassphrase(
        (process.env.STELLAR_NETWORK as 'public' | 'testnet') || 'testnet',
      ),
      baseFee: baseFee,
      timeout: 300,
      memo,
    };
  }
}

/**
 * Account setup helper for new accounts
 */
export class AccountSetupHelper {
  private sourceKeypair: Keypair;

  constructor(sourceKeypair: Keypair) {
    this.sourceKeypair = sourceKeypair;
  }

  /**
   * Create a new account with initial balance and trustlines
   */
  async createAccount(
    destination: string,
    startingBalance: string,
    assets: string[] = [],
  ): Promise<ExecutionResult> {
    const config = await this.buildConfig();
    const builder = createTransactionBuilder(config);

    // Create the account
    builder.addCreateAccount(destination, startingBalance);

    // Add trustlines for assets
    for (const asset of assets) {
      if (asset !== 'XLM') {
        // XLM doesn't need trustline
        builder.addTrustline(asset);
      }
    }

    return builder.execute();
  }

  /**
   * Add trustlines to an existing account
   */
  async addTrustlines(assets: string[]): Promise<ExecutionResult> {
    const config = await this.buildConfig();
    const builder = createTransactionBuilder(config);

    for (const asset of assets) {
      if (asset !== 'XLM') {
        builder.addTrustline(asset);
      }
    }

    return builder.execute();
  }

  /**
   * Get transaction configuration with current network settings
   */
  private async buildConfig(): Promise<TransactionConfig> {
    const baseFee = await getNetworkBaseFee();
    return {
      sourceKeypair: this.sourceKeypair,
      networkPassphrase: getNetworkPassphrase(
        (process.env.STELLAR_NETWORK as 'public' | 'testnet') || 'testnet',
      ),
      baseFee: baseFee,
      timeout: 300,
    };
  }
}

/**
 * Complex transaction builder for multi-step operations
 */
export class ComplexTransactionHelper {
  private sourceKeypair: Keypair;
  private steps: Array<{
    type: 'payment' | 'trustline' | 'contract' | 'createAccount';
    data: any;
  }> = [];

  constructor(sourceKeypair: Keypair) {
    this.sourceKeypair = sourceKeypair;
  }

  /**
   * Add a payment step
   */
  addPayment(destination: string, asset: string, amount: string): this {
    this.steps.push({
      type: 'payment',
      data: { destination, asset, amount },
    });
    return this;
  }

  /**
   * Add a trustline step
   */
  addTrustline(asset: string): this {
    this.steps.push({
      type: 'trustline',
      data: { asset },
    });
    return this;
  }

  /**
   * Add a contract invocation step
   */
  addContractInvocation(contractAddress: string, method: string, args: xdr.ScVal[]): this {
    this.steps.push({
      type: 'contract',
      data: { contractAddress, method, args },
    });
    return this;
  }

  /**
   * Add an account creation step
   */
  addAccountCreation(destination: string, startingBalance: string): this {
    this.steps.push({
      type: 'createAccount',
      data: { destination, startingBalance },
    });
    return this;
  }

  /**
   * Execute the complex transaction
   */
  async execute(memo?: string): Promise<ExecutionResult> {
    const config = await this.buildConfig(memo);
    const builder = createTransactionBuilder(config);

    for (const step of this.steps) {
      switch (step.type) {
        case 'payment':
          builder.addPayment(step.data.destination, step.data.asset, step.data.amount);
          break;
        case 'trustline':
          builder.addTrustline(step.data.asset);
          break;
        case 'contract':
          builder.addContractInvocation(step.data.contractAddress, step.data.method, step.data.args);
          break;
        case 'createAccount':
          builder.addCreateAccount(step.data.destination, step.data.startingBalance);
          break;
      }
    }

    return builder.execute();
  }

  /**
   * Dry-run the transaction
   */
  async dryRun(memo?: string) {
    const config = await this.buildConfig(memo);
    const builder = createTransactionBuilder(config);

    for (const step of this.steps) {
      switch (step.type) {
        case 'payment':
          builder.addPayment(step.data.destination, step.data.asset, step.data.amount);
          break;
        case 'trustline':
          builder.addTrustline(step.data.asset);
          break;
        case 'contract':
          builder.addContractInvocation(step.data.contractAddress, step.data.method, step.data.args);
          break;
        case 'createAccount':
          builder.addCreateAccount(step.data.destination, step.data.startingBalance);
          break;
      }
    }

    return builder.dryRun();
  }

  /**
   * Get transaction configuration with current network settings
   */
  private async buildConfig(memo?: string): Promise<TransactionConfig> {
    const baseFee = await getNetworkBaseFee();
    return {
      sourceKeypair: this.sourceKeypair,
      networkPassphrase: getNetworkPassphrase(
        (process.env.STELLAR_NETWORK as 'public' | 'testnet') || 'testnet',
      ),
      baseFee: baseFee,
      timeout: 300,
      memo,
    };
  }

  /**
   * Get step count
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Clear all steps
   */
  clear(): this {
    this.steps = [];
    return this;
  }
}

/**
 * Validation utility for transaction operations
 */
export class TransactionValidator {
  /**
   * Validate a Stellar address
   */
  static isValidAddress(address: string): boolean {
    return /^[GC][A-Z2-7]{55}$/.test(address) || /^T[A-Z0-9]{56}$/.test(address);
  }

  /**
   * Validate an amount
   */
  static isValidAmount(amount: string): boolean {
    try {
      const num = parseFloat(amount);
      return !isNaN(num) && num > 0 && /^\d+(\.\d{1,7})?$/.test(amount);
    } catch {
      return false;
    }
  }

  /**
   * Validate an asset code
   */
  static isValidAssetCode(code: string): boolean {
    return /^[A-Z]{1,12}$/.test(code) || code === 'XLM';
  }

  /**
   * Validate a contract address
   */
  static isValidContractAddress(address: string): boolean {
    return /^C[A-Z2-7]{55}$/.test(address);
  }

  /**
   * Validate a method name
   */
  static isValidMethodName(name: string): boolean {
    return /^[a-zA-Z0-9_]+$/.test(name) && name.length > 0;
  }

  /**
   * Validate all fields for a payment operation
   */
  static validatePayment(
    destination: string,
    asset: string,
    amount: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.isValidAddress(destination)) {
      errors.push('Invalid destination address');
    }

    if (!this.isValidAssetCode(asset)) {
      errors.push('Invalid asset code');
    }

    if (!this.isValidAmount(amount)) {
      errors.push('Invalid amount');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate all fields for a contract invocation
   */
  static validateContractInvocation(
    contractAddress: string,
    method: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.isValidContractAddress(contractAddress)) {
      errors.push('Invalid contract address');
    }

    if (!this.isValidMethodName(method)) {
      errors.push('Invalid method name');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Retry helper for transaction execution
 */
export class TransactionRetry {
  /**
   * Retry transaction execution with exponential backoff
   */
  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;

        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt);
          console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Retry with custom condition
   */
  static async retryIf<T>(
    fn: () => Promise<T>,
    shouldRetry: (result: T | Error) => boolean,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();

        if (!shouldRetry(result)) {
          return result;
        }

        lastError = new Error('Retry condition met');
      } catch (err) {
        lastError = err as Error;
      }

      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}

export default {
  ScValBuilder,
  ContractOperations,
  PaymentHelper,
  AccountSetupHelper,
  ComplexTransactionHelper,
  TransactionValidator,
  TransactionRetry,
};
