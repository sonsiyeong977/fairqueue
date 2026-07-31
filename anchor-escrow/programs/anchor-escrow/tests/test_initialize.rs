use anchor_escrow::state::{EscrowState, EscrowStatus};

#[test]
fn escrow_state_size_matches_layout() {
    assert_eq!(EscrowState::MAX_SIZE, 8 + 32 * 3 + 8 + 1 + 1);
}

#[test]
fn escrow_statuses_are_mutually_exclusive() {
    assert!(EscrowStatus::Pending != EscrowStatus::Released);
    assert!(EscrowStatus::Pending != EscrowStatus::Refunded);
    assert!(EscrowStatus::Released != EscrowStatus::Refunded);
}
