use anchor_lang::prelude::*;

use crate::{EscrowError, EscrowState, EscrowStatus, ESCROW_SEED};

pub fn handle_release(ctx: Context<Release>) -> Result<()> {
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
        escrow_state.seller,
        ctx.accounts.seller.key(),
        EscrowError::SellerMismatch
    );

    let amount = escrow_state.amount;
    let order_id = escrow_state.order_id;
    let seller = escrow_state.seller;

    let escrow_info = ctx.accounts.escrow_state.to_account_info();
    let rent_exempt_minimum = Rent::get()?.minimum_balance(escrow_info.data_len());
    let available = escrow_info.lamports().saturating_sub(rent_exempt_minimum);

    require!(available >= amount, EscrowError::InsufficientEscrowBalance);

    **escrow_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += amount;

    let escrow_state = &mut ctx.accounts.escrow_state;
    escrow_state.status = EscrowStatus::Released;

    msg!(
        "Escrow released: order_id={}, seller={}, amount={}",
        order_id,
        seller,
        amount
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Checked against escrow_state.seller before lamports are moved.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.user.as_ref(), &escrow_state.order_id.to_le_bytes()],
        bump = escrow_state.bump
    )]
    pub escrow_state: Account<'info, EscrowState>,
}
