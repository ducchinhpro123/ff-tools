const { spawn } = require("node:child_process");
const path = require("node:path");

const binDir = path.join(__dirname, "..", "node_modules", ".bin");
const tsxBin = path.join(binDir, process.platform === "win32" ? "tsx.cmd" : "tsx");
const env = {
  ...process.env,
  FF_TOOLS_DEV_CLIENT: "1",
  PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
};

const child = spawn(
  process.platform === "win32" ? "cmd.exe" : tsxBin,
  process.platform === "win32" ? ["/d", "/s", "/c", "tsx.cmd watch src/server.ts"] : ["watch", "src/server.ts"],
  {
    env,
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
