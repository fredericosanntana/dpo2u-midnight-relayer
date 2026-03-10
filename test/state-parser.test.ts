// test/state-parser.test.ts — estrutura real do ComplianceRegistry.compact

import { parseContractState, parseAllAttestations } from '../src/state-parser.js';
import type { MidnightContractAction } from '../src/types.js';

const COMPANY_ID = 'aabbccdd'.padEnd(64, '0');
const AGENT_DID  = '11223344'.padEnd(64, '0');
const POLICY_CID = '55667788'.padEnd(64, '0');

function makeAction(ledger: object): MidnightContractAction {
  return {
    __typename: 'ContractCall',
    address: '0xcontract',
    entryPoint: 'registerAttestation',
    state: JSON.stringify(ledger),
  };
}

describe('state-parser — ComplianceRegistry.compact real', () => {

  test('parseia três maps corretamente', () => {
    const ledger = {
      attestation_scores: { [COMPANY_ID]: 85 },
      attestation_dids:   { [COMPANY_ID]: AGENT_DID },
      attestation_cids:   { [COMPANY_ID]: POLICY_CID },
      attestation_score:  85,
    };
    const result = parseContractState(makeAction(ledger), 100, '0xtx1');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(85);
    expect(result!.orgHash).toMatch(/^0x/);
    expect(result!.regulation).toBe('LGPD');
  });

  test('retorna null para maps vazios', () => {
    const ledger = { attestation_scores: {}, attestation_dids: {}, attestation_cids: {}, attestation_score: 0 };
    const result = parseContractState(makeAction(ledger), 101, '0xtx2');
    expect(result).toBeNull();
  });

  test('parseAllAttestations retorna múltiplas entries', () => {
    const ID1 = 'aaaa'.padEnd(64, '1');
    const ID2 = 'bbbb'.padEnd(64, '2');
    const ledger = {
      attestation_scores: { [ID1]: 80, [ID2]: 95 },
      attestation_dids:   { [ID1]: AGENT_DID, [ID2]: AGENT_DID },
      attestation_cids:   { [ID1]: POLICY_CID, [ID2]: POLICY_CID },
    };
    const action: MidnightContractAction = { __typename: 'ContractUpdate', address: '0xc', state: JSON.stringify(ledger) };
    const results = parseAllAttestations(action, 102, '0xtx3');
    expect(results).toHaveLength(2);
    expect(results[0].score).toBe(80);
    expect(results[1].score).toBe(95);
  });

  test('score como string é convertido para number', () => {
    const ledger = { attestation_scores: { [COMPANY_ID]: '67' }, attestation_dids: { [COMPANY_ID]: AGENT_DID }, attestation_cids: { [COMPANY_ID]: POLICY_CID } };
    const result = parseContractState(makeAction(ledger), 103, '0xtx4');
    expect(result!.score).toBe(67);
    expect(typeof result!.score).toBe('number');
  });

  test('agentDid sempre tem prefixo 0x', () => {
    const ledger = { attestation_scores: { [COMPANY_ID]: 90 }, attestation_dids: { [COMPANY_ID]: 'semprefix' }, attestation_cids: { [COMPANY_ID]: POLICY_CID } };
    const result = parseContractState(makeAction(ledger), 104, '0xtx5');
    expect(result!.agentDid).toMatch(/^0x/);
  });

  test('idempotência: mesmo company_id no mesmo bloco retorna null na 2ª vez', () => {
    const ledger = { attestation_scores: { [COMPANY_ID]: 75 }, attestation_dids: { [COMPANY_ID]: AGENT_DID }, attestation_cids: { [COMPANY_ID]: POLICY_CID } };
    const action = makeAction(ledger);
    const r1 = parseContractState(action, 999, '0xtx6');
    const r2 = parseContractState(action, 999, '0xtx6');
    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });

  test('retorna null para estado vazio', () => {
    const result = parseContractState({ __typename: 'ContractCall', address: '0x', state: '' }, 1, '0xtx7');
    expect(result).toBeNull();
  });
});
