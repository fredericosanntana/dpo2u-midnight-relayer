// src/state-parser-runtime.ts
//
// Decodificador de estado usando @midnight-ntwrk/compact-runtime real.
//
// O Midnight Indexer v3 retorna o ledger público em formato binário opaco
// (EncodedStateValue serializado como Uint8Array). Este módulo usa
// StateValue.decode() + StateMap.get() para navegar o estado tipado.
//
// LEDGER REAL do ComplianceRegistry.compact:
//
//   export ledger attestation_scores: Map<Bytes<32>, Uint<64>>;
//   export ledger attestation_dids:   Map<Bytes<32>, Bytes<32>>;
//   export ledger attestation_cids:   Map<Bytes<32>, Bytes<32>>;
//   export ledger attestation_score:  Uint<64>;
//
// COMO O INDEXER V3 RETORNA O ESTADO:
//
//   O campo `state` no GraphQL é o ledger inteiro serializado como
//   EncodedStateValue → Uint8Array. Cada campo `export ledger` vira
//   uma entrada no Map raiz, com a key sendo o nome do campo como
//   AlignedValue (bytes UTF-8 do identificador).
//
// LIMITAÇÃO ATUAL (Gap 2 — parcialmente resolvido):
//   O formato exato da serialização do Indexer v3 não é documentado
//   publicamente. Este decoder assume a estrutura mais provável baseada
//   nos tipos do compact-runtime e nos exemplos do midnight-examples.
//   REQUER TESTE CONTRA O INDEXER REAL para validar o formato.
//
// Para teste real: conectar ao devnet, chamar registerAttestation()
// e inspecionar o campo `state` bruto no evento GraphQL.

import {
  StateValue,
  StateMap,
} from '@midnight-ntwrk/compact-runtime';
import type { AlignedValue } from '@midnight-ntwrk/compact-runtime';

// ─── Tipos de Alignment para os tipos Compact usados no ledger ──────────────

// Bytes<32>: alignment = [{ tag: 'atom', value: { tag: 'bytes', length: 32 } }]
function bytes32Alignment(): AlignedValue['alignment'] {
  return [{ tag: 'atom', value: { tag: 'bytes', length: 32 } }];
}

// Uint<64>: alignment = [{ tag: 'atom', value: { tag: 'compress' } }]
// Compact serializa unsigned integers comprimidos (varint-like)
function uint64Alignment(): AlignedValue['alignment'] {
  return [{ tag: 'atom', value: { tag: 'compress' } }];
}

// Cria um AlignedValue para uma key Bytes<32> a partir de um Buffer/hex
function makeBytes32Key(value: Uint8Array | string): AlignedValue {
  const bytes = typeof value === 'string'
    ? hexToBytes32(value)
    : value;
  return {
    value: [bytes],
    alignment: bytes32Alignment(),
  };
}

// ─── Interface resultado ─────────────────────────────────────────────────────

export interface ParsedLedgerState {
  // Map: company_id (hex) → score (0-100)
  attestation_scores: Map<string, bigint>;
  // Map: company_id (hex) → agent_did (hex)
  attestation_dids: Map<string, string>;
  // Map: company_id (hex) → policy_cid (hex ou string)
  attestation_cids: Map<string, string>;
  // Último score global
  attestation_score: bigint;
}

// ─── Decoder principal ───────────────────────────────────────────────────────

/**
 * Decodifica o estado binário retornado pelo Midnight Indexer v3.
 *
 * @param stateHex - campo `state` do GraphQL (hex sem prefixo 0x, ou com)
 * @returns ParsedLedgerState ou null se não for possível decodificar
 */
export function decodeLedgerState(stateHex: string): ParsedLedgerState | null {
  try {
    const raw = stateHex.startsWith('0x') ? stateHex.slice(2) : stateHex;
    const bytes = Buffer.from(raw, 'hex');

    // O estado raiz é um Map onde cada entry é um campo `export ledger`
    const rootStateValue = StateValue.decode(bytes as unknown as Parameters<typeof StateValue.decode>[0]);

    if (rootStateValue.type() !== 'map') {
      console.warn('[runtime-parser] Estado raiz não é um Map — formato inesperado');
      return null;
    }

    const rootMap = rootStateValue.asMap();
    if (!rootMap) return null;

    return {
      attestation_scores: decodeMapBytes32ToUint64(rootMap, 'attestation_scores'),
      attestation_dids:   decodeMapBytes32ToBytes32(rootMap, 'attestation_dids'),
      attestation_cids:   decodeMapBytes32ToBytes32(rootMap, 'attestation_cids'),
      attestation_score:  decodeUint64Cell(rootMap, 'attestation_score'),
    };

  } catch (err) {
    console.error('[runtime-parser] Falha ao decodificar estado:', err);
    return null;
  }
}

// ─── Helpers de navegação do StateMap ────────────────────────────────────────

/**
 * Navega no map raiz buscando um campo por nome (string → AlignedValue de bytes UTF-8).
 * O Compact serializa nomes de campos export ledger como bytes da string.
 */
function getFieldByName(rootMap: StateMap, fieldName: string): StateValue | undefined {
  const nameBytes = Buffer.from(fieldName, 'utf-8');
  const key: AlignedValue = {
    value: [nameBytes],
    alignment: [{ tag: 'atom', value: { tag: 'bytes', length: nameBytes.length } }],
  };
  return rootMap.get(key);
}

/**
 * Decodifica Map<Bytes<32>, Uint<64>> de um campo do ledger.
 * Retorna Map<hex_string, bigint>.
 */
function decodeMapBytes32ToUint64(rootMap: StateMap, fieldName: string): Map<string, bigint> {
  const result = new Map<string, bigint>();

  try {
    const fieldValue = getFieldByName(rootMap, fieldName);
    if (!fieldValue || fieldValue.type() !== 'map') return result;

    const innerMap = fieldValue.asMap();
    if (!innerMap) return result;

    const keys = innerMap.keys();
    for (const key of keys) {
      const keyHex = alignedValueToHex(key);
      const val = innerMap.get(key);
      if (!val) continue;

      if (val.type() === 'cell') {
        const cell = val.asCell();
        result.set(keyHex, decodeCompressedUint64(cell.value));
      }
    }
  } catch (err) {
    console.warn(`[runtime-parser] Erro ao decodificar ${fieldName}:`, err);
  }

  return result;
}

/**
 * Decodifica Map<Bytes<32>, Bytes<32>> de um campo do ledger.
 * Retorna Map<hex_string, hex_string>.
 */
function decodeMapBytes32ToBytes32(rootMap: StateMap, fieldName: string): Map<string, string> {
  const result = new Map<string, string>();

  try {
    const fieldValue = getFieldByName(rootMap, fieldName);
    if (!fieldValue || fieldValue.type() !== 'map') return result;

    const innerMap = fieldValue.asMap();
    if (!innerMap) return result;

    const keys = innerMap.keys();
    for (const key of keys) {
      const keyHex = alignedValueToHex(key);
      const val = innerMap.get(key);
      if (!val) continue;

      if (val.type() === 'cell') {
        const cell = val.asCell();
        const valueHex = bufferToHex(cell.value);
        result.set(keyHex, valueHex);
      }
    }
  } catch (err) {
    console.warn(`[runtime-parser] Erro ao decodificar ${fieldName}:`, err);
  }

  return result;
}

/**
 * Decodifica um campo Uint<64> simples (não Map) do ledger raiz.
 */
function decodeUint64Cell(rootMap: StateMap, fieldName: string): bigint {
  try {
    const fieldValue = getFieldByName(rootMap, fieldName);
    if (!fieldValue || fieldValue.type() !== 'cell') return 0n;

    const cell = fieldValue.asCell();
    return decodeCompressedUint64(cell.value);
  } catch {
    return 0n;
  }
}

// ─── Utilitários de encoding/decoding ────────────────────────────────────────

/**
 * Converte o Value (Array<Uint8Array>) de um AlignedValue para hex string.
 */
function alignedValueToHex(av: AlignedValue): string {
  return bufferToHex(av.value);
}

/**
 * Concatena Array<Uint8Array> e converte para hex.
 */
function bufferToHex(value: Uint8Array[]): string {
  const total = value.reduce((acc, chunk) => acc + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of value) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return '0x' + Buffer.from(merged).toString('hex');
}

/**
 * Decodifica Uint<64> comprimido.
 * O Compact usa big-endian para inteiros. O campo 'compress' indica
 * que o valor é serializado de forma comprimida (leading zeros removidos).
 * Reconstruímos para BigInt via big-endian.
 */
function decodeCompressedUint64(value: Uint8Array[]): bigint {
  const bytes = Buffer.from(
    value.reduce<Uint8Array>((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0))
  );

  // Interpreta como big-endian uint64
  if (bytes.length === 0) return 0n;
  if (bytes.length >= 8) return bytes.readBigUInt64BE(bytes.length - 8);
  // Padding à esquerda para 8 bytes
  const padded = Buffer.alloc(8);
  bytes.copy(padded, 8 - bytes.length);
  return padded.readBigUInt64BE(0);
}

/**
 * Converte hex (com ou sem 0x) para Uint8Array de 32 bytes.
 */
function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.padStart(64, '0').slice(0, 64);
  return Buffer.from(padded, 'hex');
}

// ─── Exportações para uso no state-parser.ts principal ─────────────────────

export { makeBytes32Key, alignedValueToHex, bufferToHex };
