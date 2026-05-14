import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  loadManagedGroups,
  loadManagedPlayers,
  loadOverlayConfig,
  loadPlayerRoster,
  loadTeamConfig,
  normalizeManagedGroups,
  normalizeManagedPlayers,
  normalizeOverlayConfig,
  saveManagedGroups,
  saveManagedPlayers,
  saveOverlayConfig
} from "./config";
import { DEFAULT_PORT } from "./defaults";
import { LogTailer } from "./logTailer";
import { publicDir, projectRoot } from "./paths";
import { ScoreboardState } from "./scoreboard";
import type { ManagedGroup, ManagedPlayer, OverlayConfig, PublicConfig, PublicState, TeamConfig } from "./types";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const state = new ScoreboardState();

let teamConfig: TeamConfig[] = [];
let overlayConfig: OverlayConfig;
let groups: ManagedGroup[] = [];
let players: ManagedPlayer[] = [];
let lastTeamsMtime = 0;
let tailer: LogTailer | null = null;

// Accept Windows absolute/UNC paths and reject characters that cannot appear in file names.
const FILE_PATH_REGEX = /^(?!.*[<>|?*\r\n])(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]?)[^<>:"|?*\r\n]+(?:[\\/][^<>:"|?*\r\n]+)*$/;

app.use(express.json({ limit: "64kb" }));
app.use("/assets", express.static(path.join(projectRoot, "assets")));
app.use(express.static(publicDir));

function normalizeFilePath(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();
}

function publicConfig(): PublicConfig {
  return {
    teams: teamConfig,
    overlay: overlayConfig
  };
}

function publicState(): PublicState {
  return state.toPublicState();
}

function publicLogSource(): { path: string | null; mode: "auto" | "file" } {
  const selectedPath = tailer?.getSelectedLog() || null;
  return {
    path: selectedPath,
    mode: selectedPath ? "file" : "auto"
  };
}

function broadcast(type: "state" | "config"): void {
  const payload = JSON.stringify({
    type,
    state: publicState(),
    config: publicConfig(),
    logSource: publicLogSource()
  });

  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

async function reloadTeamsIfChanged(force = false): Promise<void> {
  const teamsPath = path.join(projectRoot, "config", "teams.csv");
  const stat = await fs.promises.stat(teamsPath).catch(() => null);
  const mtime = stat?.mtimeMs || 0;
  if (!force && mtime === lastTeamsMtime) return;

  lastTeamsMtime = mtime;
  teamConfig = await loadTeamConfig();
  state.setTeamConfig(teamConfig);
  broadcast("config");
}

app.get("/api/state", (_request, response) => {
  response.json(publicState());
});

app.get("/api/config", (_request, response) => {
  response.json(publicConfig());
});

app.post("/api/config", async (request, response) => {
  overlayConfig = normalizeOverlayConfig(request.body as Partial<OverlayConfig>);
  await saveOverlayConfig(overlayConfig);
  broadcast("config");
  response.json(publicConfig());
});

app.get("/api/log-source", (_request, response) => {
  response.json(publicLogSource());
});

app.get("/api/groups", (_request, response) => {
  response.json(groups);
});

app.post("/api/groups", async (request, response) => {
  groups = normalizeManagedGroups(request.body);
  await saveManagedGroups(groups);
  response.json(groups);
});

app.get("/api/players", (_request, response) => {
  response.json(players);
});

app.post("/api/players", async (request, response) => {
  players = normalizeManagedPlayers(request.body);
  await saveManagedPlayers(players);
  state.setPlayerRoster(players);
  tailer?.reload();
  await tailer?.tick();
  broadcast("state");
  response.json(players);
});

app.post("/api/log-source", async (request, response) => {
  const requestedPath = request.body?.path;
  if (requestedPath !== null && requestedPath !== undefined && typeof requestedPath !== "string") {
    response.status(400).json({ error: "path must be a string, null, or omitted" });
    return;
  }

  const selectedPath = normalizeFilePath(requestedPath) || null;
  if (selectedPath && !path.isAbsolute(selectedPath)) {
    response.status(400).json({ error: "Enter the full absolute path to the debugger log file." });
    return;
  }

  if (selectedPath && !FILE_PATH_REGEX.test(selectedPath)) {
    response.status(400).json({ error: "The debugger log path contains invalid filename characters." });
    return;
  }

  tailer?.useLogFile(selectedPath);
  await tailer?.tick();
  broadcast("state");
  response.json(publicLogSource());
});

app.get("/", (_request, response) => {
  response.redirect("/overlay");
});

app.get(["/overlay", "/control"], (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "hello",
      state: publicState(),
      config: publicConfig(),
      logSource: publicLogSource()
    })
  );
});

async function main(): Promise<void> {
  overlayConfig = await loadOverlayConfig();
  groups = await loadManagedGroups();
  players = await loadManagedPlayers();
  await reloadTeamsIfChanged(true);
  state.setPlayerRoster(players.length > 0 ? players : await loadPlayerRoster());

  tailer = new LogTailer(state, () => broadcast("state"));
  tailer.start();
  setInterval(() => void reloadTeamsIfChanged(), 1000);

  const port = Number(process.env.PORT || DEFAULT_PORT);
  server.listen(port, () => {
    console.log(`Free Fire OBS overlay listening at http://localhost:${port}/overlay`);
    console.log(`Control panel available at http://localhost:${port}/control`);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
