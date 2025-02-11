// import * as anchor from "@coral-xyz/anchor";
// import { Program } from "@coral-xyz/anchor";
// import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";

// describe("solbox-contract-devnet", () => {
//   // Configure the client to use the local cluster.
//   anchor.setProvider(anchor.AnchorProvider.env());

//   const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

//   it("Is initialized!", async () => {
//     // Add your test here.
//     const tx = await program.methods.initialize().rpc();
//     console.log("Your transaction signature", tx);
//   });
// });


import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";
import { expect } from "chai";

describe("SolBox Spillover Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

  let solbox: anchor.web3.Keypair;
  let owner: anchor.web3.Keypair;
  let user1: anchor.web3.Keypair;
  let user2: anchor.web3.Keypair;
  let user3: anchor.web3.Keypair;
  let user4: anchor.web3.Keypair; // Spillover case

  before(async () => {
    solbox = anchor.web3.Keypair.generate();
    owner = anchor.web3.Keypair.generate();
    user1 = anchor.web3.Keypair.generate();
    user2 = anchor.web3.Keypair.generate();
    user3 = anchor.web3.Keypair.generate();
    user4 = anchor.web3.Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(owner.publicKey, anchor.web3.LAMPORTS_PER_SOL)
    );
  });

  it("Initializes the contract", async () => {
    await program.rpc.initialize({
      accounts: {
        solbox: solbox.publicKey,
        owner: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [solbox, owner],
    });

    const account = await program.account.solBox.fetch(solbox.publicKey);
    expect(account.totalSold.toNumber()).to.equal(0);
  });

  it("Simulates spillover in the referral system", async () => {
    // User1 buys a gift card (first referral)
    await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
      accounts: {
        solbox: solbox.publicKey,
        user: user1.publicKey,
        referrer: owner.publicKey, // Owner is the referrer
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [user1],
    });

    // User2 buys a gift card (second referral)
    await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
      accounts: {
        solbox: solbox.publicKey,
        user: user2.publicKey,
        referrer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [user2],
    });

    // User3 buys a gift card (third referral, fills matrix)
    await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
      accounts: {
        solbox: solbox.publicKey,
        user: user3.publicKey,
        referrer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [user3],
    });

    // User4 buys a gift card (SPILLOVER case - should be placed under User1)
    await program.rpc.buyGiftCard(new anchor.BN(1_000_000_000), {
      accounts: {
        solbox: solbox.publicKey,
        user: user4.publicKey,
        referrer: user1.publicKey, // Spillover to User1
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [user4],
    });

    // Fetch the updated contract state
    const account = await program.account.solBox.fetch(solbox.publicKey);
    expect(account.totalSold.toNumber()).to.equal(4_000_000_000);

    console.log("Spillover Test Passed!");
  });
});
