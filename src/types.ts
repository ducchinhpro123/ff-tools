export interface TeamConfig {
  teamId: number;
  shortName: string;
  displayName: string;
  basePoints: number;
  logoPath: string;
  accentColor: string;
}

export interface MatchStatsBaseTeam {
  teamName: string;
  teamId: number | null;
  totalScore: number;
  elims: number;
  rankPoint: number;
  matchCount: number;
}

export interface PlayerRosterEntry {
  teamName: string;
  playerId: string;
  playerName: string;
}

export interface ManagedGroupMatch {
  matchId: string;
  description: string;
  addTime: string;
}

export interface ManagedGroup {
  groupId: string;
  note: string;
  createdAt: string;
  matches: ManagedGroupMatch[];
  teamNames: string[];
}

export interface ManagedPlayer extends PlayerRosterEntry {
  createdAt: string;
}

export interface OverlayConfig {
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

export interface TeamRow {
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

export interface WinRateRow {
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

export interface PublicEliminatedEvent {
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

export interface PublicLogEntry {
  id: string;
  timestamp: string;
  source: "server" | "tailer" | "raw";
  level: "info" | "warn" | "error" | "success" | "debug";
  message: string;
}

export interface PublicEvent {
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

export interface PublicState {
  sourceLog: string | null;
  sourceLogUpdatedAt: string | null;
  matchEnded: boolean;
  events: PublicEvent[];
  eliminatedEvents: PublicEliminatedEvent[];
  winRates: WinRateRow[];
  logs: PublicLogEntry[];
  teams: TeamRow[];
}

export interface PublicConfig {
  teams: TeamConfig[];
  overlay: OverlayConfig;
}
