const service = process.env.FAIRQUEUE_SERVICE || "platform";

if (service === "settle") {
  require("./agent/settle-server");
} else {
  const { app } = require("./platform-sim/server");
  const port = Number(process.env.PORT || 3001);
  app.listen(port, "0.0.0.0", () => {
    console.log(`FairQueue platform running on port ${port}`);
  });
}
