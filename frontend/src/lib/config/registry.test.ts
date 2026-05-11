import assert from 'node:assert/strict';
import {
  DEFAULT_CHAIN_KEY,
  getChainById,
  getChainByKey,
  getDefaultChain,
  getSupportedChains,
} from './chains';
import { getDeploymentAddress, getDeploymentByChainId, getDeploymentByChainKey, hasConfiguredProtocolDao } from './deployments';
import { isFeatureEnabledForChain } from './features';

assert.equal(DEFAULT_CHAIN_KEY, 'moonbase');
assert.equal(getDefaultChain().chainId, 1287);
assert.equal(getSupportedChains()[0].key, 'moonbase');
assert.equal(getChainById(1287)?.key, 'moonbase');
assert.equal(getChainByKey('localhost')?.chainId, 1337);
assert.equal(getChainById(5042002)?.key, 'arc');

const moonbase = getDeploymentByChainKey('moonbase');
assert.equal(moonbase.chainId, 1287);
assert.match(getDeploymentAddress('ProtocolDAO', 'moonbase') || '', /^0x[a-fA-F0-9]{40}$/);

const localhost = getDeploymentByChainId(1337);
assert.equal(localhost.chainKey, 'localhost');
assert.match(getDeploymentAddress('Vault', 'localhost') || '', /^0x[a-fA-F0-9]{40}$/);

assert.equal(isFeatureEnabledForChain('deposits', 'moonbase'), true);
assert.equal(isFeatureEnabledForChain('timeTravel', 'moonbase'), false);
assert.equal(isFeatureEnabledForChain('timeTravel', 'localhost'), true);
assert.equal(isFeatureEnabledForChain('deposits', 'arc'), false);
assert.equal(isFeatureEnabledForChain('deposits', 'base-sepolia'), false);
assert.equal(hasConfiguredProtocolDao('moonbase'), true);
assert.equal(hasConfiguredProtocolDao('localhost'), true);
assert.equal(hasConfiguredProtocolDao('arc'), true);
assert.equal(hasConfiguredProtocolDao('base-sepolia'), false);
