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
import { isAbsoluteLogPath, isValidLogPath } from "./logPath";
import { LogTailer } from "./logTailer";
import { fetchAggregatedMatchStats, fetchMatchStats, normalizeMatchIds } from "./matchStats";
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

function matchIdsFromQuery(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeMatchIds(value.map((item) => String(item)));
  }
  return normalizeMatchIds(String(value || ""));
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

app.get("/api/match-stats", async (request, response) => {
  const matchId = String(request.query.matchId || "").trim();
  if (!matchId) {
    response.status(400).json({ status: "error", message: "matchId là bắt buộc" });
    return;
  }

  const stats = await fetchMatchStats(matchId);
  response.status(stats.status === "success" ? 200 : 502).json(stats);
});

app.get("/api/match-stats/batch", async (request, response) => {
  const matchIds = matchIdsFromQuery(request.query.matchIds);
  if (matchIds.length === 0) {
    response.status(400).json({ status: "error", message: "matchIds là bắt buộc" });
    return;
  }
  if (matchIds.length > 8) {
    response.status(400).json({ status: "error", message: "Không thể yêu cầu quá 8 ID trận mỗi lần" });
    return;
  }

  const stats = await fetchMatchStats(matchIds);
  response.status(stats.status === "success" ? 200 : 502).json(stats);
});

app.post("/api/match-stats/apply", async (request, response) => {
  const groupId = String(request.body?.groupId || "").trim();
  const selectedGroup = groupId ? groups.find((group) => group.groupId === groupId) : undefined;
  if (groupId && !selectedGroup) {
    response.status(404).json({ status: "error", message: "Không tìm thấy nhóm" });
    return;
  }

  const requestMatchIds = Array.isArray(request.body?.matchIds) ? request.body.matchIds : [];
  const matchIds = selectedGroup
    ? selectedGroup.matches.map((match) => match.matchId)
    : requestMatchIds.map((matchId: unknown) => String(matchId || ""));
  const teamNames = selectedGroup
    ? selectedGroup.teamNames
    : Array.isArray(request.body?.teamNames)
      ? request.body.teamNames.map((teamName: unknown) => String(teamName || "").trim()).filter(Boolean)
      : [];

  const normalizedMatchIds = normalizeMatchIds(matchIds);
  if (normalizedMatchIds.length === 0 && teamNames.length === 0) {
    response.status(400).json({ status: "error", message: "Không có ID trận hoặc tên đội để áp dụng" });
    return;
  }

  const aggregate = await fetchAggregatedMatchStats(normalizedMatchIds, teamNames);
  state.setMatchStatsBase(aggregate.teams);
  broadcast("state");

  response.json({
    status: aggregate.failedBatches > 0 ? "partial" : "success",
    groupId: selectedGroup?.groupId || null,
    matchIdCount: normalizedMatchIds.length,
    matchCount: aggregate.matchCount,
    failedBatches: aggregate.failedBatches,
    teams: aggregate.teams
  });
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
    response.status(400).json({ error: "Đường dẫn phải là chuỗi, null hoặc để trống" });
    return;
  }

  const selectedPath = normalizeFilePath(requestedPath) || null;
  if (selectedPath && !isAbsoluteLogPath(selectedPath)) {
    response.status(400).json({ error: "Nhập đường dẫn tuyệt đối đầy đủ đến file log debugger." });
    return;
  }

  if (selectedPath && !isValidLogPath(selectedPath)) {
    response.status(400).json({ error: "Đường dẫn log debugger chứa ký tự tên file không hợp lệ." });
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
  const indexHtml = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`Lỗi: không tìm thấy file build tại ${publicDir}`);
    console.error("Chạy 'npm run build' trước, sau đó khởi động server.");
    process.exitCode = 1;
    return;
  }

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
    console.log(`Overlay OBS Free Fire đang chạy tại http://localhost:${port}/overlay`);
    console.log(`Bảng điều khiển tại http://localhost:${port}/control`);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
