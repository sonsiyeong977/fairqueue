use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

use crate::{EscrowError, EscrowState, EscrowStatus, ESCROW_SEED};

pub fn handle_deposit(
    ctx: Context<Deposit>,
    order_id: u64,
    amount: u64,
    seller: Pubkey,
) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    let transfer_ix = system_instruction::transfer(
        &ctx.accounts.user.key(),
        &ctx.accounts.escrow_state.key(),
        amount,
    );

    invoke(
        &transfer_ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.escrow_state.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    let escrow_state = &mut ctx.accounts.escrow_state;
    escrow_state.order_id = order_id;
    escrow_state.user = ctx.accounts.user.key();
    escrow_state.seller = seller;
    escrow_state.authority = ctx.accounts.authority.key();
    escrow_state.amount = amount;
    escrow_state.status = EscrowStatus::Pending;
    escrow_state.bump = ctx.bumps.escrow_state;

    msg!(
        "Escrow deposited: order_id={}, user={}, seller={}, amount={}",
        order_id,
        escrow_state.user,
        escrow_state.seller,
        amount
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Stored as the backend authority that can later release or refund.
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + EscrowState::MAX_SIZE,
        seeds = [ESCROW_SEED, user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    pub system_program: Program<'info, System>,
}
