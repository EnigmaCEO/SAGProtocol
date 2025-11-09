import { parseEther, formatEther } from "ethers";

// Helper functions for tests
export const toWei = (value: string | number) => parseEther(value.toString());
export const fromWei = (value: string | number) => formatEther(value.toString());
