// src/state-parser.ts
//
// Parseia o estado público retornado pelo Indexer GraphQL do Midnight.
//
// Estrutura do ledger (ComplianceRegistry.compact):
//
//   export ledger attestation_scores: Map<Bytes<32>, Uint<64>>;
//   export ledger attestation_dids:   Map<Bytes<32>, Bytes<32>>;
//   export ledger attestation_cids:   Map<Bytes<32>, Bytes<32>>;
//   export ledger attestation_score:  Uint<64>;   // último score global
//
// Todos os campos são públicos via disclose() no registerAttestation().
// A chave das Maps é o company_id (hash do CNPJ/org identifier).
//
// NOTA SOBRE REGULATION:
// O contrato atual não armazena o framework regulatório (LGPD/GDPR).
// O relayer usa "LGPD" como default e rastreia via policy_cid.
// Gap anotado: adicionar `attestation_regulations: Map<Bytes<32>, Bytes<32>>`
// no ComplianceRegistry.compact em próxima iteração.

import type { MidnightAttestation, MidnightContractAction } from './types.js';
import { decodeLedgerState } from './state-parser-runtime.js';

// ─── Tipos do ledger Compact serializado pelo Indexer v3 ─────────────────────

interface RawLedgerState {
  // Map<company_id_hash → score>
  attestation_scores?: Record<string, string | number>;

  // Map<company_id_hash → agent_did>
  attestation_dids?: Record<string, string>;

  // Map<company_id_hash → policy_cid (IPFS CID como Bytes<32>)>
  attestation_cids?: Record<string, string>;

  // Último score global (campo simples para queries)
  attestation_score?: string | number;

  [key: string]: unknown;
}

// ─── Estado interno do relayer: rastreia qual company_id foi processado ───────

// Map de company_id → último txHash relayado
// Evita processar o mesmo company_id duas vezes no mesmo bloco
const processedInBlock = new Map<string, string>();

export function parseContractState(
  action: MidnightContractAction,
  blockHeight: number,
  txHash: string
): MidnightAttestation | null {
  try {
    const rawState = decodeState(action.state);
    if (!rawState) {
      console.warn('[parser] Estado vazio ou não decodificável');
      return null;
    }

    // Extrai todas as entradas dos maps
    const scores = rawState.attestation_scores ?? {};
    const dids   = rawState.attestation_dids   ?? {};
    const cids   = rawState.attestation_cids   ?? {};

    const companyIds = Object.keys(scores);
    if (companyIds.length === 0) {
      console.warn('[parser] Nenhuma attestation nos maps do ledger');
      return null;
    }

    // Pega o company_id mais recente (última chave inserida)
    // O Compact Map mantém ordem de inserção no estado público
    const companyId = companyIds[companyIds.length - 1];

    // Idempotência por bloco: ignora se já processamos este company_id
    const processedKey = `${blockHeight}:${companyId}`;
    if (processedInBlock.has(processedKey)) {
      console.log(`[parser] company_id ${companyId} já processado neste bloco, ignorando`);
      return null;
    }
    processedInBlock.set(processedKey, txHash);

    const score    = Number(scores[companyId] ?? rawState.attestation_score ?? 0);
    const agentDid = dids[companyId] ?? '0'.repeat(64);
    const policyCid = cids[companyId] ?? '';

    // attestation_id: derivado de company_id + blockHeight (determinístico)
    // O contrato não gera um ID explícito — o relayer o cria
    const attestationId = deriveAttestationId(companyId, blockHeight);

    return {
      attestationId,
      orgHash:     ensureHex(companyId),
      regulation:  'LGPD',      // default: contrato não armazena regulation
      score,
      agentDid:    ensureHex(agentDid),
      evidenceCid: policyCidToString(policyCid),
      validUntil:  BigInt(0),   // contrato não tem valid_until — gap documentado
      commitment:  deriveCommitment(companyId, score, agentDid),
      blockHeight,
      txHash,
    };
  } catch (err) {
    console.error('[parser] Erro ao parsear estado:', err);
    return null;
  }
}

// ─── Extrai TODAS as attestations do estado (para sync inicial) ────────────────

export function parseAllAttestations(
  action: MidnightContractAction,
  blockHeight: number,
  txHash: string
): MidnightAttestation[] {
  try {
    const rawState = decodeState(action.state);
    if (!rawState) return [];

    const scores = rawState.attestation_scores ?? {};
    const dids   = rawState.attestation_dids   ?? {};
    const cids   = rawState.attestation_cids   ?? {};

    return Object.keys(scores).map((companyId) => {
      const score     = Number(scores[companyId] ?? 0);
      const agentDid  = dids[companyId] ?? '0'.repeat(64);
      const policyCid = cids[companyId] ?? '';

      return {
        attestationId: deriveAttestationId(companyId, blockHeight),
        orgHash:       ensureHex(companyId),
        regulation:    'LGPD',
        score,
        agentDid:      ensureHex(agentDid),
        evidenceCid:   policyCidToString(policyCid),
        validUntil:    BigInt(0),
        commitment:    deriveCommitment(companyId, score, agentDid),
        blockHeight,
        txHash,
      };
    });
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeState(state: string): RawLedgerState | null {
  if (!state) return null;

  // Tentativa 1: compact-runtime (caminho primário para estado binário real do Indexer v3)
  // O Indexer v3 retorna o ledger como EncodedStateValue binário serializado.
  // StateValue.decode() navega a estrutura tipada do Compact.
  try {
    const parsed = decodeLedgerState(state);
    if (parsed) {
      // Converte ParsedLedgerState → RawLedgerState para compatibilidade com o restante do parser
      const scores: Record<string, string | number> = {};
      const dids:   Record<string, string> = {};
      const cids:   Record<string, string> = {};

      for (const [key, val] of parsed.attestation_scores) scores[key] = val.toString();
      for (const [key, val] of parsed.attestation_dids)   dids[key]   = val;
      for (const [key, val] of parsed.attestation_cids)   cids[key]   = val;

      return {
        attestation_scores: scores,
        attestation_dids:   dids,
        attestation_cids:   cids,
        attestation_score:  parsed.attestation_score.toString(),
      };
    }
  } catch { /* segue para fallbacks */ }

  // Tentativa 2: JSON direto (caso o Indexer retorne JSON em alguma versão)
  try { return JSON.parse(state) as RawLedgerState; } catch { /* segue */ }

  // Tentativa 3: base64 → JSON
  try {
    return JSON.parse(Buffer.from(state, 'base64').toString('utf-8')) as RawLedgerState;
  } catch { /* segue */ }

  // Tentativa 4: hex → UTF-8 → JSON
  try {
    const hex = state.startsWith('0x') ? state.slice(2) : state;
    return JSON.parse(Buffer.from(hex, 'hex').toString('utf-8')) as RawLedgerState;
  } catch { /* segue */ }

  // Todos os paths falharam
  console.error('[parser] FALHA: Estado não decodificável. Verificar formato do Indexer v3.');
  console.error('[parser] Primeiros 100 chars do estado:', state.slice(0, 100));
  return null;
}

function ensureHex(value: string): string {
  if (!value) return '0x' + '0'.repeat(64);
  const clean = value.startsWith('0x') ? value : '0x' + value;
  // Garante 32 bytes (64 chars hex)
  return '0x' + clean.slice(2).padStart(64, '0').slice(0, 64);
}

// Deriva um attestation_id determinístico a partir de company_id + blockHeight
function deriveAttestationId(companyId: string, blockHeight: number): string {
  const combined = `${companyId}:${blockHeight}`;
  return '0x' + Buffer.from(combined).toString('hex').padEnd(64, '0').slice(0, 64);
}

// policy_cid é Bytes<32> no Compact — converte para string legível se possível
function policyCidToString(raw: string): string {
  if (!raw) return '';
  // Se começa com "Qm" ou "baf" já é um CID legível
  if (raw.startsWith('Qm') || raw.startsWith('baf')) return raw;
  // Tenta decodificar hex → UTF-8
  try {
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
    const decoded = Buffer.from(hex, 'hex').toString('utf-8').replace(/\0/g, '');
    if (decoded.startsWith('Qm') || decoded.startsWith('baf')) return decoded;
  } catch { /* segue */ }
  return raw; // retorna raw se não conseguir decodificar
}

// Commitment sintético: hash dos campos públicos (sem revelar estado privado)
// Em produção: usar o ZK commitment real exportado pelo Compact
function deriveCommitment(companyId: string, score: number, agentDid: string): string {
  const combined = `${companyId}:${score}:${agentDid}`;
  return '0x' + Buffer.from(combined).toString('hex').padEnd(64, '0').slice(0, 64);
}
