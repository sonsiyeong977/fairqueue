pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("618w9LmnDRNpmrTboeYfWgfgSDaDzghRzA577ciwjJuj");

#[program]
pub mod anchor_escrow {
    use super::*;

    pub fn deposit(
        ctx: Context<Deposit>,
        order_id: u64,
        amount: u64,
        seller: Pubkey,
    ) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, order_id, amount, seller)
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        crate::instructions::release::handle_release(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        crate::instructions::refund::handle_refund(ctx)
    }
}
