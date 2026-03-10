import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = process.env.HEDERA_RPC || "https://testnet.hashio.io/api";
const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY!;

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DPO2U ComplianceRegistryExtended — Hedera Testnet Deploy");
  console.log("  Cross-chain compliance relay from Midnight Network");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Load compiled artifact
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/ComplianceRegistryExtended.sol/ComplianceRegistryExtended.json"
  );

  if (!fs.existsSync(artifactPath)) {
    console.error("Artifact not found. Run 'npx hardhat compile' first.");
    process.exitCode = 1;
    return;
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 296,
    name: "hedera-testnet",
  });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}`);

  const network = await provider.getNetwork();
  console.log(`Network:  chainId ${network.chainId}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} HBAR\n`);

  if (balance === 0n) {
    console.log("No balance — please fund the wallet first.");
    console.log("Hedera faucet: https://portal.hedera.com/faucet");
    return;
  }

  console.log("Deploying ComplianceRegistryExtended...");
  console.log(`  admin:          ${wallet.address}`);
  console.log(`  trustedRelayer: ${wallet.address}\n`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // Constructor args: (admin, trustedRelayer) — both are deployer
  const contract = await factory.deploy(wallet.address, wallet.address, {
    gasLimit: 5_000_000,
  });

  console.log(`Tx hash:  ${contract.deploymentTransaction()?.hash}`);
  console.log("Waiting for confirmation...\n");

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`ComplianceRegistryExtended deployed to: ${address}\n`);

  // Smoke test
  const deployed = new ethers.Contract(address, artifact.abi, wallet);
  const admin = await deployed.admin();
  console.log(`Admin:            ${admin}`);

  const relayer = await deployed.trustedRelayer();
  console.log(`Trusted Relayer:  ${relayer}`);

  const count = await deployed.attestationCount();
  console.log(`Attestation count: ${count}\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy complete — contract is live on Hedera Testnet");
  console.log(`  Address: ${address}`);
  console.log(`  Explorer: https://hashscan.io/testnet/contract/${address}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n  Add to .env:`);
  console.log(`  HEDERA_REGISTRY_ADDRESS=${address}`);
  console.log(`  HEDERA_RPC=https://testnet.hashio.io/api\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
