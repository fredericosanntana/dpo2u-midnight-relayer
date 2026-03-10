# DPO2U Midnight Relayer

> This project is built on the Midnight Network.

**Privacy-preserving compliance bridge: Midnight Network → EVM chains**

The DPO2U Midnight Relayer bridges zero-knowledge compliance attestations from the [Midnight Network](https://midnight.network/) to EVM-compatible chains. Any DeFi protocol can verify compliance on-chain by calling `getAttestation()` — without accessing the private data stored on Midnight.

## Supported Chains

| Chain | Status |
|---|---|
| Base Sepolia | Live |
| Polkadot Hub | Live |
| Hedera Testnet | Planned |

---

## How It Works

```
Midnight Network (ZK Layer)
  ComplianceRegistry.compact
    registerAttestation() → stores compliance score with ZK privacy
         │
         │  GraphQL WebSocket subscription
         │  Midnight Indexer v3
         ▼
DPO2U Relayer (this project)
  1. MidnightListener     subscribes to new attestation events
  2. StateParser           decodes Compact ledger state (4 fallback decoders)
  3. EVMBroadcaster        writes attestations to EVM chains in parallel
         │
         ├──► Base Sepolia    → ComplianceRegistryExtended.sol
         ├──► Polkadot Hub    → ComplianceRegistryExtended.sol
         └──► Hedera Testnet  → ComplianceRegistryExtended.sol
```

---

## Integration Guide

### For DeFi protocols: query compliance on EVM

Once attestations are relayed, any smart contract can check compliance:

```solidity
import {ComplianceRegistryExtended} from "./ComplianceRegistryExtended.sol";

// Query an attestation by ID
ComplianceRegistryExtended registry = ComplianceRegistryExtended(REGISTRY_ADDRESS);
ComplianceRegistryExtended.Attestation memory att = registry.getAttestation(attestationId);

// Check compliance
require(att.exists, "No attestation found");
require(att.score >= 80, "Below compliance threshold");
require(att.validUntil > block.timestamp, "Attestation expired");
```

### Attestation struct on EVM

```solidity
struct Attestation {
    bytes32 orgHash;        // Hash of org identifier (e.g. CNPJ)
    string  regulation;     // "LGPD" | "GDPR" | "MiCA"
    uint256 score;          // 0–100
    uint256 validUntil;     // Unix timestamp
    bytes32 agentDid;       // DID of the auditor agent
    string  evidenceCid;    // IPFS CID of evidence document
    bytes32 commitment;     // ZK commitment from Midnight (proof without revealing)
    string  source;         // "midnight"
    uint256 timestamp;      // Relay timestamp
    bool    exists;
}
```

---

## Compact Ledger Structure

The relayer reads from the `ComplianceRegistry.compact` contract on Midnight:

```compact
export ledger attestation_scores: Map<Bytes<32>, Uint<64>>;
export ledger attestation_dids:   Map<Bytes<32>, Bytes<32>>;
export ledger attestation_cids:   Map<Bytes<32>, Bytes<32>>;
export ledger attestation_score:  Uint<64>;

export circuit registerAttestation(
  company_id: Bytes<32>,
  agent_did:  Bytes<32>,
  policy_cid: Bytes<32>,
  score:      Uint<64>
): []
```

The `StateParser` decodes the binary ledger state using `@midnight-ntwrk/compact-runtime@0.14.0`, with 3 additional fallback decoders (JSON → base64 → hex).

---

## Trust Model

| Phase | Model | Description |
|---|---|---|
| **Phase 1** (current) | Trusted Relayer | A Node.js process signs EVM transactions with a controlled private key. EVM contracts only accept calls from the configured `trustedRelayer` address. |
| **Phase 2** (post-mainnet) | Decentralized | Gnosis Safe multisig → MPC threshold signatures → native ZK proof verification on EVM. |

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Midnight wallet** with tDUST (for Preprod)
- **EVM wallet** with testnet funds on target chains
- Access to a **Midnight Indexer v3** endpoint

## Installation

```bash
git clone https://github.com/fredericosanntana/dpo2u-midnight-relayer.git
cd dpo2u-midnight-relayer
npm install
cp .env.example .env
```

Edit `.env` with your configuration (see below).

## Usage

```bash
npm run start:watch   # Development with hot reload
npm start             # Production
npm test              # Run tests (7/7 passing)
```

## Environment Variables

| Variable | Description |
|---|---|
| `MIDNIGHT_INDEXER_WS` | Midnight Indexer v3 WebSocket endpoint |
| `COMPLIANCE_REGISTRY_ADDRESS` | Compact contract address on Midnight |
| `ATTESTATION_ENTRY_POINT` | Circuit entry point name (`registerAttestation`) |
| `RELAYER_PRIVATE_KEY` | EVM relayer private key |
| `BASE_REGISTRY_ADDRESS` | ComplianceRegistryExtended address on Base Sepolia |
| `POLKADOT_REGISTRY_ADDRESS` | ComplianceRegistryExtended address on Polkadot Hub |
| `HEDERA_REGISTRY_ADDRESS` | ComplianceRegistryExtended address on Hedera Testnet |
| `BASE_RPC_URL` | Base Sepolia RPC endpoint |
| `POLKADOT_RPC_URL` | Polkadot Hub Testnet RPC endpoint |
| `HEDERA_RPC_URL` | Hedera JSON-RPC Relay endpoint |

---

## Project Structure

```
dpo2u-midnight-relayer/
├── src/
│   ├── index.ts                 # Entry point
│   ├── midnight-listener.ts     # GraphQL WebSocket subscription (Indexer v3)
│   ├── state-parser.ts          # Ledger state parser with 4 fallback paths
│   ├── state-parser-runtime.ts  # Decoder via @midnight-ntwrk/compact-runtime
│   ├── evm-broadcaster.ts       # Parallel broadcast to EVM chains
│   ├── config.ts                # Environment configuration
│   └── types.ts                 # Shared TypeScript types
├── contracts/
│   └── ComplianceRegistryExtended.sol  # EVM contract for relayed attestations
├── test/
│   └── state-parser.test.ts     # Unit tests
├── .env.example
├── package.json
└── tsconfig.json
```

## Roadmap

- [x] GraphQL WebSocket subscription to Midnight Indexer v3
- [x] State decoder via `@midnight-ntwrk/compact-runtime` with fallback paths
- [x] Parallel broadcast to Base Sepolia and Polkadot Hub
- [x] Per-block idempotency (replay protection)
- [x] Automatic WebSocket reconnect
- [x] Unit tests (7/7 passing)
- [ ] Integration tests against live Indexer v3
- [ ] Hedera Testnet as destination chain
- [ ] Extended Compact ledger fields (`regulation`, `valid_until`)
- [ ] Multisig as `trustedRelayer`
- [ ] Decentralized bridge with threshold signatures

## Contributing

Contributions are welcome! Please:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a Pull Request

## License

MIT
