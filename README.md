# DPO2U Relayer

> This project is built on the Midnight Network.

**Midnight Network → EVM compliance attestation bridge (Base, Polkadot, Hedera)**

The DPO2U Relayer is the first custom bridge that reads ZK-private compliance attestations from the Midnight Network and propagates them to EVM chains. Any DeFi protocol can call `isCompliant(address)` on Base, Polkadot Hub, or Hedera — without ever touching the private data stored on Midnight.

---

## How it works

```
MIDNIGHT PREPROD / MAINNET
  ComplianceRegistry.compact
    registerAttestation() called by the AuditorAgent (AI compliance agent)
         │
         │  GraphQL WebSocket subscription
         │  Midnight Indexer v3 — ContractCall events
         ▼
DPO2U RELAYER (Node.js)
  1. MidnightListener     subscribes to ContractCall events via GraphQL WS
  2. StateParser          decodes public ledger state using @midnight-ntwrk/compact-runtime
  3. EVMBroadcaster       writes registerAttestationFromMidnight() in parallel
         │
         ├──► Base Sepolia    → ComplianceRegistryExtended.sol  ✅
         ├──► Polkadot Hub    → ComplianceRegistryExtended.sol  ✅
         └──► Hedera Testnet  → ComplianceRegistryExtended.sol  (sprint 23/03)
```

---

## Compact Ledger Structure

Parser built and calibrated against the real `ComplianceRegistry.compact`:

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

---

## State Decoder

`src/state-parser-runtime.ts` uses `@midnight-ntwrk/compact-runtime@0.14.0` to decode the binary ledger state returned by the Midnight Indexer v3:

```typescript
// Primary path: compact-runtime decoder
const parsed = decodeLedgerState(stateHex);
// StateValue.decode(bytes) → navigates the typed ledger Map
// StateMap.get(AlignedValue) → fetches field by key
// AlignedValue = { value: Array<Uint8Array>, alignment: Alignment[] }
```

4 fallback paths in cascade: compact-runtime → JSON → base64 → hex.

---

## Trust Model

**Phase 1 (current):** Trusted Relayer. A Node.js process operated by DPO2U signs EVM transactions with a controlled private key. EVM contracts only accept attestations from the configured `trustedRelayer` address.

**Phase 2 (post-mainnet):** Decentralized bridge via Gnosis Safe multisig → MPC threshold signatures → native ZK proof verification on EVM.

---

## Installation

```bash
npm install
cp .env.example .env
# Edit .env with contract addresses and relayer private key
```

## Usage

```bash
npm run start:watch   # development with hot reload
npm start             # production
npm test              # 7/7 tests
```

## Environment Variables

| Variable | Description |
|---|---|
| `MIDNIGHT_INDEXER_WS` | Midnight Indexer v3 WebSocket endpoint |
| `COMPLIANCE_REGISTRY_ADDRESS` | Compact contract address on Midnight |
| `ATTESTATION_ENTRY_POINT` | Circuit entry point name (`registerAttestation`) |
| `RELAYER_PRIVATE_KEY` | EVM relayer private key |
| `BASE_REGISTRY_ADDRESS` | ComplianceRegistryExtended on Base Sepolia |
| `POLKADOT_REGISTRY_ADDRESS` | ComplianceRegistryExtended on Polkadot Hub |
| `HEDERA_REGISTRY_ADDRESS` | ComplianceRegistryExtended on Hedera Testnet |
| `BASE_RPC_URL` | Base Sepolia RPC |
| `POLKADOT_RPC_URL` | Polkadot Hub Testnet RPC |
| `HEDERA_RPC_URL` | Hedera JSON-RPC Relay (`https://testnet.hashio.io/api`) |

## Repository Structure

```
dpo2u-relayer/
├── src/
│   ├── index.ts                 # Entry point
│   ├── midnight-listener.ts     # GraphQL WebSocket (Indexer v3)
│   ├── state-parser.ts          # Parser with 4 fallback paths
│   ├── state-parser-runtime.ts  # Decoder via @midnight-ntwrk/compact-runtime
│   ├── evm-broadcaster.ts       # Parallel broadcast via ethers.js
│   ├── config.ts                # .env configuration
│   └── types.ts                 # Shared types
├── contracts/
│   └── ComplianceRegistryExtended.sol
├── test/
│   └── state-parser.test.ts     # 7/7 tests
└── .env.example
```

## Adding Hedera (sprint 23/03)

Hedera Testnet is EVM-compatible via JSON-RPC Relay. Three changes required:

**1. `config.ts`:**
```typescript
hedera: {
  rpcUrl:          process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api',
  registryAddress: process.env.HEDERA_REGISTRY_ADDRESS ?? '',
  chainId:         296,
}
```

**2. `evm-broadcaster.ts`:** add `'hedera'` to the chains array.

**3. Deploy:**
```bash
npx hardhat run scripts/deploy.ts --network hederaTestnet
```

## Roadmap

- [x] GraphQL WebSocket subscription to Midnight Indexer v3
- [x] State decoder via `@midnight-ntwrk/compact-runtime` with 4 fallbacks
- [x] Parallel broadcast to Base Sepolia and Polkadot Hub
- [x] Per-block idempotency (replay protection)
- [x] Automatic WebSocket reconnect
- [x] 7/7 unit tests
- [ ] Integration test against live Indexer v3 (Gap 2)
- [ ] Hedera Testnet as destination chain (23/03)
- [ ] `regulation` and `valid_until` fields in Compact ledger (Gap 3)
- [ ] Multisig as `trustedRelayer` (Gap 1 — before production)
- [ ] Decentralized bridge with threshold signatures (post-mainnet)

## License

MIT
