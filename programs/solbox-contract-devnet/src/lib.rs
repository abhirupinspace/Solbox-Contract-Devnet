use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke;

declare_id!("D7hxGNmozyBY4T5G2YttUh8ZbErGKXZzGd5z4749on5S");

#[program]
pub mod solbox_contract_devnet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        solbox.owner = *ctx.accounts.owner.key;
        solbox.total_sold = 0;
        solbox.total_commission_distributed = 0;
        Ok(())
    }

    pub fn buy_gift_card(ctx: Context<BuyGiftCard>, amount: u64) -> Result<()> {
        require!(
            amount == 200_000_000 || amount == 1_000_000_000 || amount == 3_000_000_000,
            CustomError::InvalidAmount
        );
        
        let solbox = &mut ctx.accounts.solbox;
        let referrer = &ctx.accounts.referrer;
        let user = &ctx.accounts.user;
        let system_program = &ctx.accounts.system_program;
        
        let commission = (amount * 90) / 100;
        let bonus = (amount * 5) / 100;
        
        solbox.total_sold += amount;
        solbox.total_commission_distributed += commission;
        
        // Transfer SOL from user to referrer
        invoke(
            &system_instruction::transfer(user.key, referrer.key, commission),
            &[user.to_account_info(), referrer.to_account_info(), system_program.to_account_info()],
        )?;
        
        // Transfer SOL from user to system (remaining amount)
        invoke(
            &system_instruction::transfer(user.key, solbox.to_account_info().key, amount - commission - bonus),
            &[user.to_account_info(), solbox.to_account_info(), system_program.to_account_info()],
        )?;
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 48)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

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

#[account]
pub struct SolBox {
    pub owner: Pubkey,
    pub total_sold: u64,
    pub total_commission_distributed: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid Gift Card Amount.")]
    InvalidAmount,
}
