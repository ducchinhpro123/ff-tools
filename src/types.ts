export interface TeamConfig {
  teamId: number;
  shortName: string;
  displayName: string;
  basePoints: number;
  logoPath: string;
  accentColor: string;
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

export interface PublicState {
  sourceLog: string | null;
  sourceLogUpdatedAt: string | null;
  matchEnded: boolean;
  teams: TeamRow[];
}

export interface PublicConfig {
  teams: TeamConfig[];
  overlay: OverlayConfig;
}
