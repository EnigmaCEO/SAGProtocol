import { ethers } from 'ethers';

export async function isContractDeployed(
  address: string,
  provider: ethers.Provider
): Promise<boolean> {
  try {
    const code = await provider.getCode(address);
    return code !== '0x';
  } catch (error) {
    console.error('Error checking contract deployment:', error);
    return false;
  }
}
