// src/midnight-listener.ts
//
// Escuta eventos do ComplianceRegistry no Midnight via GraphQL subscription.
// Usa o Indexer v3 (wss) — documentado em docs.midnight.network/api-reference/midnight-indexer

import { createClient, type Client } from 'graphql-ws';
import WebSocket from 'ws';
import { config } from './config.js';
import { parseContractState } from './state-parser.js';
import type { MidnightAttestation, MidnightContractAction } from './types.js';

type AttestationHandler = (attestation: MidnightAttestation) => Promise<void>;

const SUBSCRIPTION_QUERY = `
  subscription ComplianceRegistryActions($address: String!, $fromBlock: Int) {
    contractActions(
      address: $address
      offset: { height: $fromBlock }
    ) {
      __typename
      ... on ContractCall {
        address
        state
        zswapState
        entryPoint
        unshieldedBalances {
          tokenType
          amount
        }
      }
      ... on ContractUpdate {
        address
        state
        zswapState
        unshieldedBalances {
          tokenType
          amount
        }
      }
    }
  }
`;

export class MidnightListener {
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private blockTracker = 0;

  constructor(private onAttestation: AttestationHandler) {}

  start(): void {
    this.isRunning = true;
    this.connect();
    console.log('[listener] Iniciando monitoramento do Midnight Indexer...');
    console.log(`[listener] Contract: ${config.midnight.complianceRegistryAddress}`);
    console.log(`[listener] Endpoint: ${config.midnight.indexerWs}`);
  }

  stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) this.client.dispose();
    console.log('[listener] Listener encerrado.');
  }

  private connect(): void {
    this.client = createClient({
      url: config.midnight.indexerWs,
      webSocketImpl: WebSocket,
      connectionParams: {
        // Midnight Indexer não requer auth no devnet/testnet
        // Para mainnet: adicionar token aqui
      },
      on: {
        connected: () => {
          console.log('[listener] Conectado ao Midnight Indexer ✅');
        },
        closed: () => {
          console.warn('[listener] Conexão fechada');
          this.scheduleReconnect();
        },
        error: (err) => {
          console.error('[listener] Erro WebSocket:', err);
          this.scheduleReconnect();
        },
      },
    });

    this.subscribe();
  }

  private subscribe(): void {
    if (!this.client) return;

    const unsubscribe = this.client.subscribe(
      {
        query: SUBSCRIPTION_QUERY,
        variables: {
          address: config.midnight.complianceRegistryAddress,
          fromBlock: config.relayer.startFromBlock,
        },
      },
      {
        next: async (data) => {
          const action = data?.data?.contractActions as MidnightContractAction;
          if (!action) return;

          await this.handleAction(action);
        },
        error: (err) => {
          console.error('[listener] Erro na subscription:', err);
        },
        complete: () => {
          console.log('[listener] Subscription encerrada pelo servidor');
          this.scheduleReconnect();
        },
      }
    );

    // Cleanup ao parar
    process.once('SIGTERM', unsubscribe);
    process.once('SIGINT', unsubscribe);
  }

  private async handleAction(action: MidnightContractAction): Promise<void> {
    console.log(`[listener] Evento recebido: ${action.__typename} | entryPoint: ${action.entryPoint ?? 'n/a'}`);

    // Filtra somente chamadas ao register_attestation
    const isAttestationCall =
      action.__typename === 'ContractCall' &&
      action.entryPoint === config.midnight.attestationEntryPoint;

    // ContractUpdate também pode indicar mudança de estado após attestation
    const isStateUpdate = action.__typename === 'ContractUpdate';

    if (!isAttestationCall && !isStateUpdate) {
      console.log('[listener] Evento ignorado (não é attestation)');
      return;
    }

    this.blockTracker++;
    const blockHeight = this.blockTracker; // TODO: extrair do evento quando disponível

    const attestation = parseContractState(action, blockHeight, 'pending');
    if (!attestation) {
      console.warn('[listener] Não foi possível parsear a attestation');
      return;
    }

    console.log(`[listener] Attestation detectada: ${attestation.attestationId}`);
    console.log(`  org_hash:   ${attestation.orgHash}`);
    console.log(`  regulation: ${attestation.regulation}`);
    console.log(`  score:      ${attestation.score}`);

    await this.onAttestation(attestation);
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectTimer) return;

    console.log(`[listener] Reconectando em ${config.relayer.reconnectIntervalMs}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, config.relayer.reconnectIntervalMs);
  }
}
