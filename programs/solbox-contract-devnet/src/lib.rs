#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke;

// Declare the program ID
// This should match the deployed program ID on Solana
declare_id!("D7hxGNmozyBY4T5G2YttUh8ZbErGKXZzGd5z4749on5S");    

#[program]
pub mod solbox_contract_devnet {
    use super::*;

    // Initializes the SolBox contract
    // Sets the contract owner and initializes necessary state variables
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        solbox.owner = *ctx.accounts.owner.key;
        solbox.total_sold = 0;
        solbox.total_commission_distributed = 0;
        solbox.referral_limit = 3; // Configurable max referrals per user
        Ok(())
    }

    // Allows a user to buy a gift card, rewarding their referrer with commission
    // Ensures valid amounts, handles spillover logic, and updates state variables
    pub fn buy_gift_card(ctx: Context<BuyGiftCard>, amount: u64) -> Result<()> {
        // Ensure that the gift card amount is valid
        require!(
            amount == 200_000_000 || amount == 1_000_000_000 || amount == 3_000_000_000,
            CustomError::InvalidAmount
        );
        
        let solbox = &mut ctx.accounts.solbox;
        let mut referrer = ctx.accounts.referrer.key();
        let user = &ctx.accounts.user;
        let system_program = &ctx.accounts.system_program;
        
        // Calculate commission and bonuses
        let commission = (amount * 90) / 100;
        let bonus = (amount * 5) / 100;
        
        // Ensure the referrer is valid
        require_keys_eq!(referrer, ctx.accounts.referrer.key(), CustomError::InvalidReferrer);

        // Apply spillover logic if the referrer is already at their referral limit
        if let Some(new_referrer) = find_spillover_position(&solbox.referral_tree, referrer, solbox.referral_limit) {
            referrer = new_referrer;
        }
        
        // Update contract state with the new purchase and commission data
        solbox.total_sold += amount;
        solbox.total_commission_distributed += commission;
        
        // Store the referral relationship
        solbox.referral_tree.push((user.key(), vec![referrer]));
        
        // Transfer commission to the referrer
        invoke(
            &system_instruction::transfer(user.key, &referrer, commission),
            &[user.to_account_info(), ctx.accounts.referrer.to_account_info(), system_program.to_account_info()],
        )?;
        
        // Transfer remaining SOL to the contract system account
        invoke(
            &system_instruction::transfer(user.key, solbox.to_account_info().key, amount - commission - bonus),
            &[user.to_account_info(), solbox.to_account_info(), system_program.to_account_info()],
        )?;

        Ok(())
    }
}

/// Finds an available referrer slot in the referral tree based on the referral limit
fn find_spillover_position(referral_tree: &Vec<(Pubkey, Vec<Pubkey>)>, _referrer: Pubkey, referral_limit: u8) -> Option<Pubkey> {
    for (parent, children) in referral_tree.iter() {
        if children.len() < referral_limit as usize {
            return Some(*parent);
        }
    }
    None
}

// Defines the required accounts for initializing the contract
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 128)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Defines the required accounts for purchasing a gift card
#[derive(Accounts)]
pub struct BuyGiftCard<'info> {
    #[account(mut)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub referrer: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Stores contract-wide data such as total sales, commission distribution, and referral structure
#[account]
pub struct SolBox {
    pub owner: Pubkey,
    pub total_sold: u64,
    pub total_commission_distributed: u64,
    pub referral_limit: u8,
    pub referral_tree: Vec<(Pubkey, Vec<Pubkey>)>,
}

/// Defines error codes for handling invalid input cases
#[error_code]
pub enum CustomError {
    #[msg("Invalid Gift Card Amount.")]
    InvalidAmount,
    #[msg("Invalid Referrer.")]
    InvalidReferrer,
}
