import { ethers } from "hardhat";

// Utility functions for deployment and testing scripts
export const toWei = (value: string | number) => ethers.utils.parseEther(value.toString());
export const fromWei = (value: string | number) => ethers.utils.formatEther(value.toString());
