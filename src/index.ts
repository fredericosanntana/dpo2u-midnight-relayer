// src/index.ts
//
// Entry point do dpo2u-relayer.
// Inicializa o listener do Midnight e o broadcaster EVM,
// e conecta os dois em um pipeline de relay automático.

import 'dotenv/config';
import { MidnightListener } from './midnight-listener.js';
import { EVMBroadcaster } from './evm-broadcaster.js';
import { config } from './config.js';
import type { MidnightAttestation, BroadcastResult } from './types.js';

// ─── Relay pipeline ──────────────────────────────────────────────────────────

const broadcaster = new EVMBroadcaster();

async function handleAttestation(attestation: MidnightAttestation): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`🔄 RELAY: ${attestation.attestationId}`);
  console.log(`   Regulation: ${attestation.regulation}`);
  console.log(`   Score:      ${attestation.score}/100`);
  console.log(`   Block:      ${attestation.blockHeight}`);
  console.log('═══════════════════════════════════════════════════\n');

  let results: BroadcastResult[] = [];

  try {
    results = await broadcaster.broadcast(attestation);
  } catch (err) {
    console.error('❌ Erro crítico no broadcast:', err);
    return;
  }

  // Log de resultado
  console.log('\n📊 Resultado do relay:');
  for (const result of results) {
    if (result.success) {
      console.log(`  ✅ ${result.chain}: ${result.txHash}`);
    } else {
      console.log(`  ❌ ${result.chain}: ${result.error}`);
    }
  }
  console.log('');
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║       DPO2U Midnight Relayer v1.0         ║');
  console.log('║  Midnight → Base | Polkadot | Hedera      ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  console.log('[startup] Verificando conexões EVM...');
  await broadcaster.checkConnections();

  console.log('\n[startup] Iniciando listener Midnight...');
  console.log(`[startup] Contract monitorado: ${config.midnight.complianceRegistryAddress}`);
  console.log(`[startup] Entry point: ${config.midnight.attestationEntryPoint}`);
  console.log(`[startup] Chains destino: ${config.chains.map(c => c.name).join(', ')}`);
  console.log('');

  const listener = new MidnightListener(handleAttestation);
  listener.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('\n[shutdown] SIGTERM recebido, encerrando...');
    listener.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n[shutdown] SIGINT recebido, encerrando...');
    listener.stop();
    process.exit(0);
  });

  console.log('✅ Relayer ativo. Aguardando attestations do Midnight...\n');
}

main().catch((err) => {
  console.error('❌ Erro fatal no startup:', err);
  process.exit(1);
});
