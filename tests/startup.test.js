const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

test("production entrypoint listens on PORT and serves the platform", async (t) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, ["start.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), FAIRQUEUE_SERVICE: "platform" },
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });

  let health;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(child.exitCode, null, "Platform exited before opening its port");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      health = await response.json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(health?.ok, true);
  assert.equal(health.service, "fairqueue-platform-sim");
});
