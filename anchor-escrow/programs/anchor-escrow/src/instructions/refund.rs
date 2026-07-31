use anchor_lang::prelude::*;

use crate::{EscrowError, EscrowState, EscrowStatus, ESCROW_SEED};

pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let escrow_state = &ctx.accounts.escrow_state;

    require!(
        escrow_state.status == EscrowStatus::Pending,
        EscrowError::AlreadyProcessed
    );
    require_keys_eq!(
        escrow_state.authority,
        ctx.accounts.authority.key(),
        EscrowError::Unauthorized
    );
    require_keys_eq!(
        escrow_state.user,
        ctx.accounts.user.key(),
        EscrowError::UserMismatch
    );

    let amount = escrow_state.amount;
    let order_id = escrow_state.order_id;
    let user = escrow_state.user;

    let escrow_info = ctx.accounts.escrow_state.to_account_info();
    let rent_exempt_minimum = Rent::get()?.minimum_balance(escrow_info.data_len());
    let available = escrow_info.lamports().saturating_sub(rent_exempt_minimum);

    require!(available >= amount, EscrowError::InsufficientEscrowBalance);

    **escrow_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

    let escrow_state = &mut ctx.accounts.escrow_state;
    escrow_state.status = EscrowStatus::Refunded;

    msg!(
        "Escrow refunded: order_id={}, user={}, amount={}",
        order_id,
        user,
        amount
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Checked against escrow_state.user before lamports are moved.
    #[account(mut)]
    pub user: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.user.as_ref(), &escrow_state.order_id.to_le_bytes()],
        bump = escrow_state.bump
    )]
    pub escrow_state: Account<'info, EscrowState>,
}
