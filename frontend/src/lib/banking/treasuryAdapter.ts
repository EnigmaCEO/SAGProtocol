import { ethers } from 'ethers';

import { CONTRACT_ADDRESSES } from '../addresses';
import TreasuryAbi from '../abis/Treasury.json';
import { RPC_URL } from '../network';
import type { TermPositionRow } from './repository';

const BANK_ORIGIN_TYPE = 2;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function normalizeAbi(abiModule: any): any[] {
  const mod = abiModule?.default ?? abiModule;
  if (Array.isArray(mod)) return mod;
  if (Array.isArray(mod?.abi)) return mod.abi;
  return [];
}

function treasuryAddress(): string {
  const address = env('BANKING_TREASURY_ADDRESS') || (CONTRACT_ADDRESSES as any)?.Treasury;
  if (!address) throw new Error('BANKING_TREASURY_ADDRESS is required.');
  return address;
}

function hasUsableTreasuryConfig(): boolean {
  const address = env('BANKING_TREASURY_ADDRESS') || (CONTRACT_ADDRESSES as any)?.Treasury;
  const pk = env('BANKING_TREASURY_PRIVATE_KEY') || env('BANKING_OPERATOR_PRIVATE_KEY') || env('PRIVATE_KEY');
  return Boolean(address && ethers.isAddress(address) && pk);
}

function treasuryMode(): 'onchain' | 'simulated' {
  const configured = env('BANKING_TREASURY_MODE')?.toLowerCase();
  if (configured === 'onchain') return 'onchain';
  if (configured === 'simulated' || configured === 'local') return 'simulated';
  return hasUsableTreasuryConfig() ? 'onchain' : 'simulated';
}

function writer() {
  const pk = env('BANKING_TREASURY_PRIVATE_KEY') || env('BANKING_OPERATOR_PRIVATE_KEY') || env('PRIVATE_KEY');
  if (!pk) throw new Error('BANKING_TREASURY_PRIVATE_KEY or operator key is required.');
  const provider = new ethers.JsonRpcProvider(env('BANKING_RPC_URL') || RPC_URL);
  return new ethers.Contract(treasuryAddress(), normalizeAbi(TreasuryAbi), new ethers.Wallet(pk, provider));
}

function reader() {
  const provider = new ethers.JsonRpcProvider(env('BANKING_RPC_URL') || RPC_URL);
  return new ethers.Contract(treasuryAddress(), normalizeAbi(TreasuryAbi), provider);
}

function usd6(amount: string | number): bigint {
  return BigInt(Math.round(Number(amount) * 1_000_000));
}

function seconds(date: string): bigint {
  return BigInt(Math.floor(Date.parse(date) / 1000));
}

export class TreasuryAdapter {
  async registerBankOriginLot(term: TermPositionRow): Promise<{ lotId: string; txHash: string }> {
    if (treasuryMode() === 'simulated') {
      const digest = ethers.id(`bank-origin-lot:${term.id}:${term.amount_usd}:${term.term_maturity_at}`);
      const lotId = (BigInt(digest) % 1_000_000_000_000n).toString();
      return { lotId, txHash: digest };
    }

    const treasury = writer();
    const originRefId = ethers.id(term.id);
    const amount = usd6(term.amount_usd);
    const liabilityUnlockAt = seconds(term.term_maturity_at);
    const lotId = await treasury.registerBankOriginLot.staticCall(originRefId, amount, liabilityUnlockAt);
    const tx = await treasury.registerBankOriginLot(originRefId, amount, liabilityUnlockAt);
    const receipt = await tx.wait();
    return { lotId: lotId.toString(), txHash: receipt?.hash || tx.hash };
  }

  async createBankBatch(terms: TermPositionRow[], expectedReturnAt: string, settlementDeadlineAt: string): Promise<{ batchId: string; txHash: string }> {
    if (treasuryMode() === 'simulated') {
      const seed = terms.map((term) => term.treasury_origin_lot_id || term.id).join(':');
      const digest = ethers.id(`bank-batch:${seed}:${expectedReturnAt}:${settlementDeadlineAt}`);
      const batchId = (BigInt(digest) % 1_000_000_000_000n).toString();
      return { batchId, txHash: digest };
    }

    const treasury = writer();
    const lotIds = terms.map((term) => BigInt(term.treasury_origin_lot_id!));
    const expected = seconds(expectedReturnAt);
    const deadline = seconds(settlementDeadlineAt);
    const batchId = await treasury.createAndFundBatch.staticCall(BANK_ORIGIN_TYPE, lotIds, expected, deadline);
    const tx = await treasury.createAndFundBatch(BANK_ORIGIN_TYPE, lotIds, expected, deadline);
    const receipt = await tx.wait();
    return { batchId: batchId.toString(), txHash: receipt?.hash || tx.hash };
  }

  async getTreasuryBatch(batchId: string) {
    if (treasuryMode() === 'simulated') {
      return {
        id: batchId,
        status: 2,
        expectedReturnAt: 0,
        settlementDeadlineAt: 0,
        actualReturnedAt: 0,
      };
    }
    return reader().getTreasuryBatch(BigInt(batchId));
  }
}
