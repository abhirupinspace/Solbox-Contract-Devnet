import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolboxContractDevnet } from "../target/types/solbox_contract_devnet";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { BN } from "bn.js";

describe("solbox-contract-devnet", () => {
  // Constants for test configuration
  const GIFT_CARD_AMOUNTS = [
    new BN(200 * LAMPORTS_PER_SOL),
    new BN(1000 * LAMPORTS_PER_SOL),
    new BN(3000 * LAMPORTS_PER_SOL),
  ];
  const COMMISSION_PERCENTAGE = new BN(90);
  const BONUS_PERCENTAGE = new BN(5);
  const REFERRAL_LIMIT = 3;

  // Set up provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolboxContractDevnet as Program<SolboxContractDevnet>;

  // Test accounts
  let owner: Keypair;
  let solboxAccount: Keypair;
  let user: Keypair;
  let referrer: Keypair;

  // Utility function to airdrop SOL
  async function airdropSol(recipient: PublicKey, amount: number = 10) {
    const signature = await provider.connection.requestAirdrop(
      recipient,
      amount * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
  }

  // Utility function to get account balance
  async function getBalance(pubkey: PublicKey): Promise<number> {
    return provider.connection.getBalance(pubkey);
  }

  before(async () => {
    // Generate test accounts
    owner = Keypair.generate();
    solboxAccount = Keypair.generate();
    user = Keypair.generate();
    referrer = Keypair.generate();

    // Airdrop SOL to test accounts
    await Promise.all([
      airdropSol(owner.publicKey),
      airdropSol(user.publicKey, 20),
      airdropSol(referrer.publicKey),
    ]);
  });

  describe("Initialization", () => {
    it("should successfully initialize the contract", async () => {
      // Create initial config
      const config = {
        referralLimit: REFERRAL_LIMIT,
        commissionPercentage: COMMISSION_PERCENTAGE,
        bonusPercentage: BONUS_PERCENTAGE,
        validAmounts: GIFT_CARD_AMOUNTS,
      };

      try {
        // Initialize contract
        await program.methods
          .initialize(config)
          .accounts({
            solbox: solboxAccount.publicKey,
            owner: owner.publicKey,
            system: anchor.web3.SystemProgram.programId,
          })
          .signers([owner, solboxAccount])
          .rpc();

        // Fetch and verify contract state
        const account = await program.account.solBox.fetch(solboxAccount.publicKey);
        
        expect(account.owner.toString()).to.equal(owner.publicKey.toString());
        expect(account.paused).to.be.false;
        expect(account.totalSold.toNumber()).to.equal(0);
        expect(account.totalCommissionDistributed.toNumber()).to.equal(0);
        expect(account.referralCount.toNumber()).to.equal(0);
        expect(account.config.referralLimit).to.equal(REFERRAL_LIMIT);
        expect(account.config.commissionPercentage.eq(COMMISSION_PERCENTAGE)).to.be.true;
        expect(account.config.bonusPercentage.eq(BONUS_PERCENTAGE)).to.be.true;
        expect(account.referralRelationships).to.be.empty;
      } catch (error) {
        console.error("Initialization error:", error);
        throw error;
      }
    });

    it("should fail to initialize with invalid config", async () => {
      const invalidConfig = {
        referralLimit: 0,
        commissionPercentage: new BN(90),
        bonusPercentage: new BN(5),
        validAmounts: GIFT_CARD_AMOUNTS,
      };

      try {
        await program.methods
          .initialize(invalidConfig)
          .accounts({
            solbox: Keypair.generate().publicKey,
            owner: owner.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([owner])
          .rpc();
        expect.fail("Should have failed with invalid config");
      } catch (error) {
        expect(error).to.be.an("error");
      }
    });
  });

  describe("Gift Card Purchase", () => {
    let initialUserBalance: number;
    let initialReferrerBalance: number;
    let initialContractBalance: number;

    beforeEach(async () => {
      initialUserBalance = await getBalance(user.publicKey);
      initialReferrerBalance = await getBalance(referrer.publicKey);
      initialContractBalance = await getBalance(solboxAccount.publicKey);
    });

    it("should successfully purchase a gift card", async () => {
      const purchaseAmount = GIFT_CARD_AMOUNTS[0];
      const expectedCommission = purchaseAmount.mul(COMMISSION_PERCENTAGE).div(new BN(100));
      const expectedBonus = purchaseAmount.mul(BONUS_PERCENTAGE).div(new BN(100));

      try {
        await program.methods
          .buyGiftCard(purchaseAmount)
          .accounts({
            solbox: solboxAccount.publicKey,
            user: user.publicKey,
            referrer: referrer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        // Verify contract state
        const account = await program.account.solBox.fetch(solboxAccount.publicKey);
        expect(account.totalSold.eq(purchaseAmount)).to.be.true;
        expect(account.totalCommissionDistributed.eq(expectedCommission)).to.be.true;
        expect(account.referralCount.toNumber()).to.equal(1);

        // Verify balances
        const finalUserBalance = await getBalance(user.publicKey);
        const finalReferrerBalance = await getBalance(referrer.publicKey);
        const finalContractBalance = await getBalance(solboxAccount.publicKey);

        expect(finalUserBalance).to.be.lessThan(initialUserBalance - purchaseAmount.toNumber());
        expect(finalReferrerBalance - initialReferrerBalance).to.equal(expectedCommission.toNumber());
        expect(finalContractBalance - initialContractBalance)
          .to.equal(purchaseAmount.sub(expectedCommission).sub(expectedBonus).toNumber());
      } catch (error) {
        console.error("Purchase error:", error);
        throw error;
      }
    });

    it("should fail with invalid amount", async () => {
      const invalidAmount = new BN(150 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .buyGiftCard(invalidAmount)
          .accounts({
            solbox: solboxAccount.publicKey,
            user: user.publicKey,
            referrer: referrer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed with invalid amount");
      } catch (error) {
        expect(error).to.be.an("error");
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Contract Configuration", () => {
    it("should update configuration when owner calls", async () => {
      const newConfig = {
        referralLimit: 5,
        commissionPercentage: new BN(85),
        bonusPercentage: new BN(7),
        validAmounts: [
          new BN(300 * LAMPORTS_PER_SOL),
          new BN(1500 * LAMPORTS_PER_SOL),
        ],
      };

      try {
        await program.methods
          .updateConfig(newConfig)
          .accounts({
            solbox: solboxAccount.publicKey,
            owner: owner.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([owner])
          .rpc();

        const account = await program.account.solBox.fetch(solboxAccount.publicKey);
        expect(account.config.referralLimit).to.equal(newConfig.referralLimit);
        expect(account.config.commissionPercentage.eq(newConfig.commissionPercentage)).to.be.true;
        expect(account.config.bonusPercentage.eq(newConfig.bonusPercentage)).to.be.true;
      } catch (error) {
        console.error("Config update error:", error);
        throw error;
      }
    });
  });

  describe("Pause Functionality", () => {
    it("should toggle pause state", async () => {
      await program.methods
        .togglePause()
        .accounts({
            solbox: solboxAccount.publicKey,
            owner: owner.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      let account = await program.account.solBox.fetch(solboxAccount.publicKey);
      expect(account.paused).to.be.true;

      // Try purchase while paused
      try {
        await program.methods
          .buyGiftCard(GIFT_CARD_AMOUNTS[0])
          .accounts({
            solbox: solboxAccount.publicKey,
            user: user.publicKey,
            referrer: referrer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed while paused");
      } catch (error) {
        expect(error).to.be.an("error");
        expect(error.toString()).to.include("ContractPaused");
      }
    });
  });
});