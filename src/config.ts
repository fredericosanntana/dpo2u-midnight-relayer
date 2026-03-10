// src/config.ts
import 'dotenv/config';
import type { EVMChainConfig } from './types.js';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

export const config = {
  midnight: {
    indexerWs: process.env.MIDNIGHT_INDEXER_WS
      ?? 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    complianceRegistryAddress: requireEnv('COMPLIANCE_REGISTRY_ADDRESS'),
    // Ponto de entrada do Compact que registra attestations
    attestationEntryPoint: process.env.ATTESTATION_ENTRY_POINT
      ?? 'registerAttestation',
  },

  relayer: {
    privateKey: requireEnv('RELAYER_PRIVATE_KEY'),
    // Intervalo de reconexão em ms se o WebSocket cair
    reconnectIntervalMs: parseInt(process.env.RECONNECT_INTERVAL_MS ?? '5000'),
    // Bloco inicial para começar a ouvir (0 = desde o início)
    startFromBlock: parseInt(process.env.START_FROM_BLOCK ?? '0'),
  },

  chains: [
    {
      name: 'base-sepolia',
      rpc: process.env.BASE_RPC ?? 'https://sepolia.base.org',
      registryAddress: requireEnv('BASE_REGISTRY_ADDRESS'),
      chainId: 84532,
    },
    {
      name: 'polkadot-hub-westend',
      rpc: process.env.POLKADOT_RPC
        ?? 'https://westend-asset-hub-eth-rpc.polkadot.io',
      registryAddress: requireEnv('POLKADOT_REGISTRY_ADDRESS'),
      chainId: 420420421,
    },
    {
      name: 'hedera-testnet',
      rpc: process.env.HEDERA_RPC ?? 'https://testnet.hashio.io/api',
      registryAddress: requireEnv('HEDERA_REGISTRY_ADDRESS'),
      chainId: 296,
    },
  ] as EVMChainConfig[],
};
