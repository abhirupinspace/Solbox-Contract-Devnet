import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";
import { PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

// Define Solana Devnet RPC URL manually
const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";

// Create a provider manually
const connection = new Connection(SOLANA_DEVNET_RPC, "confirmed");
const wallet = new anchor.Wallet(Keypair.generate()); // Dummy wallet
const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
anchor.setProvider(provider);

const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

async function airdrop(connection: Connection, publicKey: PublicKey, amount = 1 * LAMPORTS_PER_SOL) {
  console.log(`Airdropping ${amount / LAMPORTS_PER_SOL} SOL to ${publicKey.toBase58()}...`);
  await connection.confirmTransaction(await connection.requestAirdrop(publicKey, amount));
}

async function main() {
  const connection = provider.connection;
  
  const solbox = Keypair.generate();
  const owner = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const user3 = Keypair.generate();
  const user4 = Keypair.generate(); // Spillover case

  console.log("Airdropping funds to test accounts...");
  await airdrop(connection, owner.publicKey);
  await airdrop(connection, user1.publicKey);
  await airdrop(connection, user2.publicKey);
  await airdrop(connection, user3.publicKey);
  await airdrop(connection, user4.publicKey);

  console.log("Initializing SolBox Contract...");
  await program.rpc.initialize({
    accounts: {
      solbox: solbox.publicKey,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
    },
    signers: [solbox, owner],
  });

  console.log("Buying Gift Cards...");
  
  // User1 buys a gift card (first referral)
  await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
    accounts: {
      solbox: solbox.publicKey,
      user: user1.publicKey,
      referrer: owner.publicKey, // Owner is referrer
      systemProgram: SystemProgram.programId,
    },
    signers: [user1],
  });

  // User2 buys a gift card (second referral)
  await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
    accounts: {
      solbox: solbox.publicKey,
      user: user2.publicKey,
      referrer: owner.publicKey,
      systemProgram: SystemProgram.programId,
    },
    signers: [user2],
  });

  // User3 buys a gift card (third referral, fills matrix)
  await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
    accounts: {
      solbox: solbox.publicKey,
      user: user3.publicKey,
      referrer: owner.publicKey,
      systemProgram: SystemProgram.programId,
    },
    signers: [user3],
  });

  // User4 buys a gift card (SPILLOVER case - should be placed under User1)
  await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
    accounts: {
      solbox: solbox.publicKey,
      user: user4.publicKey,
      referrer: user1.publicKey, // Spillover occurs
      systemProgram: SystemProgram.programId,
    },
    signers: [user4],
  });

  console.log("Fetching SolBox State...");
  const account = await program.account.solBox.fetch(solbox.publicKey);
  expect(account.totalSold.toNumber()).to.equal(4_000_000_000);
  console.log("✅ Spillover Test Passed!");

  console.log("Total Sold:", account.totalSold.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Total Commission Distributed:", account.totalCommissionDistributed.toNumber() / LAMPORTS_PER_SOL, "SOL");
}

main().catch(err => console.error(err));
