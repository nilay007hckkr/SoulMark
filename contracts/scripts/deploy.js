// Deploys SoulMark with issuer = deployer and writes ../deployments/<network>.json.
// Usage: npm run deploy:base-sepolia   (or: npx hardhat run scripts/deploy.js --network hardhat)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  if (net === "baseSepolia" && !process.env.ISSUER_PRIVATE_KEY) {
    console.error(
      "Refusing to deploy to baseSepolia: ISSUER_PRIVATE_KEY is not set.\n" +
        "Set ISSUER_PRIVATE_KEY (a testnet-only key funded from a Base Sepolia faucet) and optionally RPC_URL in the root .env."
    );
    process.exitCode = 1;
    return;
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error(`No deployer account configured for network "${net}".`);

  const { chainId } = await hre.ethers.provider.getNetwork();
  console.log(`Deploying SoulMark to ${net} (chainId ${chainId}) from ${deployer.address}...`);

  const SoulMark = await hre.ethers.getContractFactory("SoulMark");
  const soul = await SoulMark.deploy(deployer.address);
  const tx = soul.deploymentTransaction();
  await soul.waitForDeployment();
  const address = await soul.getAddress();

  const record = {
    address,
    issuer: deployer.address,
    chainId: Number(chainId),
    txHash: tx ? tx.hash : null,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  // FIXES.md expects deployments/base-sepolia.json for Base Sepolia.
  const fileName = net === "baseSepolia" ? "base-sepolia" : net;
  const outFile = path.join(outDir, `${fileName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");
  console.log(`SoulMark deployed at ${address}; wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
