const service = process.env.FAIRQUEUE_SERVICE || "platform";

if (service === "settle") {
  require("./agent/settle-server");
} else {
  require("./platform-sim/server");
}
