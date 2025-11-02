import { ethers } from "hardhat";

// Helper functions for tests
export const toWei = (value: string | number) => ethers.utils.parseEther(value.toString());
export const fromWei = (value: string | number) => ethers.utils.formatEther(value.toString());
