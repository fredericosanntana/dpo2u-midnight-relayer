# WalletFacade.waitForSyncedState() hangs indefinitely on Preprod (568k+ blocks)

## Problem

`WalletFacade.waitForSyncedState()` hangs indefinitely when syncing a wallet on Preprod. The wallet never reaches `isSynced=true`.

## Environment

- Node.js: v20.20.0
- @midnight-ntwrk/wallet-sdk-facade: ^1.0.0
- @midnight-ntwrk/wallet-sdk-hd: ^3.0.0
- @midnight-ntwrk/wallet-sdk-shielded: ^1.0.0
- @midnight-ntwrk/wallet-sdk-unshielded-wallet: ^1.0.0
- @midnight-ntwrk/wallet-sdk-dust-wallet: ^1.0.0
- @midnight-ntwrk/midnight-js-indexer-public-data-provider: ^3.1.0
- Proof Server: midnightntwrk/proof-server:7.0.0 (healthy, responds on /health)
- Preprod Indexer: block height ~568,399 at time of test
- OS: Ubuntu Linux (x86_64)

## What we tried

1. `wallet.waitForSyncedState()` — hangs after 10+ minutes, no state change
2. RxJS pattern (MeshJS approach):
   `wallet.state().pipe(Rx.filter(s => s.isSynced))` — emits exactly ONE event
   with `isSynced=false`, then stops emitting entirely
3. Added heartbeat logging — confirms process is alive but no sync progress
4. Verified network connectivity:
   - Indexer HTTP: responds OK (tested with GraphQL query)
   - RPC WebSocket: connects successfully (tested with ws client)
   - Proof Server: healthy on localhost:6300

## Configuration

```
MIDNIGHT_NETWORK_ID=preprod
INDEXER_HTTP_URL=https://indexer.preprod.midnight.network/api/v3/graphql
INDEXER_WS_URL=wss://indexer.preprod.midnight.network/api/v3/graphql/ws
NODE_URL=wss://rpc.preprod.midnight.network
PROOF_SERVER_URL=http://localhost:6300
```

Wallet created from 24-word BIP-39 mnemonic via Lace wallet.
Wallet has tNIGHT tokens (funded via faucet).
DUST address configured in Lace.

## Wallet init code (simplified)

```typescript
const hdWallet = HDWallet.fromSeed(mnemonicToSeedSync(mnemonic));
const keys = hdWallet.selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0).keys;

const wallet = new WalletFacade(shielded, unshielded, dust);
await wallet.start(shieldedSecretKeys, dustSecretKey);

// This never resolves:
await wallet.waitForSyncedState();
```

## Questions

1. Is there a known issue with wallet sync on Preprod at 568k+ blocks?
2. Should we use a different sync approach for CLI/server-side usage?
3. Is there a way to skip full chain sync and start from a recent block?
4. Are there specific Proof Server or Indexer versions required for Preprod?

## Repos

- https://github.com/fredericosanntana/dpo2u-midnight (ComplianceRegistry)
- https://github.com/fredericosanntana/dpo2u-midnight-relayer (cross-chain relay)
