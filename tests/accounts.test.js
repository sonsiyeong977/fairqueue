const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAccounts } = require("../platform-sim/accounts");

test("Firebase identity owns account reads and writes, not client user IDs", async (t) => {
  const storage = new Map();
  const profile = new Map();
  const db = { collection: () => ({ doc: (uid) => ({
    get: async () => ({ data: () => profile.get(uid) }),
    set: async (value) => profile.set(uid, value),
    collection: () => ({
      doc: (id) => ({ set: async (value) => {
        if (!storage.has(uid)) storage.set(uid, new Map());
        storage.get(uid).set(id, value);
      } }),
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [...(storage.get(uid)?.values() || [])].map((value) => ({ data: () => value })) }) }) }),
    }),
  }) }) };
  const revoked = new Set();
  const accounts = createAccounts({ projectId: "test", db, webConfig: { projectId: "test" }, auth: {
    verifyIdToken: async (token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      if (!["alice", "bob"].includes(token) || revoked.has(token)) {
        throw Object.assign(new Error("invalid"), { code: "auth/id-token-revoked" });
      }
      return { uid: token, name: token.toUpperCase(), email: `${token}@example.com`, email_verified: token === "alice" };
    },
  } });
  const app = express();
  app.use(express.json());
  accounts.register(app);
  accounts.protectPlatform(app, () => ({ events: { concert: { queue: [{ queue_id: "queue-a", user_id: "alice" }] } } }));
  app.post("/queue/join", (req, res) => res.json({ user_id: req.body.user_id }));
  app.get("/queue/result", (req, res) => res.json({ result: "private" }));
  app.post("/demo/settle-offer", (req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, user, body) => fetch(base + path, {
    headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), "Content-Type": "application/json" },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });

  assert.equal((await call("/account/me")).status, 401);
  assert.equal((await call("/account/me", "fake")).status, 401);
  const me = await (await call("/account/me?user_id=bob", "alice")).json();
  assert.equal(me.user.uid, "alice");
  const updated = await call("/account/profile", "alice", { user_id: "bob", name: "FORGED" });
  assert.equal(updated.status, 200);
  assert.equal(profile.get("alice").name, "ALICE");
  assert.equal(profile.has("bob"), false);
  const joined = await (await call("/queue/join", "alice", { user_id: "bob", event: "concert" })).json();
  assert.equal(joined.user_id, "alice");
  assert.equal((await call("/queue/join", "bob", { event: "concert" })).status, 403);
  assert.equal((await call("/queue/result?event=concert&queue_id=queue-a", "bob")).status, 404);
  assert.equal((await call("/queue/result?event=concert&queue_id=queue-a", "alice")).status, 200);
  assert.equal((await call("/demo/settle-offer", "alice", { event: "concert", queue_id: "queue-a", payment_mode: "demo" })).status, 403);
  assert.equal((await call("/demo/settle-offer", "alice", { event: "concert", queue_id: "queue-a", payment_mode: "x402" })).status, 200);
  assert.equal((await call("/admin/scenario", "alice", { event: "concert" })).status, 403);

  const entry = { completed_result: {} };
  await accounts.saveResult("alice", { queueId: "queue-a", completedAt: "2026-10-12T00:00:00Z" }, entry);
  assert.equal(entry.historySaved, true);
  const alice = await (await call("/account/bookings?user_id=bob", "alice")).json();
  const bob = await (await call("/account/bookings?user_id=alice", "bob")).json();
  assert.equal(alice.bookings.length, 1);
  assert.equal(bob.bookings.length, 0);
  revoked.add("alice");
  assert.equal((await call("/account/me", "alice")).status, 401);
});

test("a failed history write never makes a completed payment eligible for another deposit", async () => {
  const accounts = createAccounts({ projectId: "test", auth: {}, db: {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set: async () => { throw new Error("database unavailable"); } }) }) }) }),
  } });
  const entry = { completed_result: { settle_result: { fund_tx: "deposit", settle_tx: "release" } } };
  await accounts.saveResult("alice", { queueId: "queue-a" }, entry);
  assert.equal(entry.completed_result.history_sync_pending, true);
  assert.equal(entry.completed_result.settle_result.settle_tx, "release");
});
