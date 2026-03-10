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

/** Decode HexEncoded string from Indexer to UTF-8 */
function hexToUtf8(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex').toString('utf-8').replace(/\0/g, '');
}

const SUBSCRIPTION_QUERY = `
  subscription ComplianceRegistryActions($address: HexEncoded!, $offset: BlockOffset) {
    contractActions(
      address: $address
      offset: $offset
    ) {
      __typename
      ... on ContractCall {
        address
        state
        entryPoint
      }
      ... on ContractDeploy {
        address
        state
      }
      ... on ContractUpdate {
        address
        state
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
          offset: config.relayer.startFromBlock > 0
            ? { height: config.relayer.startFromBlock }
            : undefined,
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
    // entryPoint comes as HexEncoded from Indexer — decode to UTF-8 for comparison
    const entryPointHex = action.entryPoint;
    const entryPointName = entryPointHex ? hexToUtf8(entryPointHex) : undefined;

    console.log(`[listener] Evento recebido: ${action.__typename} | entryPoint: ${entryPointName ?? 'n/a'} (hex: ${entryPointHex ?? 'n/a'})`);

    // Filtra somente chamadas ao registerAttestation
    const isAttestationCall =
      action.__typename === 'ContractCall' &&
      entryPointName === config.midnight.attestationEntryPoint;

    // ContractUpdate também pode indicar mudança de estado após attestation
    const isStateUpdate = action.__typename === 'ContractUpdate';

    if (!isAttestationCall && !isStateUpdate) {
      console.log('[listener] Evento ignorado (não é attestation)');
      return;
    }

    this.blockTracker++;
    const blockHeight = this.blockTracker; // TODO: extrair do evento quando disponível

    // TODO: DIAGNÓSTICO — remover após B.4
    console.log('[DIAG] state typeof    :', typeof action.state);
    console.log('[DIAG] state isBuffer  :', Buffer.isBuffer(action.state));
    console.log('[DIAG] state isUint8   :', action.state instanceof Uint8Array);
    console.log('[DIAG] state byteLength:', (action.state as any)?.byteLength ?? 'n/a');
    console.log('[DIAG] state length    :', action.state?.length ?? 'n/a');
    console.log('[DIAG] state[:80]      :', JSON.stringify(action.state).slice(0, 80));

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
