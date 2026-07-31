use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Deposit amount must be greater than zero.")]
    InvalidAmount,
    #[msg("This escrow has already been released or refunded.")]
    AlreadyProcessed,
    #[msg("Only the escrow authority can perform this action.")]
    Unauthorized,
    #[msg("The provided seller account does not match the escrow seller.")]
    SellerMismatch,
    #[msg("The provided user account does not match the escrow user.")]
    UserMismatch,
    #[msg("The escrow account does not have enough withdrawable balance.")]
    InsufficientEscrowBalance,
}
