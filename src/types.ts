// src/types.ts
// Estrutura de uma attestation extraída do Midnight ComplianceRegistry

export interface MidnightAttestation {
  // ID único da attestation (hash de 32 bytes, hex-encoded)
  attestationId: string;

  // Hash do CNPJ/org identifier — privado no Midnight, revelado pelo agente
  orgHash: string;

  // Framework regulatório: "LGPD" | "GDPR" | "MiCA" etc.
  regulation: string;

  // Score de compliance (0-100)
  score: number;

  // DID do agente que registrou (Bytes<32> no Compact)
  agentDid: string;

  // CID do documento de evidência no IPFS
  evidenceCid: string;

  // Timestamp do bloco Midnight
  validUntil: bigint;

  // Commitment ZK (hash do estado privado — o que prova sem revelar)
  commitment: string;

  // Metadados do bloco Midnight
  blockHeight: number;
  txHash: string;
}

// Estado retornado pelo ContractCall do Indexer GraphQL
export interface MidnightContractAction {
  __typename: 'ContractCall' | 'ContractDeploy' | 'ContractUpdate';
  address: string;
  state: string;        // hex-encoded estado público do ledger
  entryPoint?: string;  // ex: "register_attestation"
  zswapState?: string;
  unshieldedBalances?: Array<{ tokenType: string; amount: string }>;
}

// Resultado de um broadcast para uma chain EVM
export interface BroadcastResult {
  chain: string;
  txHash: string;
  blockNumber: number;
  success: boolean;
  error?: string;
}

// Configuração de uma chain EVM destino
export interface EVMChainConfig {
  name: string;
  rpc: string;
  registryAddress: string;
  chainId: number;
}
