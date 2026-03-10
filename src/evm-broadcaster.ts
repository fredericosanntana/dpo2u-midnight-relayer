// src/evm-broadcaster.ts
//
// Recebe uma MidnightAttestation e a escreve em todos os
// ComplianceRegistry.sol deployados nas chains EVM configuradas.
//
// O ComplianceRegistry.sol precisa ter a função:
//   registerAttestationFromMidnight(bytes32, bytes32, string, uint256, bytes32)

import { ethers } from 'ethers';
import { config } from './config.js';
import type { MidnightAttestation, BroadcastResult, EVMChainConfig } from './types.js';

// ABI mínimo — apenas a função que o relayer chama
const REGISTRY_ABI = [
  `function registerAttestationFromMidnight(
    bytes32 attestationId,
    bytes32 orgHash,
    string calldata regulation,
    uint256 score,
    uint256 validUntil,
    bytes32 agentDid,
    string calldata evidenceCid,
    bytes32 commitment
  ) external returns (bool)`,

  `function attestationExists(bytes32 attestationId) external view returns (bool)`,

  `event AttestationRelayed(
    bytes32 indexed attestationId,
    bytes32 indexed orgHash,
    string regulation,
    uint256 score,
    string source
  )`,
];

export class EVMBroadcaster {
  private signers: Map<string, ethers.Wallet> = new Map();
  private contracts: Map<string, ethers.Contract> = new Map();

  constructor() {
    this.initializeChains();
  }

  private initializeChains(): void {
    for (const chain of config.chains) {
      try {
        const provider = new ethers.JsonRpcProvider(chain.rpc, {
          chainId: chain.chainId,
          name: chain.name,
        });

        const signer = new ethers.Wallet(config.relayer.privateKey, provider);
        const contract = new ethers.Contract(
          chain.registryAddress,
          REGISTRY_ABI,
          signer
        );

        this.signers.set(chain.name, signer);
        this.contracts.set(chain.name, contract);

        console.log(`[broadcaster] Chain inicializada: ${chain.name}`);
        console.log(`  Registry: ${chain.registryAddress}`);
        console.log(`  Relayer:  ${signer.address}`);
      } catch (err) {
        console.error(`[broadcaster] Erro ao inicializar ${chain.name}:`, err);
      }
    }
  }

  async broadcast(attestation: MidnightAttestation): Promise<BroadcastResult[]> {
    const results: BroadcastResult[] = [];

    await Promise.allSettled(
      config.chains.map(async (chain) => {
        const result = await this.broadcastToChain(chain, attestation);
        results.push(result);
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[broadcaster] Resultado: ${successful} sucesso(s), ${failed} falha(s)`);
    return results;
  }

  private async broadcastToChain(
    chain: EVMChainConfig,
    attestation: MidnightAttestation
  ): Promise<BroadcastResult> {
    const contract = this.contracts.get(chain.name);
    if (!contract) {
      return {
        chain: chain.name,
        txHash: '',
        blockNumber: 0,
        success: false,
        error: 'Contract não inicializado',
      };
    }

    try {
      // Verifica se a attestation já foi relayada (idempotência)
      const exists = await contract.attestationExists(attestation.attestationId);
      if (exists) {
        console.log(`[broadcaster] ${chain.name}: attestation já existe, pulando`);
        return {
          chain: chain.name,
          txHash: 'already_exists',
          blockNumber: 0,
          success: true,
        };
      }

      // Converte tipos para o ABI EVM
      const attestationId = padBytes32(attestation.attestationId);
      const orgHash = padBytes32(attestation.orgHash);
      const agentDid = padBytes32(attestation.agentDid);
      const commitment = padBytes32(attestation.commitment);

      console.log(`[broadcaster] Enviando para ${chain.name}...`);

      const tx = await contract.registerAttestationFromMidnight(
        attestationId,
        orgHash,
        attestation.regulation,
        BigInt(attestation.score),
        attestation.validUntil,
        agentDid,
        attestation.evidenceCid,
        commitment,
        {
          // Gas estimado manualmente para evitar underestimation
          gasLimit: 200_000n,
        }
      );

      console.log(`[broadcaster] ${chain.name} TX enviada: ${tx.hash}`);

      const receipt = await tx.wait();

      console.log(`[broadcaster] ${chain.name} confirmada no bloco ${receipt.blockNumber} ✅`);

      return {
        chain: chain.name,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        success: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[broadcaster] ${chain.name} FALHOU:`, error);

      return {
        chain: chain.name,
        txHash: '',
        blockNumber: 0,
        success: false,
        error,
      };
    }
  }

  async checkConnections(): Promise<void> {
    for (const chain of config.chains) {
      const signer = this.signers.get(chain.name);
      if (!signer) continue;

      try {
        const balance = await signer.provider!.getBalance(signer.address);
        const balanceEth = ethers.formatEther(balance);
        console.log(`[broadcaster] ${chain.name}: saldo do relayer = ${balanceEth} ETH`);

        if (balance < ethers.parseEther('0.001')) {
          console.warn(`[broadcaster] ⚠️ ${chain.name}: saldo baixo! Faucet necessário.`);
        }
      } catch (err) {
        console.error(`[broadcaster] ${chain.name}: erro ao verificar saldo:`, err);
      }
    }
  }
}

// Garante que o valor seja bytes32 válido para o ABI
function padBytes32(value: string): string {
  const clean = value.startsWith('0x') ? value.slice(2) : value;
  return '0x' + clean.padStart(64, '0').slice(0, 64);
}
