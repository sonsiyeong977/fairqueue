use {
    anchor_escrow::state::{EscrowState, EscrowStatus},
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const DEPOSIT_AMOUNT: u64 = 100_000_000;

struct TestContext {
    svm: LiteSVM,
    user: Keypair,
    authority: Keypair,
    seller: Keypair,
}

fn setup() -> TestContext {
    let program_id = anchor_escrow::id();
    let user = Keypair::new();
    let authority = Keypair::new();
    let seller = Keypair::new();
    let mut svm = LiteSVM::new();

    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/anchor_escrow.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&user.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    TestContext {
        svm,
        user,
        authority,
        seller,
    }
}

fn escrow_pda(user: Pubkey, order_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"escrow", user.as_ref(), &order_id.to_le_bytes()],
        &anchor_escrow::id(),
    )
    .0
}

fn send_ix(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> bool {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn deposit_ix(user: Pubkey, authority: Pubkey, seller: Pubkey, order_id: u64) -> Instruction {
    Instruction::new_with_bytes(
        anchor_escrow::id(),
        &anchor_escrow::instruction::Deposit {
            order_id,
            amount: DEPOSIT_AMOUNT,
            seller,
        }
        .data(),
        anchor_escrow::accounts::Deposit {
            user,
            authority,
            escrow_state: escrow_pda(user, order_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn release_ix(authority: Pubkey, seller: Pubkey, user: Pubkey, order_id: u64) -> Instruction {
    Instruction::new_with_bytes(
        anchor_escrow::id(),
        &anchor_escrow::instruction::Release {}.data(),
        anchor_escrow::accounts::Release {
            authority,
            seller,
            escrow_state: escrow_pda(user, order_id),
        }
        .to_account_metas(None),
    )
}

fn refund_ix(authority: Pubkey, user: Pubkey, order_id: u64) -> Instruction {
    Instruction::new_with_bytes(
        anchor_escrow::id(),
        &anchor_escrow::instruction::Refund {}.data(),
        anchor_escrow::accounts::Refund {
            authority,
            user,
            escrow_state: escrow_pda(user, order_id),
        }
        .to_account_metas(None),
    )
}

fn read_escrow_state(svm: &LiteSVM, user: Pubkey, order_id: u64) -> EscrowState {
    let escrow_account = svm.get_account(&escrow_pda(user, order_id)).unwrap();
    let mut data: &[u8] = &escrow_account.data;
    EscrowState::try_deserialize(&mut data).unwrap()
}

#[test]
fn deposit_then_release_settles_to_seller() {
    let mut ctx = setup();
    let order_id = 1;
    let seller_before = ctx.svm.get_balance(&ctx.seller.pubkey()).unwrap_or(0);

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.user,
        deposit_ix(
            ctx.user.pubkey(),
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            order_id,
        ),
    ));

    let pending_state = read_escrow_state(&ctx.svm, ctx.user.pubkey(), order_id);
    assert!(pending_state.status == EscrowStatus::Pending);
    assert_eq!(pending_state.amount, DEPOSIT_AMOUNT);

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.authority,
        release_ix(
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            ctx.user.pubkey(),
            order_id,
        ),
    ));

    let released_state = read_escrow_state(&ctx.svm, ctx.user.pubkey(), order_id);
    let seller_after = ctx.svm.get_balance(&ctx.seller.pubkey()).unwrap();

    assert!(released_state.status == EscrowStatus::Released);
    assert_eq!(seller_after - seller_before, DEPOSIT_AMOUNT);
}

#[test]
fn deposit_then_refund_returns_to_user() {
    let mut ctx = setup();
    let order_id = 2;
    let user_after_airdrop = ctx.svm.get_balance(&ctx.user.pubkey()).unwrap();

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.user,
        deposit_ix(
            ctx.user.pubkey(),
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            order_id,
        ),
    ));

    let user_after_deposit = ctx.svm.get_balance(&ctx.user.pubkey()).unwrap();
    assert!(user_after_deposit < user_after_airdrop);

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.authority,
        refund_ix(ctx.authority.pubkey(), ctx.user.pubkey(), order_id),
    ));

    let refunded_state = read_escrow_state(&ctx.svm, ctx.user.pubkey(), order_id);
    let user_after_refund = ctx.svm.get_balance(&ctx.user.pubkey()).unwrap();

    assert!(refunded_state.status == EscrowStatus::Refunded);
    assert!(user_after_refund >= user_after_deposit + DEPOSIT_AMOUNT);
}

#[test]
fn release_and_refund_are_mutually_exclusive() {
    let mut ctx = setup();
    let release_order_id = 3;
    let refund_order_id = 4;

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.user,
        deposit_ix(
            ctx.user.pubkey(),
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            release_order_id,
        ),
    ));
    assert!(send_ix(
        &mut ctx.svm,
        &ctx.authority,
        release_ix(
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            ctx.user.pubkey(),
            release_order_id,
        ),
    ));
    assert!(!send_ix(
        &mut ctx.svm,
        &ctx.authority,
        refund_ix(ctx.authority.pubkey(), ctx.user.pubkey(), release_order_id),
    ));

    assert!(send_ix(
        &mut ctx.svm,
        &ctx.user,
        deposit_ix(
            ctx.user.pubkey(),
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            refund_order_id,
        ),
    ));
    assert!(send_ix(
        &mut ctx.svm,
        &ctx.authority,
        refund_ix(ctx.authority.pubkey(), ctx.user.pubkey(), refund_order_id),
    ));
    assert!(!send_ix(
        &mut ctx.svm,
        &ctx.authority,
        release_ix(
            ctx.authority.pubkey(),
            ctx.seller.pubkey(),
            ctx.user.pubkey(),
            refund_order_id,
        ),
    ));
}
