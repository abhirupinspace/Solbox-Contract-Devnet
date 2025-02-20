#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke;
use std::collections::HashMap;

declare_id!("D7hxGNmozyBY4T5G2YttUh8ZbErGKXZzGd5z4749on5S");

#[program]
pub mod solbox_contract_devnet {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        founder_wallet: Pubkey,
        config: ContractConfig,
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Set the contract owner and founder wallet
        solbox.owner = *ctx.accounts.owner.key;
        solbox.founder_wallet = founder_wallet;
        
        // Initialize contract state
        solbox.paused = false;
        solbox.total_sold = 0;
        solbox.total_commission_distributed = 0;
        solbox.referral_count = 0;
        solbox.config = config;
        
        // Initialize empty collections
        solbox.blacklisted_users = Vec::new();
        solbox.referral_relationships = Vec::new();
        
        emit!(InitializeEvent {
            owner: *ctx.accounts.owner.key,
            founder_wallet,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn update_config(
        ctx: Context<AdminAction>,
        new_config: ContractConfig,
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Ensure contract is not paused
        require!(!solbox.paused, CustomError::ContractPaused);
        
        // Update configuration
        solbox.config = new_config.clone();
        
        emit!(ConfigUpdateEvent {
            admin: *ctx.accounts.admin.key,
            new_config,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn toggle_pause(ctx: Context<AdminAction>) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Toggle pause state
        solbox.paused = !solbox.paused;
        
        emit!(PauseEvent {
            admin: *ctx.accounts.admin.key,
            paused: solbox.paused,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn upgrade_package(
        ctx: Context<UpgradePackage>,
        new_package: u64
    ) -> Result<()> {
        let solbox = &ctx.accounts.solbox;
        let user = &mut ctx.accounts.user;
        
        // Verify contract is active
        require!(!solbox.paused, CustomError::ContractPaused);
        
        // Check if user is blacklisted
        require!(
            !solbox.blacklisted_users.contains(&user.key()),
            CustomError::UserBlacklisted
        );
        
        // Validate new package amount
        require!(
            solbox.config.valid_amounts.contains(&new_package),
            CustomError::InvalidAmount
        );
        
        // Ensure upgrade is to a higher package
        require!(
            new_package > user.current_package,
            CustomError::InvalidUpgrade
        );
        
        // Calculate price difference
        let difference = new_package
            .checked_sub(user.current_package)
            .ok_or(CustomError::ArithmeticError)?;
            
        // Transfer difference amount
        invoke(
            &system_instruction::transfer(
                &user.key(),
                solbox.to_account_info().key,
                difference
            ),
            &[
                user.to_account_info(),
                solbox.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        // Update user's package
        let old_package = user.current_package;
        user.current_package = new_package;
        
        emit!(PackageUpgradeEvent {
            user: user.key(),
            old_package,
            new_package,
            difference,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn buy_gift_card(
        ctx: Context<BuyGiftCard>,
        amount: u64
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        let user = &ctx.accounts.user;
        let referrer = &ctx.accounts.referrer;
        
        // Verify contract is active
        require!(!solbox.paused, CustomError::ContractPaused);
        
        // Check if user is blacklisted
        require!(
            !solbox.blacklisted_users.contains(user.key),
            CustomError::UserBlacklisted
        );
        
        // Validate purchase amount
        require!(
            solbox.config.valid_amounts.contains(&amount),
            CustomError::InvalidAmount
        );
        
        // Prevent self-referral
        require!(
            user.key() != referrer.key(),
            CustomError::SelfReferralNotAllowed
        );
        
        // Calculate commissions
        let commission = amount
            .checked_mul(solbox.config.commission_percentage)
            .ok_or(CustomError::ArithmeticError)?
            .checked_div(100)
            .ok_or(CustomError::ArithmeticError)?;
            
        let bonus = amount
            .checked_mul(solbox.config.bonus_percentage)
            .ok_or(CustomError::ArithmeticError)?
            .checked_div(100)
            .ok_or(CustomError::ArithmeticError)?;
            
        // Handle referral spillover if needed
        let final_referrer = if solbox.referral_count >= solbox.config.referral_limit as u64 {
            find_spillover_position(
                &solbox.referral_relationships,
                referrer.key(),
                solbox.config.referral_limit
            ).ok_or(CustomError::NoSpilloverAvailable)?
        } else {
            referrer.key()
        };
        
        // Update contract state
        solbox.total_sold = solbox.total_sold
            .checked_add(amount)
            .ok_or(CustomError::ArithmeticError)?;
            
        solbox.total_commission_distributed = solbox.total_commission_distributed
            .checked_add(commission)
            .ok_or(CustomError::ArithmeticError)?;
            
        solbox.referral_count = solbox.referral_count
            .checked_add(1)
            .ok_or(CustomError::ArithmeticError)?;
            
        // Record referral relationship
        solbox.referral_relationships.push(ReferralRelationship {
            user: *user.key,
            referrer: final_referrer,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        // Update referrer's earnings
        let referrer_account = &mut ctx.accounts.referrer_user_account;
        referrer_account.total_earnings = referrer_account.total_earnings
            .checked_add(commission)
            .ok_or(CustomError::ArithmeticError)?;
        
        // Transfer commission to referrer
        invoke(
            &system_instruction::transfer(
                user.key,
                &final_referrer,
                commission
            ),
            &[
                user.to_account_info(),
                ctx.accounts.referrer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        
        // Calculate and transfer remaining amount to founder
        let founder_share = amount
            .checked_sub(commission)
            .ok_or(CustomError::ArithmeticError)?
            .checked_sub(bonus)
            .ok_or(CustomError::ArithmeticError)?;
            
        invoke(
            &system_instruction::transfer(
                user.key,
                &solbox.founder_wallet,
                founder_share
            ),
            &[
                user.to_account_info(),
                ctx.accounts.founder.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        
        emit!(GiftCardPurchaseEvent {
            user: user.key(),
            referrer: final_referrer,
            amount,
            commission,
            founder_share,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn grant_package(
        ctx: Context<AdminAction>,
        user: Pubkey,
        package: u64
    ) -> Result<()> {
        let solbox = &ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Validate package amount
        require!(
            solbox.config.valid_amounts.contains(&package),
            CustomError::InvalidAmount
        );
        
        // Update user's package
        let user_account = &mut ctx.accounts.user;
        user_account.current_package = package;
        
        emit!(PackageGrantedEvent {
            admin: *ctx.accounts.admin.key,
            user,
            package,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn update_commission_config(
        ctx: Context<AdminAction>,
        new_percentage: u64,
        new_levels: u8
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Update commission configuration
        solbox.config.commission_percentage = new_percentage;
        solbox.config.commission_levels = new_levels;
        
        emit!(CommissionConfigEvent {
            admin: *ctx.accounts.admin.key,
            new_percentage,
            new_levels,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn add_to_blacklist(
        ctx: Context<AdminAction>,
        user: Pubkey
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Add to blacklist if not already present
        if !solbox.blacklisted_users.contains(&user) {
            solbox.blacklisted_users.push(user);
        }
        
        emit!(BlacklistEvent {
            admin: *ctx.accounts.admin.key,
            user,
            action: BlacklistAction::Add,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    pub fn remove_from_blacklist(
        ctx: Context<AdminAction>,
        user: Pubkey
    ) -> Result<()> {
        let solbox = &mut ctx.accounts.solbox;
        
        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == solbox.owner,
            CustomError::Unauthorized
        );
        
        // Remove from blacklist
        solbox.blacklisted_users.retain(|&x| x != user);
        
        emit!(BlacklistEvent {
            admin: *ctx.accounts.admin.key,
            user,
            action: BlacklistAction::Remove,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

#[account]
pub struct SolBox {
    pub owner: Pubkey,
    pub founder_wallet: Pubkey,
    pub paused: bool,
    pub total_sold: u64,
    pub total_commission_distributed: u64,
    pub referral_count: u64,
    pub config: ContractConfig,
    pub blacklisted_users: Vec<Pubkey>,
    pub referral_relationships: Vec<ReferralRelationship>,
}

#[account]
pub struct User {
    pub key: Pubkey,
    pub current_package: u64,
    pub total_earnings: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContractConfig {
    pub referral_limit: u8,
    pub commission_percentage: u64,
    pub commission_levels: u8,
    pub bonus_percentage: u64,
    pub valid_amounts: Vec<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReferralRelationship {
    pub user: Pubkey,
    pub referrer: Pubkey,
    pub timestamp: i64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 +    // discriminator
                32 +   // owner pubkey
                32 +   // founder_wallet pubkey
                1 +    // paused bool
                8 +    // total_sold
                8 +    // total_commission_distributed
                8 +    // referral_count
                CONFIG_SPACE + // config
                BLACKLIST_SPACE + // blacklisted users
                REFERRAL_RELATIONSHIPS_SPACE // relationships
    )]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub user: Account<'info, User>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpgradePackage<'info> {
    #[account(mut)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub user: Account<'info, User>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyGiftCard<'info> {
    #[account(mut)]
    pub solbox: Account<'info, SolBox>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_account: Account<'info, User>,
    #[account(mut)]
    pub referrer: SystemAccount<'info>,
    #[account(mut)]
    pub referrer_user_account: Account<'info, User>,
    #[account(mut)]
    pub founder: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

// Space allocation constants
pub const CONFIG_SPACE: usize = 1 +  // referral_limit
                               8 +  // commission_percentage
                               1 +  // commission_levels
                               8 +  // bonus_percentage
                               32;  // valid_amounts vector space

pub const BLACKLIST_SPACE: usize = 1000; // Space for blacklisted users
pub const REFERRAL_RELATIONSHIPS_SPACE: usize = 2000; // Space for referral data

// Events
#[event]
pub struct InitializeEvent {
    pub owner: Pubkey,
    pub founder_wallet: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ConfigUpdateEvent {
    pub admin: Pubkey,
    pub new_config: ContractConfig,
    pub timestamp: i64,
}

#[event]
pub struct PauseEvent {
    pub admin: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct PackageUpgradeEvent {
    pub user: Pubkey,
    pub old_package: u64,
    pub new_package: u64,
    pub difference: u64,
    pub timestamp: i64,
}

#[event]
pub struct GiftCardPurchaseEvent {
    pub user: Pubkey,
    pub referrer: Pubkey,
    pub amount: u64,
    pub commission: u64,
    pub founder_share: u64,
    pub timestamp: i64,
}

#[event]
pub struct PackageGrantedEvent {
    pub admin: Pubkey,
    pub user: Pubkey,
    pub package: u64,
    pub timestamp: i64,
}

#[event]
pub struct CommissionConfigEvent {
    pub admin: Pubkey,
    pub new_percentage: u64,
    pub new_levels: u8,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum BlacklistAction {
    Add,
    Remove,
}

#[event]
pub struct BlacklistEvent {
    pub admin: Pubkey,
    pub user: Pubkey,
    pub action: BlacklistAction,
    pub timestamp: i64,
}

#[error_code]
pub enum CustomError {
    #[msg("Contract is paused")]
    ContractPaused,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid gift card amount")]
    InvalidAmount,
    #[msg("Invalid upgrade - new package must be higher")]
    InvalidUpgrade,
    #[msg("Self-referral not allowed")]
    SelfReferralNotAllowed,
    #[msg("Arithmetic error")]
    ArithmeticError,
    #[msg("No spillover position available")]
    NoSpilloverAvailable,
    #[msg("Invalid referrer")]
    InvalidReferrer,
    #[msg("User is blacklisted")]
    UserBlacklisted,
}

// Helper function to find spillover referrer position
fn find_spillover_position(
    relationships: &Vec<ReferralRelationship>,
    referrer: Pubkey,
    limit: u8
) -> Option<Pubkey> {
    let mut referral_counts: HashMap<Pubkey, u8> = HashMap::new();
    
    // Count existing referrals for each referrer
    for relationship in relationships {
        *referral_counts.entry(relationship.referrer).or_insert(0) += 1;
    }
    
    // First try the original referrer if they haven't reached limit
    if referral_counts.get(&referrer).unwrap_or(&0) < &limit {
        return Some(referrer);
    }
    
    // Otherwise find first available referrer
    for relationship in relationships {
        let count = referral_counts.get(&relationship.referrer).unwrap_or(&0);
        if *count < limit {
            return Some(relationship.referrer);
        }
    }
    
    None // No available referrer found
}