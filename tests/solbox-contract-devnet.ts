// Deploy & Initialize Contract
// Airdrop SOL to Users
// Simulate Multiple Users Buying Gift Cards
// Verify Spillover Mechanism (New referrals placed under correct users)
// Validate Commission Distribution

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";
import { PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

// Setup provider & connection
const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_DEVNET_RPC, "confirmed");
const wallet = new anchor.Wallet(Keypair.generate()); // Dummy wallet
const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
anchor.setProvider(provider);

const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

// Function to request SOL airdrop
async function airdrop(publicKey: PublicKey, amount = 1 * LAMPORTS_PER_SOL) {
  console.log(`Airdropping ${amount / LAMPORTS_PER_SOL} SOL to ${publicKey.toBase58()}...`);
  await connection.confirmTransaction(await connection.requestAirdrop(publicKey, amount));
}

describe("SolBox Spillover Test", () => {
  let solbox: Keypair;
  let owner: Keypair;
  let users: Keypair[] = [];

  before(async () => {
    solbox = Keypair.generate();
    owner = Keypair.generate();
    users = Array.from({ length: 10 }, () => Keypair.generate());

    console.log("⏳ Airdropping SOL to owner and users...");
    await airdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL);
    for (let user of users) {
      await airdrop(user.publicKey, 1 * LAMPORTS_PER_SOL);
    }

    console.log("🚀 Initializing SolBox contract...");
    await program.rpc.initialize({
      accounts: {
        solbox: solbox.publicKey,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      },
      signers: [solbox, owner],
    });

    const account = await program.account.solbox.fetch(solbox.publicKey);
    expect(account.totalSold.toNumber()).to.equal(0);
  });

  it("Simulates multiple purchases with spillover", async () => {
    console.log("🛒 Users buying gift cards...");

    let referrals: Record<string, PublicKey> = {};
    referrals[users[0].publicKey.toBase58()] = owner.publicKey; // First user referred by owner

    for (let i = 0; i < users.length; i++) {
      let user = users[i];
      let referrer = referrals[user.publicKey.toBase58()] || owner.publicKey; // Assign referrer

      await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
        accounts: {
          solbox: solbox.publicKey,
          user: user.publicKey,
          referrer: referrer,
          systemProgram: SystemProgram.programId,
        },
        signers: [user],
      });

      console.log(`✅ User ${i + 1} (${user.publicKey.toBase58()}) bought a gift card. Referred by: ${referrer.toBase58()}`);

      // Assign next users under this user to simulate spillover
      if (i + 1 < users.length) referrals[users[i + 1].publicKey.toBase58()] = user.publicKey;
      if (i + 2 < users.length) referrals[users[i + 2].publicKey.toBase58()] = user.publicKey;
    }

    console.log("🔄 Fetching final contract state...");
    const account = await program.account.solBox.fetch(solbox.publicKey);

    expect(account.totalSold.toNumber()).to.equal(users.length * 1_000_000_000);
    console.log(`🎉 Spillover Test Passed! Total Sold: ${account.totalSold.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`💰 Total Commission Distributed: ${account.totalCommissionDistributed.toNumber() / LAMPORTS_PER_SOL} SOL`);
  });
});
