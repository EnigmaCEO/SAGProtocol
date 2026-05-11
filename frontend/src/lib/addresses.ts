import { getActiveDeployment } from './config/deployments';

export const CONTRACT_ADDRESSES: Record<string, any> = new Proxy({}, {
  get(_target, prop: string) {
    const deployment = getActiveDeployment();
    if (prop === 'network') return deployment.network;
    if (prop === 'chainId') return deployment.chainId;
    return (deployment.contracts as Record<string, any>)[prop];
  },
  ownKeys() {
    const deployment = getActiveDeployment();
    return ['network', 'chainId', ...Object.keys(deployment.contracts)];
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});
