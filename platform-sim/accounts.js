function createAccounts({ projectId, auth, db, webConfig }) {
  const enabled = Boolean(projectId);
  if (enabled && (!auth || !db)) {
    const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
    const { getAuth } = require("firebase-admin/auth");
    const { getFirestore } = require("firebase-admin/firestore");
    const name = `accounts-${projectId}`;
    const admin = getApps().find((app) => app.name === name) ||
      initializeApp({ credential: applicationDefault(), projectId }, name);
    auth = getAuth(admin);
    db = getFirestore(admin);
  }
  const publicUser = (identity) => ({
    uid: identity.uid, email: identity.email || "", name: identity.name || "Fan",
    emailVerified: Boolean(identity.email_verified),
  });
  const profileRef = (uid) => db.collection("users").doc(uid);
  async function requireUser(req, res, next) {
    res.setHeader("Cache-Control", "no-store");
    if (!enabled) return res.status(503).json({ error: "Account service is not configured" });
    const match = /^Bearer (\S+)$/.exec(req.get("authorization") || "");
    if (!match) return res.status(401).json({ error: "Log in to continue" });
    try {
      req.identity = await auth.verifyIdToken(match[1], true);
      req.user = publicUser(req.identity);
      next();
    } catch (error) {
      const invalid = ["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired",
        "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"].includes(error.code);
      res.status(invalid ? 401 : 503).json({
        error: invalid ? "Your session expired. Log in again." : "Account verification is unavailable. Try again later.",
      });
    }
  }
  function register(app) {
    app.get("/auth/config", (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ enabled, config: enabled ? webConfig : null });
    });
    app.use("/account", requireUser);
    app.get("/account/me", async (req, res) => {
      try {
        const profile = await profileRef(req.user.uid).get();
        res.json({ user: { ...req.user, name: profile.data()?.name || req.user.name } });
      } catch { res.status(503).json({ error: "Your account could not be loaded" }); }
    });
    app.post("/account/profile", async (req, res) => {
      const name = String(req.identity.name || "").trim();
      if (!name || name.length > 60) return res.status(400).json({ error: "Set a username of 1 to 60 characters" });
      try {
        await profileRef(req.user.uid).set({ name, email: req.user.email, updatedAt: new Date().toISOString() }, { merge: true });
        res.json({ user: { ...req.user, name } });
      } catch { res.status(503).json({ error: "Your profile could not be saved. Try again." }); }
    });
    app.get("/account/bookings", async (req, res) => {
      try {
        const snapshot = await profileRef(req.user.uid).collection("bookings")
          .orderBy("completedAt", "desc").limit(100).get();
        res.json({ bookings: snapshot.docs.map((doc) => doc.data()) });
      } catch { res.status(503).json({ error: "Your bookings could not be loaded. Try again." }); }
    });
  }
  async function saveResult(uid, record, entry) {
    if (!enabled || entry.historySaved) return;
    try {
      await profileRef(uid).collection("bookings").doc(record.queueId).set(record);
      entry.historySaved = true;
      delete entry.completed_result.history_sync_pending;
    } catch {
      // Never turn a completed on-chain payment into a request for another deposit.
      entry.completed_result.history_sync_pending = true;
    }
  }
  function protectPlatform(app, getState) {
    if (!enabled) return;
    app.use((req, res, next) => {
      const protectedPath = /^\/(queue|demo|purchase|refund|settlement|admin)(\/|$)/.test(req.path) ||
        req.path === "/parse-condition" || req.path === "/wallet/balance";
      const controlPath = req.path.startsWith("/admin/") ||
        ["/queue/advance", "/queue/offer", "/purchase/confirm", "/settlement/mark-paid", "/refund/request", "/refund/mark-refunded"].includes(req.path) ||
        (req.method !== "GET" && req.path.startsWith("/seats/"));
      if (controlPath) return res.status(403).json({ error: "Manual simulator controls are disabled" });
      if (!protectedPath) return next();
      requireUser(req, res, () => {
        if (req.path === "/queue/join") {
          if (!req.user.emailVerified) return res.status(403).json({ error: "Verify your email before joining a booking queue" });
          req.body.user_id = req.user.uid;
        } else if (req.path.startsWith("/queue/") || req.path === "/demo/settle-offer") {
          const query = req.method === "GET" ? req.query : req.body;
          const entry = typeof query.event === "string" && typeof query.queue_id === "string"
            ? getState().events[query.event]?.queue?.find((item) => item.queue_id === query.queue_id) : null;
          if (!entry || entry.user_id !== req.user.uid) return res.status(404).json({ error: "Queue entry not found" });
        }
        if (req.path === "/demo/settle-offer" && req.body.payment_mode !== "x402") {
          return res.status(403).json({ error: "Use your connected Devnet wallet for payment" });
        }
        next();
      });
    });
  }
  return { enabled, register, requireUser, saveResult, protectPlatform };
}

module.exports = { createAccounts };
