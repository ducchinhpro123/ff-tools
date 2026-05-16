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

interface WinRateRow {
  rank: number;
  teamId: number;
  name: string;
  shortName: string;
  logoPath: string;
  accentColor: string;
  memberCount: number;
  points: number;
  winRate: number;
  teamEliminated: boolean;
}

interface PublicEliminatedEvent {
  id: string;
  timestamp: string | null;
  eventId: string | null;
  teamId: number;
  teamName: string;
  shortName: string;
  logoPath: string;
  accentColor: string;
  playerId: string;
  originId: string;
  playerName: string;
  elims: number;
  rank: number;
  teamMateIds: string[];
}

interface PublicLogEntry {
  id: string;
  timestamp: string;
  source: "server" | "tailer" | "raw";
  level: "info" | "warn" | "error" | "success" | "debug";
  message: string;
}

interface PublicEvent {
  id: string;
  type: "knockdown" | "dead" | "revive" | "team_eliminated";
  timestamp: string | null;
  eventId: string | null;
  downedId?: string;
  killerId?: string;
  downedName?: string;
  killerName?: string;
  downedTeam?: string;
  killerTeam?: string;
  victimId?: string;
  victimName?: string;
  victimTeam?: string;
  playerId?: string;
  playerName?: string;
  teamName?: string;
  rank?: number;
  elims?: number;
  message: string;
}

interface PublicState {
  sourceLog: string | null;
  sourceLogUpdatedAt: string | null;
  matchEnded: boolean;
  events: PublicEvent[];
  eliminatedEvents: PublicEliminatedEvent[];
  winRates: WinRateRow[];
  logs: PublicLogEntry[];
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
  rowStyle: string;
}

interface PublicConfig {
  overlay: OverlayConfig;
}

interface LogSource {
  path: string | null;
  mode: "auto" | "file";
  running?: boolean;
  currentPath?: string | null;
}

interface ListenerState {
  listenerID: string | null;
  running: boolean;
  logSource: LogSource;
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
  eliminatedEvents: [],
  winRates: [],
  logs: [],
  teams: []
};

let previousRows = new Map<number, TeamRow>();
let currentRows = new Map<number, TeamRow>();
let knownEventIds = new Set<string>();
let knownEliminatedIds = new Set<string>();
let previousWinRates = new Map<number, number>();
let scorePulseUntil = new Map<number, number>();

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
    animationSpeed: 1,
    rowStyle: "classic"
  }
};

let logSource: LogSource = {
  path: null,
  mode: "auto",
  running: false,
  currentPath: null
};
let listenerState: ListenerState = {
  listenerID: null,
  running: false,
  logSource
};
let groups: ManagedGroup[] = [];
let players: ManagedPlayer[] = [];
let logPathDraft: string | null = null;
let logSourceError = "";
let listenerMessage = "";
let listenerBusy = false;
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
let matchDetailsLoadedFor = "";
let matchDetailsHtml = "";

const app = document.querySelector<HTMLDivElement>("#app")!;
const pageMode = location.pathname.replace(/^\/+/, "") || "overlay";
const isControl = pageMode === "control";
const isWinRate = pageMode === "winrate";
const isEliminated = pageMode === "eliminated";
const isTerminal = pageMode === "terminal";
const isMatchDetails = pageMode === "match-details";

async function boot(): Promise<void> {
  const [stateResponse, configResponse, logSourceResponse, groupsResponse, playersResponse, healthResponse] = await Promise.all([
    fetch("/api/state"),
    fetch("/api/config"),
    fetch("/api/log-source"),
    fetch("/api/groups"),
    fetch("/api/players"),
    fetch("/api/health")
  ]);
  state = await stateResponse.json();
  config = await configResponse.json();
  config.overlay = normalizeOverlayClientConfig(config.overlay);
  logSource = await logSourceResponse.json();
  listenerState = normalizeListenerState((await healthResponse.json())?.listener);
  logSource = { ...logSource, ...listenerState.logSource };
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

      // Detect score increases and stamp a transient pulse end-time.
      const now = Date.now();
      const pulseDurationMs = 1400;
      for (const [teamId, row] of currentRows) {
        const prior = previousRows.get(teamId);
        if (prior && row.liveScore > prior.liveScore) {
          scorePulseUntil.set(teamId, now + pulseDurationMs);
        }
      }
      // Drop expired pulses
      for (const [teamId, until] of scorePulseUntil) {
        if (until <= now) scorePulseUntil.delete(teamId);
      }
    }
    if (payload.config) {
      config = payload.config;
      config.overlay = normalizeOverlayClientConfig(config.overlay);
    }
    if (payload.logSource) {
      logSource = payload.logSource;
      listenerState = {
        ...listenerState,
        running: Boolean(payload.logSource.running),
        logSource: payload.logSource
      };
    }
    render();
  };

  socket.onclose = () => {
    setTimeout(connectSocket, 1000);
  };
}

function render(): void {
  const oldPositions = captureRowPositions();
  const shouldAnimateBoard = !isControl && !isTerminal && !isMatchDetails && !overlayHasRendered;
  app.className = isControl || isTerminal || isMatchDetails ? "control-page" : "overlay-page";
  app.innerHTML = renderCurrentPage(shouldAnimateBoard);
  if (!isControl && !isTerminal && !isMatchDetails) overlayHasRendered = true;
  if (isControl) bindControlEvents();
  if (isMatchDetails) bindMatchDetailsEvents();
  animateRowMoves(oldPositions);
}

function renderCurrentPage(shouldAnimateBoard: boolean): string {
  if (isControl) return renderControl();
  if (isWinRate) return renderWinRateOverlay(shouldAnimateBoard);
  if (isEliminated) return renderEliminatedOverlay(shouldAnimateBoard);
  if (isTerminal) return renderTerminalPage();
  if (isMatchDetails) return renderMatchDetailsPage();
  return renderOverlay(shouldAnimateBoard);
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
  const rowStyleClass = `row-style-${c.rowStyle || "classic"}`;

  return `
    <section class="scoreboard ${animateBoard ? "board-enter" : ""} ${previewClass} ${animationClasses} ${rowStyleClass} ${state.matchEnded ? "match-ended" : ""}" style="${panelStyle}">
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

function renderWinRateOverlay(animateBoard = false): string {
  const c = normalizeOverlayClientConfig(config.overlay);
  const rows = state.winRates.slice(0, c.rowCount);
  const panelStyle = [
    `--panel-width:${c.width}px`,
    `--panel-scale:${c.scale}`,
    `--row-height:${Math.max(44, c.rowHeight)}px`,
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
    `--muted-rgb:${hexToRgbTriplet(c.mutedColor)}`
  ].join(";");

  const nextRates = new Map<number, number>();
  const html = `
    <section class="scoreboard winrate-board ${animateBoard ? "board-enter" : ""}" style="${panelStyle}">
      <div class="leaderboard-inner">
        <header class="score-header winrate-header">
          <span>#</span>
          <span>TEAM</span>
          <span>ALIVE</span>
          <span>POINTS</span>
          <span>WIN RATE</span>
        </header>
        <div class="winrate-rows">
          ${rows
            .map((row) => {
              const previous = previousWinRates.get(row.teamId);
              nextRates.set(row.teamId, row.winRate);
              const direction =
                previous === undefined ? "" : row.winRate > previous ? "wr-up" : row.winRate < previous ? "wr-down" : "";
              return renderWinRateRow(row, direction);
            })
            .join("") || `<div class="empty-overlay">WAITING FOR LIVE DATA</div>`}
        </div>
      </div>
    </section>
  `;
  previousWinRates = nextRates;
  return html;
}

function renderWinRateRow(row: WinRateRow, direction = ""): string {
  return `
    <article class="winrate-row ${row.teamEliminated ? "is-out" : ""} ${direction}" data-team-id="${row.teamId}" style="--team-accent:${row.accentColor}">
      <span class="wr-rank">#${row.rank}</span>
      <span class="wr-team">
        ${row.logoPath ? `<img src="${escapeHtml(row.logoPath)}" alt="" />` : `<i>${escapeHtml(row.shortName.slice(0, 2))}</i>`}
        <strong>${escapeHtml(row.shortName)}</strong>
      </span>
      <span>${row.memberCount}</span>
      <span>${row.points}</span>
      <span class="wr-percent">${row.winRate.toFixed(2)}%</span>
    </article>
  `;
}

function renderEliminatedOverlay(animateBoard = false): string {
  const c = normalizeOverlayClientConfig(config.overlay);
  const events = state.eliminatedEvents.slice(0, c.rowCount);
  const panelStyle = [
    `--panel-width:${c.width}px`,
    `--panel-scale:${c.scale}`,
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
    `--muted-rgb:${hexToRgbTriplet(c.mutedColor)}`
  ].join(";");

  const seenNow = new Set<string>();
  const cards = events
    .map((event) => {
      seenNow.add(event.id);
      const isNew = !knownEliminatedIds.has(event.id);
      return renderEliminatedCard(event, isNew);
    })
    .join("");
  knownEliminatedIds = seenNow;

  return `
    <section class="scoreboard eliminated-board ${animateBoard ? "board-enter" : ""}" style="${panelStyle}">
      <div class="leaderboard-inner">
        <header class="eliminated-title">ELIMINATED</header>
        <div class="eliminated-list">
          ${cards || `<div class="empty-overlay">NO TEAM ELIMINATED</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderEliminatedCard(event: PublicEliminatedEvent, isNew = false): string {
  const podiumClass = event.rank <= 3 ? `elim-podium elim-podium-${event.rank}` : "";
  return `
    <article class="eliminated-card ${podiumClass} ${isNew ? "card-new" : ""}" data-event-id="${escapeAttribute(event.id)}" style="--team-accent:${event.accentColor}">
      <div class="elim-logo">
        ${event.logoPath ? `<img src="${escapeHtml(event.logoPath)}" alt="" />` : `<span>${escapeHtml(event.shortName.slice(0, 2))}</span>`}
      </div>
      <div class="elim-data">
        <strong>${escapeHtml(event.teamName)}</strong>
        <span>${escapeHtml(event.playerName)} / ${event.elims} ELIMS</span>
      </div>
      <div class="elim-rank">#${event.rank}</div>
    </article>
  `;
}

function renderTerminalPage(): string {
  const entries = state.logs.slice(-180);
  return `
    <section class="tool-page terminal-page">
      <header class="tool-head">
        <div>
          <span class="eyebrow">Log</span>
          <h1>Terminal</h1>
        </div>
        <a href="/control">Điều khiển</a>
      </header>
      <div class="terminal-output">
        ${entries.map(renderTerminalLine).join("") || `<div class="terminal-line level-warn"><span>Chưa có log.</span></div>`}
      </div>
    </section>
  `;
}

function renderTerminalLine(entry: PublicLogEntry): string {
  return `
    <div class="terminal-line level-${entry.level}">
      <span>[${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}]</span>
      <span>[${escapeHtml(entry.source)}]</span>
      <span>[${escapeHtml(entry.level.toUpperCase())}]</span>
      <strong>${escapeHtml(entry.message)}</strong>
    </div>
  `;
}

function renderMatchDetailsPage(): string {
  const matchId = new URLSearchParams(location.search).get("matchId") || "";
  return `
    <section class="tool-page match-page">
      <header class="tool-head">
        <div>
          <span class="eyebrow">Stats</span>
          <h1>Match Details</h1>
        </div>
        <a href="/control">Điều khiển</a>
      </header>
      <form class="match-details-form" data-match-details-form>
        <input name="matchId" value="${escapeHtml(matchId)}" placeholder="Match ID" required />
        <button type="submit">Load</button>
      </form>
      <div class="match-details-body" data-match-details-body>
        ${matchId ? matchDetailsHtml || "Loading..." : "Nhập Match ID để xem thông tin trận."}
      </div>
    </section>
  `;
}

function renderEventFeed(): string {
  const events = (state.events || []).slice(0, 3);
  if (events.length === 0) return "";

  const seenNow = new Set<string>();
  const html = `
    <div class="event-feed">
      ${events
        .map((event) => {
          seenNow.add(event.id);
          const isNew = !knownEventIds.has(event.id);
          return `
            <article class="event-item event-${event.type} ${isNew ? "event-new" : ""}" data-event-id="${escapeAttribute(event.id)}" title="${escapeAttribute(event.message)}">
              <span class="event-tag">${eventLabel(event)}</span>
              <span class="event-killer">${formatEventName(eventPrimaryName(event), eventPrimaryTeam(event))}</span>
              <span class="event-arrow">></span>
              <span class="event-downed">${formatEventName(eventSecondaryName(event), eventSecondaryTeam(event))}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  // Update known set: keep currently visible ids only so we re-animate when an old
  // event scrolls back in if it ever does (unlikely but harmless).
  knownEventIds = seenNow;
  return html;
}

function eventLabel(event: PublicEvent): string {
  if (event.type === "dead") return "ELIM";
  if (event.type === "revive") return "REVIVE";
  if (event.type === "team_eliminated") return "TEAM OUT";
  return "KNOCK DOWN";
}

function eventPrimaryName(event: PublicEvent): string {
  return event.killerName || event.playerName || event.teamName || "";
}

function eventPrimaryTeam(event: PublicEvent): string {
  return event.killerTeam || event.teamName || "";
}

function eventSecondaryName(event: PublicEvent): string {
  if (event.type === "team_eliminated") return event.rank ? `#${event.rank}` : "";
  return event.downedName || event.victimName || "";
}

function eventSecondaryTeam(event: PublicEvent): string {
  return event.downedTeam || event.victimTeam || "";
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
  const scorePulseActive = animationsEnabled && (scorePulseUntil.get(team.teamId) || 0) > Date.now();
  const rowClasses = [
    "team-row",
    animationsEnabled && c.rowEnterAnimation !== "off" && (!previous || demoEnter) ? "new-row" : "",
    animationsEnabled && c.playerLostAnimation !== "off" && ((aliveChange < 0 && !hasRankMove) || demoLost) ? "player-lost" : "",
    isEliminated ? "team-eliminated" : "",
    animationsEnabled && c.moveAnimation !== "off" && (rankChange > 0 || demoMovedUp) ? "moved-up" : "",
    animationsEnabled && c.moveAnimation !== "off" && (rankChange < 0 || demoMovedDown) ? "moved-down" : "",
    team.rank <= 3 ? "podium-row" : "",
    scorePulseActive ? "points-up" : ""
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
          <a href="/winrate" target="_blank">Winrate</a>
          <a href="/eliminated" target="_blank">Eliminated</a>
          <a href="/terminal" target="_blank">Terminal</a>
          <a href="/match-details" target="_blank">Match details</a>
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
      ${selectInput("rowStyle", "Kiểu dòng", c.rowStyle, [
        ["classic", "Cổ điển"],
        ["flat", "Phẳng"],
        ["gradient", "Gradient"],
        ["minimal", "Tối giản"],
        ["neon", "Neon"]
      ])}
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

function bindMatchDetailsEvents(): void {
  const form = app.querySelector<HTMLFormElement>("[data-match-details-form]");
  const body = app.querySelector<HTMLElement>("[data-match-details-body]");
  const matchId = new URLSearchParams(location.search).get("matchId") || "";

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const nextMatchId = String(formData.get("matchId") || "").trim();
    if (!nextMatchId) return;
    history.replaceState(null, "", `/match-details?matchId=${encodeURIComponent(nextMatchId)}`);
    matchDetailsLoadedFor = "";
    matchDetailsHtml = "";
    void loadMatchDetails(nextMatchId, body);
  });

  if (matchId && matchDetailsLoadedFor !== matchId) {
    void loadMatchDetails(matchId, body);
  }
}

async function loadMatchDetails(matchId: string, target: HTMLElement | null): Promise<void> {
  if (target) target.textContent = "Loading...";
  matchDetailsLoadedFor = matchId;

  try {
    const response = await fetch(`/api/match-stats?matchId=${encodeURIComponent(matchId)}`);
    const payload = await response.json();
    if (!response.ok || payload.status === "error") {
      throw new Error(payload.message || `HTTP ${response.status}`);
    }

    matchDetailsHtml = renderMatchStatsPayload(payload);
    if (target) target.innerHTML = matchDetailsHtml;
  } catch (error) {
    matchDetailsHtml = `<div class="empty-note">${escapeHtml(error instanceof Error ? error.message : "Không thể tải dữ liệu trận")}</div>`;
    if (target) target.innerHTML = matchDetailsHtml;
  }
}

function renderMatchStatsPayload(payload: unknown): string {
  const data = normalizeMatchStatsPayload(payload);
  const teams = flattenTeamStats(data).sort((a, b) => Number(a.match_rank || 999) - Number(b.match_rank || 999));
  const matchInfo = Array.isArray(data.match_info) ? data.match_info[0] : null;

  return `
    <div class="match-summary-grid">
      <div><span>Match</span><strong>${escapeHtml(String(matchInfo?.match_id || ""))}</strong></div>
      <div><span>Teams</span><strong>${teams.length}</strong></div>
      <div><span>Players</span><strong>${teams.reduce((sum, team) => sum + (Array.isArray(team.player_data) ? team.player_data.length : 0), 0)}</strong></div>
    </div>
    <div class="match-team-list">
      ${teams.map(renderMatchTeamCard).join("") || `<div class="empty-note">Không có dữ liệu team.</div>`}
    </div>
  `;
}

function normalizeMatchStatsPayload(payload: unknown): Record<string, any> {
  const raw = payload as Record<string, any>;
  const level1 = raw?.data;
  const level2 = level1?.data;
  if (level2 && (level2.match_info || level2.team_stats || level2.total_stats)) return level2;
  if (level1 && (level1.match_info || level1.team_stats || level1.total_stats)) return level1;
  return raw || {};
}

function flattenTeamStats(data: Record<string, any>): Array<Record<string, any>> {
  if (Array.isArray(data.total_stats)) return data.total_stats;
  if (Array.isArray(data.team_stats)) {
    return data.team_stats.flatMap((match: Record<string, any>) => (Array.isArray(match.team_stats) ? match.team_stats : []));
  }
  return [];
}

function renderMatchTeamCard(team: Record<string, any>): string {
  const players = Array.isArray(team.player_data) ? team.player_data : [];
  return `
    <article class="match-team-card">
      <header>
        <strong>#${escapeHtml(String(team.match_rank || "-"))} ${escapeHtml(String(team.team_name || "Unknown"))}</strong>
        <span>${Number(team.total_score || 0)} PTS / ${Number(team.kills || 0)} KILLS</span>
      </header>
      <div class="match-player-grid">
        ${players
          .map(
            (player: Record<string, any>) => `
              <div>
                <strong>${escapeHtml(String(player.player_name || player.player_id || "Player"))}</strong>
                <span>${Number(player.kills || 0)} K / ${Number(player.damage || 0)} DMG / ${Number(player.knock_down || 0)} KD</span>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
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

async function createAndStartListener(): Promise<void> {
  const selected = getSelectedGroup();
  const filePath = normalizeText(logPathDraft ?? logSource.path ?? state.sourceLog);
  listenerMessage = "";

  if (!selected) {
    listenerMessage = "Chọn hoặc tạo nhóm trước khi chạy tools.";
    render();
    return;
  }

  if (!filePath) {
    listenerMessage = "Nhập đường dẫn file log debugger.";
    render();
    return;
  }

  listenerBusy = true;
  listenerMessage = "Đang tạo listener...";
  render();

  try {
    const createResponse = await fetch("/create-listener", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath,
        selectedGroupId: selected.groupId,
        global: { players },
        groups: groups.map((group) => ({
          groupId: group.groupId,
          matchIds: group.matches.map((match) => match.matchId),
          teamNames: group.teamNames,
          note: group.note
        }))
      })
    });
    const createResult = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) throw new Error(createResult.message || `HTTP ${createResponse.status}`);

    listenerState = {
      listenerID: String(createResult.listenerID || ""),
      running: false,
      logSource: { ...logSource, path: filePath, mode: "file" }
    };
    logSource = listenerState.logSource;
    logPathDraft = filePath;

    listenerMessage = "Đang start listener...";
    render();
    await updateListenerLifecycle("start-listener", `Đang chạy ${selected.groupId}`, false);
  } catch (error) {
    listenerMessage = error instanceof Error ? error.message : String(error);
  } finally {
    listenerBusy = false;
    render();
  }
}

async function updateListenerLifecycle(endpoint: "start-listener" | "stop-listener" | "kill-listener", successMessage: string, manageBusy = true): Promise<void> {
  if (!listenerState.listenerID) {
    listenerMessage = "Chưa có listener để thao tác.";
    render();
    return;
  }

  if (manageBusy) {
    listenerBusy = true;
    listenerMessage = "Đang xử lý listener...";
    render();
  }

  try {
    const response = await fetch(`/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listenerID: listenerState.listenerID })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);

    listenerState = normalizeListenerState(result, listenerState.listenerID);
    if (endpoint === "kill-listener") listenerState.listenerID = null;
    logSource = { ...logSource, ...listenerState.logSource };
    listenerMessage = successMessage;
  } catch (error) {
    listenerMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (manageBusy) {
      listenerBusy = false;
      render();
    }
  }
}

function bindGroupManagerEvents(): void {
  app.querySelector<HTMLInputElement>("[data-group-search]")?.addEventListener("input", (event) => {
    groupSearch = (event.target as HTMLInputElement).value;
    render();
  });

  app.querySelector<HTMLInputElement>("[data-run-file-path]")?.addEventListener("input", (event) => {
    logPathDraft = (event.target as HTMLInputElement).value;
  });

  app.querySelector<HTMLButtonElement>("[data-run-create-start]")?.addEventListener("click", () => {
    void createAndStartListener();
  });

  app.querySelector<HTMLButtonElement>("[data-run-stop]")?.addEventListener("click", () => {
    void updateListenerLifecycle("stop-listener", "Đã dừng listener");
  });

  app.querySelector<HTMLButtonElement>("[data-run-kill]")?.addEventListener("click", () => {
    void updateListenerLifecycle("kill-listener", "Đã hủy listener");
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
    const matchIds = parseMatchIds(normalizeText(data.get("matchId")));
    const description = normalizeText(data.get("description"));
    const existing = new Set(selected.matches.map((match) => match.matchId));
    const createdAt = new Date().toISOString();
    const nextMatches = matchIds
      .filter((matchId) => !existing.has(matchId))
      .map((matchId) => ({
        matchId,
        description,
        addTime: createdAt
      }));
    if (nextMatches.length === 0) return;
    selected.matches.push(...nextMatches);
    void saveGroups();
  });

  app.querySelectorAll<HTMLButtonElement>("[data-match-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const matchId = button.dataset.matchOpen || "";
      if (matchId) window.open(`/match-details?matchId=${encodeURIComponent(matchId)}`, "_blank");
    });
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
  const totalMatches = groups.reduce((sum, group) => sum + group.matches.length, 0);
  const totalTeams = groups.reduce((sum, group) => sum + group.teamNames.length, 0);

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

      <div class="manager-stats">
        <div><span>Nhóm</span><strong>${groups.length}</strong></div>
        <div><span>Trận</span><strong>${totalMatches}</strong></div>
        <div><span>Đội hôm nay</span><strong>${totalTeams}</strong></div>
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

      ${renderRunToolsPanel(selectedGroup)}

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
                  ${selectedGroup.matches[0] ? `<button type="button" data-match-open="${escapeAttribute(selectedGroup.matches[0].matchId)}">Xem trận đầu</button>` : ""}
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
                <input name="matchId" placeholder="Một hoặc nhiều ID trận" required />
                <input name="description" placeholder="Mô tả" />
                <button type="submit">Thêm</button>
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

function renderRunToolsPanel(selectedGroup: ManagedGroup | null): string {
  const selectedPath = logPathDraft ?? logSource.path ?? state.sourceLog ?? "";
  const activePath = logSource.currentPath || state.sourceLog || logSource.path || "";
  const fileName = activePath ? activePath.split(/[\\/]/).pop() || activePath : "Chưa gắn log";
  const listenerId = listenerState.listenerID || "";
  const canRun = Boolean(selectedGroup && selectedPath && !listenerBusy);
  const runState = listenerId ? (listenerState.running ? "Đang chạy" : "Đã tạo") : logSource.running ? "Đang quét" : "Chưa tạo";

  return `
    <section class="run-tools-panel">
      <div class="detail-head">
        <div>
          <span class="eyebrow">Run tools</span>
          <h3>Listener trận đấu</h3>
        </div>
        <span class="run-state ${listenerId && listenerState.running ? "is-live" : ""}">${escapeHtml(runState)}</span>
      </div>
      <div class="run-tools-grid">
        <label class="wide-field">
          <span>File log debugger</span>
          <input
            data-run-file-path
            type="text"
            value="${escapeHtml(selectedPath)}"
            placeholder="C:\\duong\\dan\\debugger-2026-05-14T08-39-14.log"
            spellcheck="false"
          />
        </label>
        <div class="run-tools-meta">
          <span>Nhóm chạy</span>
          <strong>${selectedGroup ? escapeHtml(selectedGroup.groupId) : "Chưa chọn nhóm"}</strong>
        </div>
        <div class="run-tools-meta">
          <span>Log hiện tại</span>
          <strong title="${escapeHtml(activePath || fileName)}">${escapeHtml(fileName)}</strong>
        </div>
      </div>
      <div class="run-actions">
        <button type="button" data-run-create-start ${canRun ? "" : "disabled"}>${listenerBusy ? "Đang xử lý..." : "Tạo & chạy"}</button>
        <button type="button" data-run-stop ${listenerId && listenerState.running && !listenerBusy ? "" : "disabled"}>Dừng</button>
        <button type="button" class="danger-button" data-run-kill ${listenerId && !listenerBusy ? "" : "disabled"}>Hủy</button>
        <a href="/terminal" target="_blank">Terminal</a>
      </div>
      ${listenerMessage ? `<div class="match-stats-status">${escapeHtml(listenerMessage)}</div>` : ""}
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
  const time = match.addTime ? new Date(match.addTime).toLocaleString() : "";
  return `
    <div class="match-item">
      <div>
        <strong>${escapeHtml(match.matchId)}</strong>
        ${match.description ? `<span>${escapeHtml(match.description)}</span>` : ""}
        ${time ? `<em>${escapeHtml(time)}</em>` : ""}
      </div>
      <div class="match-actions">
        <button type="button" data-match-open="${escapeAttribute(match.matchId)}">Xem</button>
        <button type="button" data-match-delete="${escapeAttribute(match.matchId)}">Xóa</button>
      </div>
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

function normalizeListenerState(input: unknown, fallbackListenerID: string | null = listenerState.listenerID): ListenerState {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawLogSource = record.logSource && typeof record.logSource === "object" ? (record.logSource as Record<string, unknown>) : {};
  const nextLogSource: LogSource = {
    path: typeof rawLogSource.path === "string" ? rawLogSource.path : logSource.path,
    mode: rawLogSource.mode === "file" ? "file" : "auto",
    running: Boolean(record.running ?? rawLogSource.running),
    currentPath: typeof rawLogSource.currentPath === "string" ? rawLogSource.currentPath : null
  };

  return {
    listenerID: typeof record.listenerID === "string" && record.listenerID ? record.listenerID : fallbackListenerID,
    running: Boolean(record.running),
    logSource: nextLogSource
  };
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
