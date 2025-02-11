import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";
import { PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { chunk } from "lodash";

// Solana Devnet RPC
const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";

// Setup provider & connection
const connection = new Connection(SOLANA_DEVNET_RPC, "confirmed");
const wallet = new anchor.Wallet(Keypair.generate()); // Dummy wallet
const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
anchor.setProvider(provider);

const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

async function airdrop(publicKey: PublicKey, amount = 1 * LAMPORTS_PER_SOL) {
  console.log(`Airdropping ${amount / LAMPORTS_PER_SOL} SOL to ${publicKey.toBase58()}...`);
  try {
    await connection.confirmTransaction(await connection.requestAirdrop(publicKey, amount));
  } catch (error) {
    console.error("Airdrop failed:", error);
  }
}

async function main() {
  console.log("🚀 Starting Large Scale Test...");

  // Deploy contract
  const solbox = Keypair.generate();
  const owner = Keypair.generate();
  await airdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL);

  console.log("⏳ Initializing SolBox Contract...");
  await program.rpc.initialize({
    accounts: {
      solbox: solbox.publicKey,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
    },
    signers: [solbox, owner],
  });

  // Generate 50 test users
  const users = Array.from({ length: 50 }, () => Keypair.generate());

  console.log(`🔹 Generated ${users.length} test users`);

  // Airdrop users in chunks to avoid rate limits
  for (const userBatch of chunk(users, 5)) {
    await Promise.all(userBatch.map(user => airdrop(user.publicKey, 1 * LAMPORTS_PER_SOL)));
    await new Promise(res => setTimeout(res, 3000)); // Delay to avoid 429 errors
  }

  console.log("💰 Users Funded. Starting Purchases...");

  let referrals: Record<string, PublicKey> = {};
  referrals[users[0].publicKey.toBase58()] = owner.publicKey; // First user referred by owner

  // Simulating 50 purchases with referrals
  for (let i = 0; i < users.length; i++) {
    let user = users[i];
    let referrer = referrals[user.publicKey.toBase58()] || owner.publicKey; // Assign referrer

    try {
      await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
        accounts: {
          solbox: solbox.publicKey,
          user: user.publicKey,
          referrer: referrer,
          systemProgram: SystemProgram.programId,
        },
        signers: [user],
      });

      console.log(`✅ User ${i + 1}: ${user.publicKey.toBase58()} bought a gift card. Referred by: ${referrer.toBase58()}`);

      // Assign next users under this user to create a spillover effect
      if (i + 1 < users.length) referrals[users[i + 1].publicKey.toBase58()] = user.publicKey;
      if (i + 2 < users.length) referrals[users[i + 2].publicKey.toBase58()] = user.publicKey;
    } catch (error) {
      console.error(`❌ Error in purchase for User ${i + 1}:`, error);
    }
  }

  console.log("🔄 Fetching Final Contract State...");
  const account = await program.account.solBox.fetch(solbox.publicKey);

  console.log("✅ Large Scale Test Completed!");
  console.log(`Total Sold: ${account.totalSold.toNumber() / LAMPORTS_PER_SOL} SOL`);
  console.log(`Total Commission Distributed: ${account.totalCommissionDistributed.toNumber() / LAMPORTS_PER_SOL} SOL`);
}

main().catch(err => console.error(err));
