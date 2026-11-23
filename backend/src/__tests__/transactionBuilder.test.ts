/**
 * Transaction Builder Tests
 * 
 * Comprehensive test suite for advanced transaction building functionality
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  createTransactionBuilder,
  TransactionBuilderAdvanced,
  getNetworkPassphrase,
  OperationConfig,
  TransactionConfig,
} from '../utils/transactionBuilder';
import { Keypair, Networks, xdr } from '@stellar/stellar-sdk';

// Mock environment variables
process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
process.env.STELLAR_NETWORK = 'testnet';

describe('TransactionBuilder', () => {
  let config: TransactionConfig;
  let sourceKeypair: Keypair;

  beforeEach(() => {
    sourceKeypair = Keypair.random();
    config = {
      sourceKeypair,
      networkPassphrase: Networks.TESTNET,
      baseFee: 100,
      timeout: 300,
      memo: 'Test transaction',
    };
  });

  describe('Initialization', () => {
    it('should create a transaction builder instance', () => {
      const builder = createTransactionBuilder(config);
      expect(builder).toBeInstanceOf(TransactionBuilderAdvanced);
    });

    it('should throw error without STELLAR_RPC_URL', () => {
      const oldUrl = process.env.STELLAR_RPC_URL;
      delete process.env.STELLAR_RPC_URL;

      expect(() => createTransactionBuilder(config)).toThrow(
        'STELLAR_RPC_URL environment variable is required',
      );

      process.env.STELLAR_RPC_URL = oldUrl;
    });
  });

  describe('Operation Addition', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should add contract invocation operation', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      const method = 'test_method';
      const args: xdr.ScVal[] = [];

      builder.addContractInvocation(contractAddress, method, args);

      expect(builder.getOperationCount()).toBe(1);
      const operations = builder.getOperations();
      expect(operations[0].config.type).toBe('invokeContract');
      expect(operations[0].config.contractAddress).toBe(contractAddress);
      expect(operations[0].config.method).toBe(method);
    });

    it('should add payment operation', () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      const asset = 'USD';
      const amount = '100.0000000';

      builder.addPayment(destination, asset, amount);

      expect(builder.getOperationCount()).toBe(1);
      const operations = builder.getOperations();
      expect(operations[0].config.type).toBe('payment');
      expect(operations[0].config.destination).toBe(destination);
      expect(operations[0].config.asset).toBe(asset);
      expect(operations[0].config.amount).toBe(amount);
    });

    it('should add trustline operation', () => {
      const asset = 'USD';

      builder.addTrustline(asset);

      expect(builder.getOperationCount()).toBe(1);
      const operations = builder.getOperations();
      expect(operations[0].config.type).toBe('trustline');
      expect(operations[0].config.asset).toBe(asset);
    });

    it('should add create account operation', () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      const startingBalance = '10.0000000';

      builder.addCreateAccount(destination, startingBalance);

      expect(builder.getOperationCount()).toBe(1);
      const operations = builder.getOperations();
      expect(operations[0].config.type).toBe('accountCreation');
      expect(operations[0].config.destination).toBe(destination);
      expect(operations[0].config.amount).toBe(startingBalance);
    });

    it('should support method chaining', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';

      const result = builder
        .addContractInvocation(contractAddress, 'method1', [])
        .addPayment(destination, 'USD', '100')
        .addTrustline('EUR');

      expect(result).toBe(builder);
      expect(builder.getOperationCount()).toBe(3);
    });
  });

  describe('Operation Validation', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should reject transaction with no operations', async () => {
      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('No operations added to transaction');
    });

    it('should validate contract invocation - valid', async () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      builder.addContractInvocation(contractAddress, 'test_method', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should validate contract invocation - missing contract address', async () => {
      builder.addContractInvocation('', 'test_method', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Contract address is required'))).toBe(true);
    });

    it('should validate contract invocation - invalid contract address', async () => {
      builder.addContractInvocation('INVALID_ADDRESS', 'test_method', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid contract address format'))).toBe(true);
    });

    it('should validate contract invocation - missing method', async () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      builder.addContractInvocation(contractAddress, '', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Method name is required'))).toBe(true);
    });

    it('should validate contract invocation - invalid method name', async () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      builder.addContractInvocation(contractAddress, 'invalid-method-name', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Method name contains invalid characters'))).toBe(true);
    });

    it('should validate payment - valid', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', '100.0000000');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should validate payment - invalid destination', async () => {
      builder.addPayment('INVALID', 'USD', '100.0000000');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid destination address'))).toBe(true);
    });

    it('should validate payment - invalid amount', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', 'INVALID');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid amount format'))).toBe(true);
    });

    it('should validate payment - invalid asset', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'TOOLONGASSET', '100.0000000');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid asset code format'))).toBe(true);
    });

    it('should validate trustline - valid', async () => {
      builder.addTrustline('EUR');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should validate trustline - invalid asset', async () => {
      builder.addTrustline('invalid');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid asset code format'))).toBe(true);
    });

    it('should validate create account - valid', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addCreateAccount(destination, '10.0000000');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should validate create account - invalid starting balance', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addCreateAccount(destination, '-10.0000000');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Invalid starting balance format'))).toBe(true);
    });
  });

  describe('Transaction Building', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should throw error when building with no source account', async () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      builder.addContractInvocation(contractAddress, 'test', []);

      // Note: This will fail with network error in test environment
      // In real usage, initializeSourceAccount must be called
      await expect(builder.build()).rejects.toThrow();
    });

    it('should throw error when building with invalid operations', async () => {
      builder.addPayment('INVALID', 'USD', '100');

      await expect(builder.build()).rejects.toThrow('Transaction validation failed');
    });
  });

  describe('Operation Management', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should maintain operation order', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';

      builder
        .addContractInvocation(contractAddress, 'method1', [])
        .addPayment(destination, 'USD', '100')
        .addTrustline('EUR')
        .addCreateAccount(Keypair.random().publicKey(), '10');

      const operations = builder.getOperations();
      expect(operations[0].order).toBe(0);
      expect(operations[1].order).toBe(1);
      expect(operations[2].order).toBe(2);
      expect(operations[3].order).toBe(3);
    });

    it('should clear all operations', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      builder.addContractInvocation(contractAddress, 'method', []);

      expect(builder.getOperationCount()).toBe(1);

      builder.clear();

      expect(builder.getOperationCount()).toBe(0);
    });

    it('should return validation errors map', async () => {
      builder
        .addPayment('INVALID1', 'USD', '100')
        .addPayment('INVALID2', 'EUR', '50');

      await builder.validateOperations();
      const errors = builder.getValidationErrors();

      expect(errors.size).toBe(2);
    });
  });

  describe('Helpers', () => {
    it('should return correct network passphrase for testnet', () => {
      expect(getNetworkPassphrase('testnet')).toBe(Networks.TESTNET);
    });

    it('should return correct network passphrase for public', () => {
      expect(getNetworkPassphrase('public')).toBe(Networks.PUBLIC);
    });

    it('should default to testnet', () => {
      expect(getNetworkPassphrase()).toBe(Networks.TESTNET);
    });
  });

  describe('Complex Scenarios', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should build multi-operation transaction with mixed operation types', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      const newAccount = Keypair.random().publicKey();

      builder
        .addTrustline('USD')
        .addPayment(destination, 'USD', '100')
        .addCreateAccount(newAccount, '10.0000000')
        .addContractInvocation(contractAddress, 'execute', []);

      expect(builder.getOperationCount()).toBe(4);

      const operations = builder.getOperations();
      expect(operations[0].config.type).toBe('trustline');
      expect(operations[1].config.type).toBe('payment');
      expect(operations[2].config.type).toBe('accountCreation');
      expect(operations[3].config.type).toBe('invokeContract');
    });

    it('should validate complex transaction', async () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF3C';
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      const newAccount = Keypair.random().publicKey();

      builder
        .addTrustline('USD')
        .addPayment(destination, 'USD', '100')
        .addCreateAccount(newAccount, '10.0000000')
        .addContractInvocation(contractAddress, 'execute', []);

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    let builder: TransactionBuilderAdvanced;

    beforeEach(() => {
      builder = createTransactionBuilder(config);
    });

    it('should handle very small amounts', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', '0.0000001');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should handle large amounts', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', '922337203685.4775807');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should reject zero amount', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', '0');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
    });

    it('should reject negative amount', async () => {
      const destination = 'GDZST3XVCDTUJ76ZAV2HA72KYPO4JYUWDZ4FVDSBUAANFX3ZX74J4GU';
      builder.addPayment(destination, 'USD', '-100');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(false);
    });

    it('should handle single-character asset code', async () => {
      builder.addTrustline('X');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });

    it('should handle 12-character asset code', async () => {
      builder.addTrustline('ABCDEFGHIJKL');

      const validation = await builder.validateOperations();
      expect(validation.valid).toBe(true);
    });
  });
});
