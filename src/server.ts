import express from "express";
import { randomUUID } from "node:crypto";
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
import { assetsDir, publicDir, teamsCsvPath } from "./paths";
import { ScoreboardState } from "./scoreboard";
import type { ManagedGroup, ManagedPlayer, OverlayConfig, PublicConfig, PublicLogEntry, PublicState, TeamConfig } from "./types";

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
let currentListenerID: string | null = null;
let logs: PublicLogEntry[] = [];
let logCounter = 0;
let teamsReloadTimer: NodeJS.Timeout | null = null;
let isServerStarted = false;
let activePort = 0;
let activeMatchStatsContext: { groupId: string | null; matchIds: string[]; teamNames: string[] } | null = null;
let refreshInFlight = false;

app.use(express.json({ limit: "64kb" }));
app.use("/assets", express.static(assetsDir));
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
  return {
    ...state.toPublicState(),
    logs
  };
}

function publicLogSource(): { path: string | null; mode: "auto" | "file"; running: boolean; currentPath: string | null } {
  const selectedPath = tailer?.getSelectedLog() || null;
  return {
    path: selectedPath,
    mode: selectedPath ? "file" : "auto",
    running: Boolean(tailer?.isRunning()),
    currentPath: tailer?.getCurrentLog() || null
  };
}

function pushLog(
  message: string,
  level: PublicLogEntry["level"] = "info",
  source: PublicLogEntry["source"] = "server"
): void {
  logs.push({
    id: `${++logCounter}`,
    timestamp: new Date().toISOString(),
    source,
    level,
    message
  });
  logs = logs.slice(-300);
}

function publicListenerState() {
  return {
    listenerID: currentListenerID,
    running: Boolean(tailer?.isRunning()),
    logSource: publicLogSource()
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
  const stat = await fs.promises.stat(teamsCsvPath).catch(() => null);
  const mtime = stat?.mtimeMs || 0;
  if (!force && mtime === lastTeamsMtime) return;

  lastTeamsMtime = mtime;
  teamConfig = await loadTeamConfig();
  state.setTeamConfig(teamConfig);
  broadcast("config");
}

async function refreshMatchStatsBase(reason: string): Promise<void> {
  if (!activeMatchStatsContext) return;
  if (refreshInFlight) return;

  const { matchIds, teamNames } = activeMatchStatsContext;
  if (matchIds.length === 0 && teamNames.length === 0) return;

  refreshInFlight = true;
  try {
    const aggregate = await fetchAggregatedMatchStats(matchIds, teamNames);
    state.setMatchStatsBase(aggregate.teams);

    const detail = `${aggregate.matchCount} trận, ${aggregate.teams.length} đội${
      aggregate.failedBatches ? `, lỗi ${aggregate.failedBatches} lô` : ""
    }`;
    pushLog(`Auto-cập nhật điểm trận (${reason}): ${detail}`, aggregate.failedBatches ? "warn" : "success");
    broadcast("state");
  } catch (error) {
    pushLog(`Auto-cập nhật điểm trận (${reason}) lỗi: ${String(error)}`, "warn");
    broadcast("state");
  } finally {
    refreshInFlight = false;
  }
}

app.get("/api/state", (_request, response) => {
  response.json(publicState());
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    message: "Server đang chạy",
    timestamp: new Date().toISOString(),
    listener: publicListenerState()
  });
});

app.get("/api/logs", (_request, response) => {
  response.json(logs);
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
  activeMatchStatsContext = {
    groupId: selectedGroup?.groupId || null,
    matchIds: normalizedMatchIds,
    teamNames
  };
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

app.post("/create-listener", async (request, response) => {
  const filePath = normalizeFilePath(request.body?.filePath);
  const selectedGroupId = String(request.body?.selectedGroupId || "").trim();

  if (!filePath) {
    response.status(400).json({ status: "error", message: "filePath là bắt buộc" });
    return;
  }
  if (!isAbsoluteLogPath(filePath) || !isValidLogPath(filePath)) {
    response.status(400).json({ status: "error", message: "filePath không hợp lệ" });
    return;
  }

  if (Array.isArray(request.body?.groups)) {
    groups = normalizeManagedGroups(request.body.groups);
    await saveManagedGroups(groups);
  }
  const payloadPlayers = request.body?.global?.players ?? request.body?.players;
  if (Array.isArray(payloadPlayers)) {
    players = normalizeManagedPlayers(payloadPlayers);
    await saveManagedPlayers(players);
    state.setPlayerRoster(players);
  }

  const selectedGroup = selectedGroupId ? groups.find((group) => group.groupId === selectedGroupId) : groups[0];
  currentListenerID = randomUUID();
  tailer?.stop();
  tailer?.useLogFile(filePath);

  if (selectedGroup) {
    const groupMatchIds = normalizeMatchIds(selectedGroup.matches.map((match) => match.matchId));
    activeMatchStatsContext = {
      groupId: selectedGroup.groupId,
      matchIds: groupMatchIds,
      teamNames: [...selectedGroup.teamNames]
    };
  } else {
    activeMatchStatsContext = null;
  }

  pushLog(`Tạo listener ${currentListenerID}`, "success");
  broadcast("state");

  response.json({
    status: "ok",
    message: "Tạo listener thành công",
    listenerID: currentListenerID,
    groupId: selectedGroup?.groupId || null,
    matchIdCount: selectedGroup?.matches.length || 0,
    teamNameCount: selectedGroup?.teamNames.length || 0
  });
});

app.post("/start-listener", async (request, response) => {
  const listenerID = String(request.body?.listenerID || "").trim();
  if (!listenerID || listenerID !== currentListenerID) {
    response.status(400).json({ status: "error", message: "listenerID không hợp lệ" });
    return;
  }

  tailer?.start();
  await tailer?.tick();
  // Kick off an initial pull so basePoints is populated even before the first
  // OnTeamScoreInited line arrives. Subsequent fetches are driven by the
  // ScoreboardState onMatchStart hook.
  if (activeMatchStatsContext) {
    void refreshMatchStatsBase("start-listener");
  }
  broadcast("state");
  response.json({ status: "ok", message: "Đã start listener", ...publicListenerState() });
});

app.post("/stop-listener", (request, response) => {
  const listenerID = String(request.body?.listenerID || "").trim();
  if (!listenerID || listenerID !== currentListenerID) {
    response.status(400).json({ status: "error", message: "listenerID không hợp lệ" });
    return;
  }

  tailer?.stop();
  broadcast("state");
  response.json({ status: "ok", message: "Đã dừng listener", ...publicListenerState() });
});

app.post("/kill-listener", (request, response) => {
  const listenerID = String(request.body?.listenerID || "").trim();
  if (!listenerID || listenerID !== currentListenerID) {
    response.status(400).json({ status: "error", message: "listenerID không hợp lệ" });
    return;
  }

  tailer?.stop();
  tailer?.useLogFile(null);
  currentListenerID = null;
  broadcast("state");
  response.json({ status: "ok", message: "Đã hủy listener", ...publicListenerState() });
});

app.get("/", (_request, response) => {
  response.redirect("/overlay");
});

app.get(["/overlay", "/control", "/winrate", "/eliminated", "/terminal", "/match-details"], (_request, response) => {
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

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

export async function stopServer(): Promise<void> {
  tailer?.stop();
  tailer = null;

  if (teamsReloadTimer) {
    clearInterval(teamsReloadTimer);
    teamsReloadTimer = null;
  }

  for (const client of wss.clients) {
    client.close();
  }

  if (!isServerStarted) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  isServerStarted = false;
  activePort = 0;
}

export async function startServer(port = Number(process.env.PORT || DEFAULT_PORT)): Promise<StartedServer> {
  if (isServerStarted) {
    return {
      port: activePort,
      close: stopServer
    };
  }

  const indexHtml = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Không tìm thấy file build tại ${publicDir}. Chạy 'npm run build' trước.`);
  }

  overlayConfig = await loadOverlayConfig();
  groups = await loadManagedGroups();
  players = await loadManagedPlayers();
  await reloadTeamsIfChanged(true);
  state.setPlayerRoster(players.length > 0 ? players : await loadPlayerRoster());

  pushLog("Server khởi động", "success");
  state.setOnMatchStart(() => {
    void refreshMatchStatsBase("new-match");
  });
  tailer = new LogTailer(state, () => broadcast("state"), undefined, undefined, (message, level = "info") => {
    pushLog(message, level, "tailer");
    broadcast("state");
  });
  tailer.start();
  teamsReloadTimer = setInterval(() => void reloadTeamsIfChanged(), 1000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      isServerStarted = true;
      activePort = port;
      console.log(`Overlay OBS Free Fire đang chạy tại http://localhost:${port}/overlay`);
      console.log(`Bảng điều khiển tại http://localhost:${port}/control`);
      resolve();
    });
  });

  return {
    port,
    close: stopServer
  };
}

if (require.main === module) {
  void startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
