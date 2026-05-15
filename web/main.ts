import "./styles.css";

interface TeamRow {
  rank: number;
  teamId: number;
  name: string;
  shortName: string;
  logoPath: string;
  accentColor: string;
  basePoints: number;
  liveScore: number;
  totalPoints: number;
  teamEliminated: boolean;
  alive: number;
  eliminated: number;
  players: number;
}

interface PublicEvent {
  id: string;
  type: "knockdown";
  timestamp: string | null;
  eventId: string | null;
  downedId: string;
  killerId: string;
  downedName: string;
  killerName: string;
  downedTeam: string;
  killerTeam: string;
  message: string;
}

interface PublicState {
  sourceLog: string | null;
  sourceLogUpdatedAt: string | null;
  matchEnded: boolean;
  events: PublicEvent[];
  teams: TeamRow[];
}

interface OverlayConfig {
  width: number;
  scale: number;
  rowCount: number;
  fontSize: number;
  rowHeight: number;
  opacity: number;
  rowOpacity: number;
  accentColor: string;
  headerColor: string;
  panelColor: string;
  textColor: string;
  mutedColor: string;
  showLogo: boolean;
  showFooter: boolean;
  showDebug: boolean;
  animationEnabled: boolean;
  moveAnimation: string;
  rowEnterAnimation: string;
  playerLostAnimation: string;
  animationSpeed: number;
}

interface PublicConfig {
  overlay: OverlayConfig;
}

interface LogSource {
  path: string | null;
  mode: "auto" | "file";
}

interface ManagedGroupMatch {
  matchId: string;
  description: string;
  addTime: string;
}

interface ManagedGroup {
  groupId: string;
  note: string;
  createdAt: string;
  matches: ManagedGroupMatch[];
  teamNames: string[];
}

interface ManagedPlayer {
  teamName: string;
  playerId: string;
  playerName: string;
  createdAt: string;
}

type ControlTab = "overlay" | "groups" | "players";
type AnimationPreviewKind = "move" | "enter" | "lost";

const DEFAULT_COLOR_CONFIG = {
  accentColor: "#ff3b30",
  headerColor: "#ff9d1e",
  panelColor: "#1c1d23",
  textColor: "#ffffff",
  mutedColor: "#767780"
} satisfies Pick<OverlayConfig, "accentColor" | "headerColor" | "panelColor" | "textColor" | "mutedColor">;

let state: PublicState = {
  sourceLog: null,
  sourceLogUpdatedAt: null,
  matchEnded: false,
  events: [],
  teams: []
};

let previousRows = new Map<number, TeamRow>();
let currentRows = new Map<number, TeamRow>();

let config: PublicConfig = {
  overlay: {
    width: 360,
    scale: 1,
    rowCount: 15,
    fontSize: 18,
    rowHeight: 44,
    opacity: 0.92,
    rowOpacity: 1,
    accentColor: "#ff3b30",
    headerColor: "#ff9d1e",
    panelColor: "#1c1d23",
    textColor: "#ffffff",
    mutedColor: "#767780",
    showLogo: true,
    showFooter: true,
    showDebug: true,
    animationEnabled: true,
    moveAnimation: "glide",
    rowEnterAnimation: "slide",
    playerLostAnimation: "pulse",
    animationSpeed: 1
  }
};

let logSource: LogSource = {
  path: null,
  mode: "auto"
};
let groups: ManagedGroup[] = [];
let players: ManagedPlayer[] = [];
let logPathDraft: string | null = null;
let logSourceError = "";
let activeControlTab: ControlTab = "overlay";
let selectedGroupId = "";
let groupSearch = "";
let playerSearch = "";
let matchStatsMessage = "";
let matchStatsLoading = false;
let overlayHasRendered = false;
let animationPreviewKind: AnimationPreviewKind | null = null;
let animationPreviewUntil = 0;
let animationPreviewTimer: number | null = null;

const app = document.querySelector<HTMLDivElement>("#app")!;
const isControl = location.pathname === "/control";

async function boot(): Promise<void> {
  const [stateResponse, configResponse, logSourceResponse, groupsResponse, playersResponse] = await Promise.all([
    fetch("/api/state"),
    fetch("/api/config"),
    fetch("/api/log-source"),
    fetch("/api/groups"),
    fetch("/api/players")
  ]);
  state = await stateResponse.json();
  config = await configResponse.json();
  config.overlay = normalizeOverlayClientConfig(config.overlay);
  logSource = await logSourceResponse.json();
  groups = normalizeGroups(await groupsResponse.json());
  players = normalizePlayers(await playersResponse.json());
  selectedGroupId = groups[0]?.groupId || "";
  currentRows = new Map(state.teams.map((team) => [team.teamId, team]));
  render();
  connectSocket();
}

function connectSocket(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.state) {
      previousRows = currentRows;
      state = payload.state;
      currentRows = new Map(state.teams.map((team) => [team.teamId, team]));
    }
    if (payload.config) {
      config = payload.config;
      config.overlay = normalizeOverlayClientConfig(config.overlay);
    }
    if (payload.logSource) logSource = payload.logSource;
    render();
  };

  socket.onclose = () => {
    setTimeout(connectSocket, 1000);
  };
}

function render(): void {
  const oldPositions = captureRowPositions();
  const shouldAnimateBoard = !isControl && !overlayHasRendered;
  app.className = isControl ? "control-page" : "overlay-page";
  app.innerHTML = isControl ? renderControl() : renderOverlay(shouldAnimateBoard);
  if (!isControl) overlayHasRendered = true;
  if (isControl) bindControlEvents();
  animateRowMoves(oldPositions);
}

function captureRowPositions(): Map<number, DOMRect> {
  const positions = new Map<number, DOMRect>();
  app.querySelectorAll<HTMLElement>(".team-row[data-team-id]").forEach((row) => {
    positions.set(Number(row.dataset.teamId), row.getBoundingClientRect());
  });
  return positions;
}

function animateRowMoves(oldPositions: Map<number, DOMRect>): void {
  if (oldPositions.size === 0) return;
  const moveAnimation = config.overlay.animationEnabled ? config.overlay.moveAnimation : "off";
  if (moveAnimation === "off") return;

  const scale = config.overlay.scale || 1;
  const duration = moveDurationMs(config.overlay);
  const easing = moveEasing(moveAnimation);
  const rows = Array.from(app.querySelectorAll<HTMLElement>(".team-row[data-team-id]"));

  rows.forEach((row) => {
    const oldRect = oldPositions.get(Number(row.dataset.teamId));
    if (!oldRect) return;

    const newRect = row.getBoundingClientRect();
    const deltaX = (oldRect.left - newRect.left) / scale;
    const deltaY = (oldRect.top - newRect.top) / scale;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

    const rank = Number(row.dataset.rank || "0");
    if (moveAnimation === "top-pop" && rank > 0 && rank <= 3) {
      animateTopPopMove(row, deltaY, duration);
      return;
    }

    row.classList.add("rank-moving");
    row.classList.add(`rank-moving-${moveAnimation}`);
    row.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    row.style.transition = "transform 0s";

    requestAnimationFrame(() => {
      row.style.transition = `transform ${duration}ms ${easing}`;
      row.style.transform = "translate(0, 0)";
      window.setTimeout(() => {
        row.classList.remove("rank-moving");
        row.classList.remove(`rank-moving-${moveAnimation}`);
        row.style.transition = "";
        row.style.transform = "";
      }, duration + 80);
    });
  });
}

function animateTopPopMove(row: HTMLElement, deltaY: number, duration: number): void {
  row.classList.add("rank-moving", "rank-moving-top-pop");
  const animation = row.animate(
    [
      { transform: `translateY(${deltaY}px) scale(1)`, filter: "brightness(1)" },
      { transform: `translateY(${deltaY}px) scale(1.075)`, filter: "brightness(1.18)", offset: 0.18 },
      { transform: "translateY(0) scale(1.075)", filter: "brightness(1.18)", offset: 0.78 },
      { transform: "translateY(0) scale(1)", filter: "brightness(1)" }
    ],
    {
      duration,
      easing: "cubic-bezier(0.18, 0.9, 0.2, 1)",
      fill: "both"
    }
  );

  animation.finished
    .catch(() => undefined)
    .finally(() => {
      row.classList.remove("rank-moving", "rank-moving-top-pop");
      row.style.transform = "";
      row.style.transition = "";
    });
}

function moveDurationMs(c: OverlayConfig): number {
  const base = c.moveAnimation === "snap" ? 420 : c.moveAnimation === "slide" ? 760 : c.moveAnimation === "top-pop" ? 1800 : 980;
  return Math.round(base / animationSpeedValue(c));
}

function moveEasing(mode: string): string {
  if (mode === "snap") return "cubic-bezier(0.2, 0.8, 0.2, 1)";
  if (mode === "slide") return "cubic-bezier(0.16, 1, 0.3, 1)";
  if (mode === "top-pop") return "cubic-bezier(0.18, 0.9, 0.2, 1)";
  return "cubic-bezier(0.22, 1, 0.36, 1)";
}

function animationSpeedValue(c: OverlayConfig): number {
  return Math.max(0.15, Math.min(2, c.animationSpeed || 1));
}

function renderOverlay(animateBoard = false, animationPreview: AnimationPreviewKind | null = null): string {
  const c = normalizeOverlayClientConfig(config.overlay);
  const rows = state.teams.slice(0, c.rowCount);
  const panelStyle = [
    `--panel-width:${c.width}px`,
    `--panel-scale:${c.scale}`,
    `--row-height:${c.rowHeight}px`,
    `--font-size:${c.fontSize}px`,
    `--panel-opacity:${c.opacity}`,
    `--row-opacity:${c.rowOpacity}`,
    `--accent:${c.accentColor}`,
    `--header:${c.headerColor}`,
    `--panel:${c.panelColor}`,
    `--text:${c.textColor}`,
    `--muted:${c.mutedColor}`,
    `--accent-rgb:${hexToRgbTriplet(c.accentColor)}`,
    `--header-rgb:${hexToRgbTriplet(c.headerColor)}`,
    `--panel-rgb:${hexToRgbTriplet(c.panelColor)}`,
    `--text-rgb:${hexToRgbTriplet(c.textColor)}`,
    `--muted-rgb:${hexToRgbTriplet(c.mutedColor)}`,
    `--anim-speed:${animationSpeedValue(c)}`
  ].join(";");
  const animationClasses = c.animationEnabled
    ? `anim-on move-${c.moveAnimation} enter-${c.rowEnterAnimation} lost-${c.playerLostAnimation}`
    : "anim-off move-off enter-off lost-off";
  const previewClass = animationPreview && c.animationEnabled ? `demo-${animationPreview}` : "";

  return `
    <section class="scoreboard ${animateBoard ? "board-enter" : ""} ${previewClass} ${animationClasses} ${state.matchEnded ? "match-ended" : ""}" style="${panelStyle}">
      <div class="leaderboard-inner">
        <header class="score-header">
          <span class="header-spacer"></span>
          <span class="header-team">TEAM</span>
          <span class="header-elims">ELIMS</span>
          <span class="header-alive">ALIVE</span>
        </header>
        <div class="score-rows">
          ${rows.map((team, index) => renderTeamRow(team, c, index, animationPreview)).join("")}
        </div>
        ${renderEventFeed()}
        ${
          c.showFooter
            ? `<div class="divider-line"></div>
              <footer class="score-footer">
                <span class="legend-item"><span class="legend-bars">${renderLegendBars("alive")}</span>ALIVE</span>
                <span class="legend-separator">|</span>
                <span class="legend-item"><span class="legend-bars">${renderLegendBars("out")}</span>ELIMINATED</span>
              </footer>
              <div class="divider-line bottom"></div>`
            : ""
        }
        ${c.showDebug ? renderDebugInfo() : ""}
      </div>
    </section>
  `;
}

function renderEventFeed(): string {
  const events = (state.events || []).slice(0, 3);
  if (events.length === 0) return "";

  return `
    <div class="event-feed">
      ${events
        .map(
          (event) => `
            <article class="event-item event-${event.type}" title="${escapeAttribute(event.message)}">
              <span class="event-tag">KNOCK DOWN</span>
              <span class="event-killer">${formatEventName(event.killerName, event.killerTeam)}</span>
              <span class="event-arrow">></span>
              <span class="event-downed">${formatEventName(event.downedName, event.downedTeam)}</span>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function formatEventName(name: string, teamName: string): string {
  const teamPrefix = teamName ? `<em>${escapeHtml(shortEventTeamName(teamName))}</em>` : "";
  return `${teamPrefix}<strong>${escapeHtml(name)}</strong>`;
}

function shortEventTeamName(teamName: string): string {
  const cleaned = teamName.trim();
  if (cleaned.length <= 6) return cleaned.toUpperCase();
  const words = cleaned
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 1) return cleaned.slice(0, 6).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function renderLegendBars(kind: "alive" | "out"): string {
  return Array.from({ length: 4 })
    .map(() => `<i class="bar ${kind === "alive" ? "red" : ""}"></i>`)
    .join("");
}

function renderDebugInfo(): string {
  const fullPath = state.sourceLog || "";
  const fileName = fullPath ? fullPath.split(/[\\/]/).pop() || fullPath : "Chưa chọn log";
  const updatedAt = state.sourceLogUpdatedAt
    ? new Date(state.sourceLogUpdatedAt).toLocaleTimeString()
    : "đang chờ";

  return `
    <div class="debug-log" title="${escapeHtml(fullPath)}">
      <div class="status-left">
        <span class="debug-icon" aria-hidden="true"></span>
        <span class="debug-label">ĐANG ĐỌC</span>
        <strong>${escapeHtml(fileName)}</strong>
      </div>
      <div class="status-right">
        <span class="debug-separator">|</span>
        <span class="debug-clock" aria-hidden="true"></span>
        <em>${escapeHtml(updatedAt)}</em>
      </div>
    </div>
  `;
}

function renderTeamRow(
  team: TeamRow,
  c: OverlayConfig,
  index: number,
  animationPreview: AnimationPreviewKind | null = null
): string {
  const aliveSlots = 4;
  const visibleAlive = Math.max(0, Math.min(aliveSlots, team.alive));
  const previous = previousRows.get(team.teamId);
  const aliveChange = previous ? team.alive - previous.alive : 0;
  const rankChange = previous ? previous.rank - team.rank : 0;
  const animationsEnabled = c.animationEnabled;
  const hasRankMove = rankChange !== 0;
  const isEliminated = team.teamEliminated || (team.players > 0 && team.alive === 0);
  const demoEnter = animationPreview === "enter" && index < 3;
  const demoLost = animationPreview === "lost" && index === 0;
  const demoMovedUp = animationPreview === "move" && index === 1;
  const demoMovedDown = animationPreview === "move" && index === 0;
  const rowClasses = [
    "team-row",
    animationsEnabled && c.rowEnterAnimation !== "off" && (!previous || demoEnter) ? "new-row" : "",
    animationsEnabled && c.playerLostAnimation !== "off" && ((aliveChange < 0 && !hasRankMove) || demoLost) ? "player-lost" : "",
    isEliminated ? "team-eliminated" : "",
    animationsEnabled && c.moveAnimation !== "off" && (rankChange > 0 || demoMovedUp) ? "moved-up" : "",
    animationsEnabled && c.moveAnimation !== "off" && (rankChange < 0 || demoMovedDown) ? "moved-down" : "",
    team.rank <= 3 ? "podium-row" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const logo = team.logoPath
    ? `<img class="team-logo" src="${escapeHtml(team.logoPath)}" alt="" />`
    : `<span class="team-initials">${escapeHtml(team.shortName.slice(0, 2))}</span>`;

  return `
    <article class="${rowClasses}" data-team-id="${team.teamId}" data-rank="${team.rank}" style="--team-accent:${team.accentColor}; --row-index:${index}">
      <div class="row-content">
        <div class="rank">#${team.rank}</div>
        <div class="team-section">
          ${c.showLogo ? `<div class="logo-wrap">${logo}</div>` : ""}
          <div class="team-code" title="${escapeHtml(team.name)}">${escapeHtml(team.shortName)}</div>
        </div>
        <div class="points">
          ${team.totalPoints}
        </div>
        <div class="alive-bars" aria-label="${visibleAlive} còn sống">
          ${Array.from({ length: aliveSlots })
            .map((_, index) => `<span class="bar ${index < visibleAlive ? "red alive" : "out"}"></span>`)
            .join("")}
        </div>
      </div>
    </article>
  `;
}

function renderControl(): string {
  return `
    <section class="control-shell">
      <div class="control-panel">
        <h1>Điều khiển lớp phủ</h1>
        ${renderControlTabs()}
        ${activeControlTab === "overlay" ? renderOverlayControls() : ""}
        ${activeControlTab === "groups" ? renderGroupManager() : ""}
        ${activeControlTab === "players" ? renderPlayerManager() : ""}
        <div class="control-actions">
          <a href="/overlay" target="_blank">Mở lớp phủ</a>
          <span>${state.sourceLog ? escapeHtml(state.sourceLog.split(/[\\/]/).pop() || "") : "Đang chờ log"}</span>
        </div>
      </div>
      <div class="preview">${renderOverlay(false, activeControlTab === "overlay" ? currentAnimationPreviewKind() : null)}</div>
    </section>
  `;
}

function renderControlTabs(): string {
  const tabs: Array<{ id: ControlTab; label: string; count?: number }> = [
    { id: "overlay", label: "Lớp phủ" },
    { id: "groups", label: "Nhóm", count: groups.length },
    { id: "players", label: "Người chơi", count: players.length }
  ];

  return `
    <nav class="control-tabs" aria-label="Khu vực điều khiển">
      ${tabs
        .map(
          (tab) => `
            <button type="button" class="${activeControlTab === tab.id ? "active" : ""}" data-control-tab="${tab.id}">
              <span>${tab.label}</span>
              ${typeof tab.count === "number" ? `<em>${tab.count}</em>` : ""}
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderOverlayControls(): string {
  const c = normalizeOverlayClientConfig(config.overlay);
  return `
    ${renderLogSourceControl()}
    <div class="preset-actions">
      <button type="button" data-config-export>Xuất cấu hình</button>
      <label class="file-button">
        Nhập cấu hình
        <input type="file" accept=".json,application/json" data-config-import />
      </label>
    </div>
    <div class="control-grid">
      ${rangeInput("width", "Rộng", c.width, 240, 900, 10)}
      ${rangeInput("scale", "Tỉ lệ", c.scale, 0.5, 2.5, 0.05)}
      ${rangeInput("rowCount", "Số dòng", c.rowCount, 1, 30, 1)}
      ${rangeInput("fontSize", "Cỡ chữ", c.fontSize, 10, 34, 1)}
      ${rangeInput("rowHeight", "Cao dòng", c.rowHeight, 28, 90, 1)}
      ${rangeInput("opacity", "Độ mờ", c.opacity, 0.2, 1, 0.01)}
      ${rangeInput("rowOpacity", "Nền dòng", c.rowOpacity, 0, 1, 0.01)}
      ${colorInput("accentColor", "Màu nhấn", c.accentColor)}
      ${colorInput("headerColor", "Đầu bảng", c.headerColor)}
      ${colorInput("panelColor", "Nền bảng", c.panelColor)}
      ${colorInput("textColor", "Màu chữ", c.textColor)}
      ${colorInput("mutedColor", "Màu phụ", c.mutedColor)}
      ${colorResetButton()}
      ${toggleInput("animationEnabled", "Hiệu ứng", c.animationEnabled)}
      ${selectInput("moveAnimation", "Đổi hạng", c.moveAnimation, [
        ["glide", "Lướt"],
        ["slide", "Trượt"],
        ["snap", "Nhanh"],
        ["top-pop", "Bật lên"],
        ["off", "Tắt"]
      ])}
      ${selectInput("rowEnterAnimation", "Dòng mới", c.rowEnterAnimation, [
        ["slide", "Trượt vào"],
        ["fade", "Mờ dần"],
        ["off", "Tắt"]
      ])}
      ${selectInput("playerLostAnimation", "Mất người", c.playerLostAnimation, [
        ["pulse", "Nhấp nháy"],
        ["shake", "Rung"],
        ["off", "Tắt"]
      ])}
      ${rangeInput("animationSpeed", "Tốc độ", c.animationSpeed, 0.15, 2, 0.05)}
      ${toggleInput("showLogo", "Logo", c.showLogo)}
      ${toggleInput("showFooter", "Chú giải", c.showFooter)}
      ${toggleInput("showDebug", "Gỡ lỗi", c.showDebug)}
    </div>
  `;
}

function bindControlEvents(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-control-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeControlTab = button.dataset.controlTab as ControlTab;
      render();
    });
  });

  const logSourceForm = app.querySelector<HTMLFormElement>("[data-log-source-form]");
  const logSourceInput = app.querySelector<HTMLInputElement>("[data-log-source-input]");
  const autoButton = app.querySelector<HTMLButtonElement>("[data-log-source-auto]");

  logSourceInput?.addEventListener("input", () => {
    logPathDraft = logSourceInput.value;
  });

  logSourceForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveLogSource(logPathDraft ?? logSourceInput?.value ?? "");
  });

  autoButton?.addEventListener("click", () => {
    void saveLogSource("");
  });

  app.querySelector<HTMLButtonElement>("[data-color-reset]")?.addEventListener("click", () => {
    config = {
      ...config,
      overlay: {
        ...config.overlay,
        ...DEFAULT_COLOR_CONFIG
      }
    };
    render();
    void saveConfig();
  });

  app.querySelector<HTMLButtonElement>("[data-config-export]")?.addEventListener("click", () => {
    const payload = {
      type: "ff-tools-overlay-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      overlay: normalizeOverlayClientConfig(config.overlay)
    };
    downloadText("ff-tools-overlay-config.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  });

  app.querySelector<HTMLInputElement>("[data-config-import]")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const overlay = normalizeImportedOverlayConfig(raw);
      config = { ...config, overlay };
      render();
      await saveConfigNow();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Không thể nhập cấu hình");
    }
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-config]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.config as keyof OverlayConfig;
      const next = { ...config.overlay };
      if (input.type === "checkbox") {
        (next[key] as boolean) = input.checked;
      } else if (input.type === "range") {
        (next[key] as number) = Number(input.value);
      } else {
        (next[key] as string) = input.value;
      }
      config = { ...config, overlay: next };
      triggerAnimationPreview(previewKindForConfigKey(key));
      render();
      void saveConfig();
    });
  });

  bindGroupManagerEvents();
  bindPlayerManagerEvents();
}

function currentAnimationPreviewKind(): AnimationPreviewKind | null {
  if (!animationPreviewKind || Date.now() > animationPreviewUntil) return null;
  return animationPreviewKind;
}

function triggerAnimationPreview(kind: AnimationPreviewKind | null): void {
  animationPreviewKind = kind;
  const previewMs = kind ? Math.min(12000, Math.max(2200, moveDurationMs(config.overlay) + 700)) : 0;
  animationPreviewUntil = kind ? Date.now() + previewMs : 0;

  if (animationPreviewTimer) window.clearTimeout(animationPreviewTimer);
  if (!kind) return;

  animationPreviewTimer = window.setTimeout(() => {
    animationPreviewKind = null;
    animationPreviewUntil = 0;
    if (isControl && activeControlTab === "overlay") render();
  }, previewMs);
}

function previewKindForConfigKey(key: keyof OverlayConfig): AnimationPreviewKind | null {
  if (key === "moveAnimation") return "move";
  if (key === "rowEnterAnimation") return "enter";
  if (key === "playerLostAnimation") return "lost";
  if (key === "animationSpeed") return "move";
  if (key === "animationEnabled") return config.overlay.animationEnabled ? "move" : null;
  return null;
}

async function saveLogSource(filePath: string): Promise<void> {
  logSourceError = "";
  try {
    const response = await fetch("/api/log-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Không thể đặt đường dẫn log debugger");

    logSource = payload;
    logPathDraft = payload.path || "";
  } catch (error) {
    logSourceError = error instanceof Error ? error.message : "Không thể đặt đường dẫn log debugger";
  }
  render();
}

function bindGroupManagerEvents(): void {
  app.querySelector<HTMLInputElement>("[data-group-search]")?.addEventListener("input", (event) => {
    groupSearch = (event.target as HTMLInputElement).value;
    render();
  });

  app.querySelector<HTMLFormElement>("[data-group-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const groupId = normalizeText(data.get("groupId"));
    if (!groupId || groups.some((group) => group.groupId.toLowerCase() === groupId.toLowerCase())) return;

    const nextGroup: ManagedGroup = {
      groupId,
      note: normalizeText(data.get("note")),
      createdAt: new Date().toISOString(),
      matches: parseMatchIds(normalizeText(data.get("matchIds"))).map((matchId) => ({
        matchId,
        description: "",
        addTime: new Date().toISOString()
      })),
      teamNames: []
    };
    groups = [nextGroup, ...groups];
    selectedGroupId = groupId;
    void saveGroups();
  });

  app.querySelectorAll<HTMLButtonElement>("[data-group-select]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedGroupId = button.dataset.groupSelect || "";
      matchStatsMessage = "";
      render();
    });
  });

  app.querySelector<HTMLButtonElement>("[data-match-stats-apply]")?.addEventListener("click", async () => {
    const selected = getSelectedGroup();
    if (!selected || matchStatsLoading) return;

    matchStatsLoading = true;
    matchStatsMessage = "Đang lấy điểm trận...";
    render();

    try {
      const response = await fetch("/api/match-stats/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selected.groupId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      const teamCount = Array.isArray(result.teams) ? result.teams.length : 0;
      const failedBatches = Number(result.failedBatches || 0);
      matchStatsMessage = failedBatches
        ? `Đã áp dụng ${teamCount} đội; lỗi ${failedBatches} lô.`
        : `Đã áp dụng ${teamCount} đội từ ${Number(result.matchIdCount || 0)} ID trận.`;
    } catch (error) {
      matchStatsMessage = error instanceof Error ? error.message : String(error);
    } finally {
      matchStatsLoading = false;
      render();
    }
  });

  app.querySelector<HTMLFormElement>("[data-group-edit]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = getSelectedGroup();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const nextId = normalizeText(data.get("groupId"));
    if (!nextId) return;
    const duplicate = groups.some((group) => group.groupId !== selected.groupId && group.groupId.toLowerCase() === nextId.toLowerCase());
    if (duplicate) return;

    selected.groupId = nextId;
    selected.note = normalizeText(data.get("note"));
    selected.teamNames = parseLines(normalizeText(data.get("teamNames")));
    selectedGroupId = nextId;
    void saveGroups();
  });

  app.querySelector<HTMLFormElement>("[data-match-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = getSelectedGroup();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const matchId = normalizeText(data.get("matchId"));
    if (!matchId || selected.matches.some((match) => match.matchId === matchId)) return;
    selected.matches.push({
      matchId,
      description: normalizeText(data.get("description")),
      addTime: new Date().toISOString()
    });
    void saveGroups();
  });

  app.querySelectorAll<HTMLButtonElement>("[data-match-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = getSelectedGroup();
      if (!selected) return;
      const matchId = button.dataset.matchDelete || "";
      selected.matches = selected.matches.filter((match) => match.matchId !== matchId);
      void saveGroups();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-team-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = getSelectedGroup();
      const teamName = button.dataset.teamChip || "";
      if (!selected || !teamName || selected.teamNames.includes(teamName)) return;
      selected.teamNames = [...selected.teamNames, teamName].sort((a, b) => a.localeCompare(b));
      void saveGroups();
    });
  });

  app.querySelector<HTMLButtonElement>("[data-group-delete]")?.addEventListener("click", (event) => {
    const groupId = (event.currentTarget as HTMLButtonElement).dataset.groupDelete || "";
    groups = groups.filter((group) => group.groupId !== groupId);
    selectedGroupId = groups[0]?.groupId || "";
    void saveGroups();
  });

  app.querySelector<HTMLInputElement>("[data-group-import]")?.addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    groups = mergeGroups(groups, parseGroupCsv(await file.text()));
    selectedGroupId = groups[0]?.groupId || selectedGroupId;
    void saveGroups();
  });

  app.querySelector<HTMLButtonElement>("[data-group-export]")?.addEventListener("click", () => {
    downloadText("groups.csv", groupCsv(groups));
  });
}

function bindPlayerManagerEvents(): void {
  app.querySelector<HTMLInputElement>("[data-player-search]")?.addEventListener("input", (event) => {
    playerSearch = (event.target as HTMLInputElement).value;
    render();
  });

  app.querySelector<HTMLFormElement>("[data-player-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const player = normalizePlayer({
      playerId: data.get("playerId"),
      playerName: data.get("playerName"),
      teamName: data.get("teamName"),
      createdAt: new Date().toISOString()
    });
    if (!player || players.some((entry) => entry.playerId === player.playerId)) return;
    players = [player, ...players];
    void savePlayers();
  });

  app.querySelectorAll<HTMLFormElement>("[data-player-row]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const originalId = form.dataset.playerRow || "";
      const data = new FormData(form);
      const player = normalizePlayer({
        playerId: data.get("playerId"),
        playerName: data.get("playerName"),
        teamName: data.get("teamName"),
        createdAt: players.find((entry) => entry.playerId === originalId)?.createdAt || new Date().toISOString()
      });
      if (!player) return;
      const duplicate = players.some((entry) => entry.playerId !== originalId && entry.playerId === player.playerId);
      if (duplicate) return;
      players = players.map((entry) => (entry.playerId === originalId ? player : entry));
      void savePlayers();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-player-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = button.dataset.playerDelete || "";
      players = players.filter((player) => player.playerId !== playerId);
      void savePlayers();
    });
  });

  app.querySelector<HTMLInputElement>("[data-player-import]")?.addEventListener("change", async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    players = mergePlayers(players, parsePlayerCsv(await file.text()));
    void savePlayers();
  });

  app.querySelector<HTMLButtonElement>("[data-player-export]")?.addEventListener("click", () => {
    downloadText("players.csv", playerCsv(players));
  });
}

async function saveGroups(): Promise<void> {
  const response = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(groups)
  });
  groups = normalizeGroups(await response.json());
  if (!groups.some((group) => group.groupId === selectedGroupId)) selectedGroupId = groups[0]?.groupId || "";
  render();
}

async function savePlayers(): Promise<void> {
  const response = await fetch("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(players)
  });
  players = normalizePlayers(await response.json());
  render();
}

let saveTimer: number | null = null;
function saveConfig(): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await saveConfigNow();
  }, 250);
}

async function saveConfigNow(): Promise<void> {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeOverlayClientConfig(config.overlay))
  });
  if (!response.ok) {
    throw new Error(`Không thể lưu cấu hình: HTTP ${response.status}`);
  }
  config = await response.json();
  config.overlay = normalizeOverlayClientConfig(config.overlay);
}

function normalizeOverlayClientConfig(input: Partial<OverlayConfig>): OverlayConfig {
  return {
    ...config.overlay,
    ...input,
    rowOpacity: Math.max(0, Math.min(1, numberOrDefault(input.rowOpacity, 1)))
  };
}

function normalizeImportedOverlayConfig(input: unknown): OverlayConfig {
  if (!input || typeof input !== "object") {
    throw new Error("File cấu hình không hợp lệ");
  }

  const record = input as Record<string, unknown>;
  const overlay = record.overlay && typeof record.overlay === "object" ? (record.overlay as Partial<OverlayConfig>) : (record as Partial<OverlayConfig>);
  return normalizeOverlayClientConfig(overlay);
}

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderLogSourceControl(): string {
  const currentPath = state.sourceLog || "";
  const selectedPath = logPathDraft ?? logSource.path ?? currentPath;
  const modeText = logSource.mode === "file" ? "Thủ công" : "Tự động";
  const statusText = currentPath ? "Đang đọc" : logSource.mode === "file" ? "Đang chờ" : "Đang quét";
  const activeText = currentPath ? currentPath : "Đang chờ log";
  const fileName = currentPath ? currentPath.split(/[\\/]/).pop() || currentPath : "Chưa có file";
  const updatedAt = state.sourceLogUpdatedAt
    ? new Date(state.sourceLogUpdatedAt).toLocaleTimeString()
    : "--:--:--";

  return `
    <form class="log-reader" data-log-source-form>
      <div class="log-reader-head">
        <div>
          <span class="eyebrow">Nguồn vào</span>
          <h2>Đọc log</h2>
        </div>
        <span class="reader-mode ${logSource.mode === "file" ? "is-manual" : ""}">${escapeHtml(modeText)}</span>
      </div>
      <label class="reader-path">
        <span>Đường dẫn</span>
        <input
          data-log-source-input
          type="text"
          value="${escapeHtml(selectedPath)}"
          placeholder="C:\\duong\\dan\\day-du\\debugger-2026-05-14T08-39-14.log"
          spellcheck="false"
        />
      </label>
      <div class="reader-actions">
        <button class="reader-attach" type="submit">Gắn log</button>
        <button class="reader-auto" type="button" data-log-source-auto>Tự động</button>
        <span class="reader-state ${currentPath ? "is-live" : ""}">${escapeHtml(statusText)}</span>
      </div>
      <div class="reader-current">
        <div class="reader-file">
          <span>Hiện tại</span>
          <strong title="${escapeHtml(activeText)}">${escapeHtml(fileName)}</strong>
        </div>
        <div class="reader-time">
          <span>Cập nhật</span>
          <strong>${escapeHtml(updatedAt)}</strong>
        </div>
      </div>
      ${logSourceError ? `<div class="reader-error">${escapeHtml(logSourceError)}</div>` : ""}
    </form>
  `;
}

function renderGroupManager(): string {
  const selectedGroup = getSelectedGroup();
  const filteredGroups = groups.filter((group) => {
    const haystack = [group.groupId, group.note, group.matches.map((match) => match.matchId).join(" ")].join(" ").toLowerCase();
    return haystack.includes(groupSearch.toLowerCase());
  });
  const teamNames = uniqueTeamNames();

  return `
    <section class="manager-panel">
      <div class="manager-head">
        <div>
          <span class="eyebrow">Kế hoạch</span>
          <h2>Quản lý nhóm</h2>
        </div>
        <div class="manager-actions">
          <label class="file-button">
            Nhập CSV
            <input type="file" accept=".csv,text/csv" data-group-import />
          </label>
          <button type="button" data-group-export>Xuất</button>
        </div>
      </div>

      <form class="manager-form" data-group-form>
        <input name="groupId" placeholder="Tên nhóm" autocomplete="off" required />
        <input name="note" placeholder="Ghi chú" autocomplete="off" />
        <textarea name="matchIds" rows="3" placeholder="ID trận, cách nhau bằng dấu phẩy hoặc xuống dòng"></textarea>
        <button type="submit">Thêm nhóm</button>
      </form>

      <label class="manager-search">
        <span>Tìm nhóm</span>
        <input value="${escapeHtml(groupSearch)}" data-group-search placeholder="Tìm theo nhóm, ghi chú hoặc trận..." />
      </label>

      <div class="manager-list group-list">
        ${
          filteredGroups.length
            ? filteredGroups.map((group) => renderGroupListItem(group)).join("")
            : `<div class="empty-note">Chưa có nhóm.</div>`
        }
      </div>

      <div class="detail-panel">
        ${
          selectedGroup
            ? `
              <div class="detail-head">
                <div>
                  <span class="eyebrow">Đang chọn</span>
                  <h3>${escapeHtml(selectedGroup.groupId)}</h3>
                </div>
                <div class="manager-actions">
                  <button type="button" data-match-stats-apply ${matchStatsLoading ? "disabled" : ""}>${matchStatsLoading ? "Đang áp dụng..." : "Áp dụng điểm"}</button>
                  <button type="button" class="danger-button" data-group-delete="${escapeAttribute(selectedGroup.groupId)}">Xóa</button>
                </div>
              </div>
              ${matchStatsMessage ? `<div class="match-stats-status">${escapeHtml(matchStatsMessage)}</div>` : ""}
              <form class="detail-grid" data-group-edit>
                <label>
                  <span>Nhóm</span>
                  <input name="groupId" value="${escapeHtml(selectedGroup.groupId)}" required />
                </label>
                <label>
                  <span>Ghi chú</span>
                  <input name="note" value="${escapeHtml(selectedGroup.note)}" />
                </label>
                <label class="wide-field">
                  <span>Tên đội hôm nay</span>
                  <textarea name="teamNames" rows="3" placeholder="Mỗi dòng một đội">${escapeHtml(selectedGroup.teamNames.join("\n"))}</textarea>
                </label>
                <button type="submit">Lưu nhóm</button>
              </form>
              <form class="inline-form" data-match-form>
                <input name="matchId" placeholder="ID trận" required />
                <input name="description" placeholder="Mô tả" />
                <button type="submit">Thêm trận</button>
              </form>
              <div class="chip-row">
                ${teamNames.length ? teamNames.map((name) => `<button type="button" data-team-chip="${escapeAttribute(name)}">${escapeHtml(name)}</button>`).join("") : `<span>Chưa có đội từ danh sách người chơi.</span>`}
              </div>
              <div class="match-list">
                ${
                  selectedGroup.matches.length
                    ? selectedGroup.matches.map((match) => renderMatchItem(match)).join("")
                    : `<div class="empty-note">Nhóm này chưa có trận.</div>`
                }
              </div>
            `
            : `<div class="empty-note">Chọn hoặc tạo nhóm để sửa trận và tên đội.</div>`
        }
      </div>
    </section>
  `;
}

function renderGroupListItem(group: ManagedGroup): string {
  const selected = group.groupId === selectedGroupId;
  return `
    <button type="button" class="manager-row ${selected ? "selected" : ""}" data-group-select="${escapeAttribute(group.groupId)}">
      <strong>${escapeHtml(group.groupId)}</strong>
      <span>${group.matches.length} trận | ${group.teamNames.length} đội</span>
      ${group.note ? `<em>${escapeHtml(group.note)}</em>` : ""}
    </button>
  `;
}

function renderMatchItem(match: ManagedGroupMatch): string {
  return `
    <div class="match-item">
      <div>
        <strong>${escapeHtml(match.matchId)}</strong>
        ${match.description ? `<span>${escapeHtml(match.description)}</span>` : ""}
      </div>
      <button type="button" data-match-delete="${escapeAttribute(match.matchId)}">Xóa</button>
    </div>
  `;
}

function renderPlayerManager(): string {
  const filteredPlayers = players.filter((player) => {
    const haystack = [player.playerId, player.playerName, player.teamName].join(" ").toLowerCase();
    return haystack.includes(playerSearch.toLowerCase());
  });

  return `
    <section class="manager-panel">
      <div class="manager-head">
        <div>
          <span class="eyebrow">Đội hình</span>
          <h2>Dữ liệu người chơi</h2>
        </div>
        <div class="manager-actions">
          <label class="file-button">
            Nhập CSV
            <input type="file" accept=".csv,text/csv" data-player-import />
          </label>
          <button type="button" data-player-export>Xuất</button>
        </div>
      </div>

      <form class="manager-form" data-player-form>
        <input name="playerId" placeholder="ID người chơi" autocomplete="off" required />
        <input name="playerName" placeholder="Tên người chơi" autocomplete="off" required />
        <input name="teamName" placeholder="Tên đội" autocomplete="off" required />
        <button type="submit">Thêm người chơi</button>
      </form>

      <label class="manager-search">
        <span>Tìm người chơi</span>
        <input value="${escapeHtml(playerSearch)}" data-player-search placeholder="Tìm theo ID, người chơi hoặc đội..." />
      </label>

      <div class="manager-list player-list">
        ${
          filteredPlayers.length
            ? filteredPlayers.map((player) => renderPlayerRow(player)).join("")
            : `<div class="empty-note">Chưa có người chơi.</div>`
        }
      </div>
    </section>
  `;
}

function renderPlayerRow(player: ManagedPlayer): string {
  return `
    <form class="player-row" data-player-row="${escapeAttribute(player.playerId)}">
      <input name="playerId" value="${escapeHtml(player.playerId)}" required />
      <input name="playerName" value="${escapeHtml(player.playerName)}" required />
      <input name="teamName" value="${escapeHtml(player.teamName)}" required />
      <button type="submit">Lưu</button>
      <button type="button" class="danger-button" data-player-delete="${escapeAttribute(player.playerId)}">Xóa</button>
    </form>
  `;
}

function rangeInput(
  key: keyof OverlayConfig,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number
): string {
  return `
    <label class="field">
      <span>${label}</span>
      <input data-config="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
      <output>${value}</output>
    </label>
  `;
}

function colorInput(key: keyof OverlayConfig, label: string, value: string): string {
  return `
    <label class="field color-field">
      <span>${label}</span>
      <input data-config="${key}" type="color" value="${escapeHtml(value)}" />
    </label>
  `;
}

function selectInput(
  key: keyof OverlayConfig,
  label: string,
  value: string,
  options: Array<[string, string]>
): string {
  return `
    <label class="field select-field">
      <span>${label}</span>
      <select data-config="${key}">
        ${options
          .map(([optionValue, text]) => `<option value="${escapeAttribute(optionValue)}" ${value === optionValue ? "selected" : ""}>${escapeHtml(text)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function colorResetButton(): string {
  return `
    <div class="field color-reset-field">
      <span>Màu sắc</span>
      <button type="button" data-color-reset>Đặt lại màu</button>
    </div>
  `;
}

function toggleInput(key: keyof OverlayConfig, label: string, value: boolean): string {
  return `
    <label class="field toggle-field">
      <span>${label}</span>
      <input data-config="${key}" type="checkbox" ${value ? "checked" : ""} />
    </label>
  `;
}

function getSelectedGroup(): ManagedGroup | null {
  return groups.find((group) => group.groupId === selectedGroupId) || null;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function parseMatchIds(value: string): string[] {
  return [...new Set(value.split(/[\n,;]+/).map(normalizeText).filter(Boolean))];
}

function parseLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,|;/).map(normalizeText).filter(Boolean))];
}

function normalizeGroups(input: unknown): ManagedGroup[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const createdAt = normalizeText(item.createdAt) || new Date().toISOString();
      const matches = Array.isArray(item.matches)
        ? item.matches
            .filter((match): match is Record<string, unknown> => Boolean(match) && typeof match === "object")
            .map((match) => ({
              matchId: normalizeText(match.matchId),
              description: normalizeText(match.description),
              addTime: normalizeText(match.addTime) || createdAt
            }))
            .filter((match) => match.matchId)
        : Array.isArray(item.matchIds)
          ? item.matchIds
              .map((matchId) => normalizeText(matchId))
              .filter(Boolean)
              .map((matchId) => ({ matchId, description: "", addTime: createdAt }))
          : parseMatchIds(normalizeText(item.matchId)).map((matchId) => ({ matchId, description: "", addTime: createdAt }));

      return {
        groupId: normalizeText(item.groupId || item.name || `group-${index + 1}`),
        note: normalizeText(item.note),
        createdAt,
        matches,
        teamNames: Array.isArray(item.teamNames) ? parseLines(item.teamNames.join("\n")) : parseLines(normalizeText(item.teamNames))
      };
    })
    .filter((group) => group.groupId);
}

function normalizePlayer(input: Record<string, unknown>): ManagedPlayer | null {
  const player = {
    playerId: normalizeText(input.playerId || input.playerID || input.memberId),
    playerName: normalizeText(input.playerName || input.gameName),
    teamName: normalizeText(input.teamName || input.tagName),
    createdAt: normalizeText(input.createdAt) || new Date().toISOString()
  };
  return player.playerId && player.playerName && player.teamName ? player : null;
}

function normalizePlayers(input: unknown): ManagedPlayer[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(normalizePlayer)
    .filter((player): player is ManagedPlayer => {
      if (!player || seen.has(player.playerId)) return false;
      seen.add(player.playerId);
      return true;
    });
}

function uniqueTeamNames(): string[] {
  return [...new Set(players.map((player) => player.teamName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function parseGroupCsv(text: string): ManagedGroup[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const hasHeader = rows[0].some((cell) => /groupid|matchids|note/i.test(cell));
  const header = hasHeader ? rows[0].map((cell) => cell.toLowerCase()) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((row) => {
      const groupId = hasHeader ? row[header.indexOf("groupid")] : row[0];
      const matchIds = hasHeader ? row[header.indexOf("matchids")] || row[header.indexOf("matchid")] : row[1];
      const note = hasHeader ? row[header.indexOf("note")] : row[2];
      const teamNames = hasHeader ? row[header.indexOf("teamnames")] : row[3];
      const createdAt = new Date().toISOString();

      return {
        groupId: normalizeText(groupId),
        note: normalizeText(note),
        createdAt,
        matches: parseMatchIds(matchIds || "").map((matchId) => ({ matchId, description: "", addTime: createdAt })),
        teamNames: parseLines(teamNames || "")
      };
    })
    .filter((group) => group.groupId);
}

function parsePlayerCsv(text: string): ManagedPlayer[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const hasHeader = rows[0].some((cell) => /teamname|memberid|playerid|gamename|playername/i.test(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map(([teamName, playerId, playerName]) => normalizePlayer({ teamName, playerId, playerName }))
    .filter((player): player is ManagedPlayer => Boolean(player));
}

function mergeGroups(current: ManagedGroup[], incoming: ManagedGroup[]): ManagedGroup[] {
  const merged = [...current];
  incoming.forEach((group) => {
    const existing = merged.find((entry) => entry.groupId === group.groupId);
    if (!existing) {
      merged.unshift(group);
      return;
    }
    existing.note = group.note || existing.note;
    existing.matches = mergeMatches(existing.matches, group.matches);
    existing.teamNames = parseLines([...existing.teamNames, ...group.teamNames].join("\n"));
  });
  return merged;
}

function mergeMatches(current: ManagedGroupMatch[], incoming: ManagedGroupMatch[]): ManagedGroupMatch[] {
  const existing = new Set(current.map((match) => match.matchId));
  return [...current, ...incoming.filter((match) => !existing.has(match.matchId))];
}

function mergePlayers(current: ManagedPlayer[], incoming: ManagedPlayer[]): ManagedPlayer[] {
  const merged = [...current];
  incoming.forEach((player) => {
    const index = merged.findIndex((entry) => entry.playerId === player.playerId);
    if (index >= 0) merged[index] = player;
    else merged.unshift(player);
  });
  return merged;
}

function groupCsv(items: ManagedGroup[]): string {
  const rows = [["groupId", "matchIds", "note", "teamNames"], ...items.map((group) => [
    group.groupId,
    group.matches.map((match) => match.matchId).join(";"),
    group.note,
    group.teamNames.join(";")
  ])];
  return rows.map(csvLine).join("\n");
}

function playerCsv(items: ManagedPlayer[]): string {
  const rows = [["teamName", "memberId", "gameName"], ...items.map((player) => [player.teamName, player.playerId, player.playerName])];
  return rows.map(csvLine).join("\n");
}

function csvLine(cells: string[]): string {
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
}

function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function hexToRgbTriplet(value: string): string {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "255 255 255";

  const numeric = Number.parseInt(expanded, 16);
  return `${(numeric >> 16) & 255} ${(numeric >> 8) & 255} ${numeric & 255}`;
}

void boot();
