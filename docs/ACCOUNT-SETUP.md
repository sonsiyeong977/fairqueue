# Firebase Accounts

The platform uses Firebase Authentication for email/password accounts. The browser
uses the official Firebase Auth SDK and sends an ID token in the Authorization
header. The server validates the token, including revocation, and derives the UID
from that token. Client-supplied user IDs do not grant access to other accounts.

## Configuration

- Firebase project: `fairqueue-511412`, Spark plan.
- Enable Email/Password authentication.
- Register the storefront hostname and localhost as authorized domains.
- Create the `(default)` Firestore Standard database.
- Keep browser Firestore security rules deny-all: database writes use the server.
- `platform-sim/firebase-web-config.json` contains public web SDK configuration,
  not server credentials. Restrict the web API key to required Firebase APIs.
- Set `FIREBASE_PROJECT_ID=fairqueue-511412` on the platform service only.
- The Cloud Run runtime identity needs `roles/firebaseauth.viewer` and
  `roles/datastore.user` on the Firebase project. Use Application Default
  Credentials; do not download a service account private key.

Local server access additionally requires appropriately authorized Application
Default Credentials, or Firebase emulators. The public web configuration alone
does not give a local server access to Firestore or revoked-user checks.

## Account Flow

1. Sign up with a username, email, and password.
2. Follow the verification email. In My Account, select Check verification.
3. Sign in, connect a buyer wallet, and start a booking.
4. The platform derives queue ownership from the verified Firebase UID.
5. After a completed settlement or refund, the server writes the booking to
   `users/{uid}/bookings/{queueId}`. My bookings reads only that UID's records.

Profiles use `users/{uid}`. Passwords are never written to Firestore or application
logs. Saved events and recently viewed events remain browser-local and keyed by
UID. Existing browser demo profiles and booking records are not authenticated
accounts and are not imported as verified bookings.

If a history write fails after an on-chain payment, the result retains its
transaction links and reports history synchronization as pending. Checking the
existing payment retries the history write; it does not submit another deposit.
That retry currently depends on the platform process retaining the queue entry.

## Operational Scope

These account changes do not migrate seat inventory, queue entries, holds, or
x402 payment recovery records out of process memory. Keep the preview restricted
to controlled Devnet testing until those records have transactional persistence.
Manual simulator mutation endpoints and server-funded payments are disabled when
Firebase account mode is enabled. Buyer wallet signatures are still required.

Firestore's Spark quotas are finite. Cloud Run, Gemini, and other Google Cloud
services have independent pricing; do not attach a billing account to the Spark
project just to enable optional backups.
