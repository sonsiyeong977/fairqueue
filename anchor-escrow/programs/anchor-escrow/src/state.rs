use anchor_lang::prelude::*;

#[account]
pub struct EscrowState {
    pub order_id: u64,
    pub user: Pubkey,
    pub seller: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub status: EscrowStatus,
    pub bump: u8,
}

impl EscrowState {
    pub const MAX_SIZE: usize = 8 + 32 * 3 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Refunded,
}
