import { assetUrl } from "./paths";
import type { MatchStatsBaseTeam, PlayerRosterEntry, PublicEvent, PublicState, TeamConfig, TeamRow } from "./types";

interface TeamInternal {
  teamId: number;
  logName: string;
  liveScore: number;
  scoreOrder: number;
  playerIds: Set<string>;
}

interface PlayerInternal {
  playerId: string;
  originPlayerId: string;
  name: string;
  teamId: number;
  rosterTeamName: string;
  rosterTeamId: number | null;
  alive: boolean;
}

interface SortableTeamRow extends TeamRow {
  scoreOrder: number;
  historicalElims: number;
  historicalRankPoint: number;
}

export class ScoreboardState {
  private teams = new Map<number, TeamInternal>();
  private players = new Map<string, PlayerInternal>();
  private pendingDead = new Set<string>();
  private playerOrigins = new Map<string, { originPlayerId: string; name: string }>();
  private playerRoster = new Map<string, PlayerRosterEntry>();
  private teamConfigs: TeamConfig[] = [];
  private teamConfig = new Map<number, TeamConfig>();
  private matchStatsBase = new Map<string, MatchStatsBaseTeam>();
  private sourceToScoreTeam = new Map<number, number>();
  private sourceScoreVotes = new Map<number, Map<number, number>>();
  private currentEventId: string | null = null;
  private eventKillerSourceTeams = new Set<number>();
  private eventScoreIncreases = new Set<number>();
  private lastDeadPlayerByEvent = new Map<string, string>();
  private eliminatedTeamIds = new Set<number>();
  private events: PublicEvent[] = [];
  private eventCounter = 0;
  private scoreOrderCounter = 0;
  sourceLog: string | null = null;
  sourceLogUpdatedAt: string | null = null;
  matchEnded = false;

  reset(sourceLog: string | null = null): void {
    this.teams.clear();
    this.players.clear();
    this.pendingDead.clear();
    this.playerOrigins.clear();
    this.sourceToScoreTeam.clear();
    this.sourceScoreVotes.clear();
    this.currentEventId = null;
    this.eventKillerSourceTeams.clear();
    this.eventScoreIncreases.clear();
    this.lastDeadPlayerByEvent.clear();
    this.eliminatedTeamIds.clear();
    this.events = [];
    this.eventCounter = 0;
    this.scoreOrderCounter = 0;
    this.sourceLog = sourceLog;
    this.sourceLogUpdatedAt = null;
    this.matchEnded = false;
  }

  setTeamConfig(configs: TeamConfig[]): void {
    this.teamConfigs = configs;
    this.teamConfig = new Map(configs.map((config) => [config.teamId, config]));
  }

  setPlayerRoster(players: PlayerRosterEntry[]): void {
    this.playerRoster = new Map(players.map((player) => [player.playerId, player]));
  }

  setMatchStatsBase(teams: MatchStatsBaseTeam[]): void {
    this.matchStatsBase.clear();

    for (const team of teams) {
      const teamName = String(team.teamName || "").trim();
      if (!teamName) continue;

      const key = this.normalizeTeamName(teamName);
      const existing = this.matchStatsBase.get(key);
      if (existing) {
        existing.totalScore += team.totalScore;
        existing.elims += team.elims;
        existing.rankPoint += team.rankPoint;
        existing.matchCount += team.matchCount;
        if (existing.teamId === null) existing.teamId = team.teamId;
        continue;
      }

      this.matchStatsBase.set(key, { ...team, teamName });
    }
  }

  consumeLine(line: string): boolean {
    this.updateCurrentEvent(line);

    const playerJoin = line.match(/Player Join,\s*(\d+),\s*(\d+),\s*(.*?),\s*[^,]*\s*$/);
    if (playerJoin) {
      this.playerOrigins.set(playerJoin[2], {
        originPlayerId: playerJoin[1],
        name: playerJoin[3].trim()
      });
      return true;
    }

    const teamInit = line.match(/OnTeamScoreInited -> TeamName: (.*?) TeamID: (\d+)/);
    if (teamInit) {
      const teamId = Number(teamInit[2]);
      this.ensureTeam(teamId).logName = teamInit[1].trim();
      return true;
    }

    const addPlayer = line.match(/\[UIModelSpectator\] AddPlayer id(\d+),name(.*),gsTeam(\d+)/);
    if (addPlayer) {
      const playerId = addPlayer[1];
      const origin = this.playerOrigins.get(playerId);
      const originPlayerId = origin?.originPlayerId || playerId;
      const roster = this.playerRoster.get(originPlayerId);
      const rosterTeamName = roster?.teamName || "";
      const teamId = Number(addPlayer[3]);
      if (!this.players.has(playerId)) {
        const player = {
          playerId,
          originPlayerId,
          name: origin?.name || addPlayer[2].trim(),
          teamId,
          rosterTeamName,
          rosterTeamId: this.teamIdForRosterName(rosterTeamName),
          alive: !this.pendingDead.has(playerId)
        };
        this.players.set(playerId, player);
        this.ensureTeam(teamId).playerIds.add(playerId);
      }
      return true;
    }

    const knockdown = line.match(/Player '(\d+)' Knock Down, by '(\d+)'/);
    if (knockdown) {
      this.addKnockdownEvent(line, knockdown[1], knockdown[2]);
      return true;
    }

    const death = line.match(/Player (\d+) Dead, killed by (\d+)/);
    if (death) {
      const playerId = death[1];
      if (this.currentEventId) {
        this.lastDeadPlayerByEvent.set(this.currentEventId, playerId);
      }
      const killer = this.players.get(death[2]);
      if (killer) this.eventKillerSourceTeams.add(killer.teamId);
      const player = this.players.get(playerId);
      if (player) {
        player.alive = false;
      } else {
        this.pendingDead.add(playerId);
      }
      return true;
    }

    const teamEliminated = line.match(/isTeamLastKill:\s*True\b/);
    if (teamEliminated) {
      const deadPlayerId = this.currentEventId ? this.lastDeadPlayerByEvent.get(this.currentEventId) : null;
      const deadPlayer = deadPlayerId ? this.players.get(deadPlayerId) : null;
      const scoreTeamId = deadPlayer ? this.scoreTeamForPlayer(deadPlayer) : null;
      if (scoreTeamId) {
        this.eliminatedTeamIds.add(scoreTeamId);
        for (const player of this.players.values()) {
          if (this.scoreTeamForPlayer(player) === scoreTeamId) player.alive = false;
        }
      }
      return true;
    }

    const revive = line.match(/Revive Player (\d+),/);
    if (revive) {
      const playerId = revive[1];
      const player = this.players.get(playerId);
      if (player) {
        player.alive = true;
        this.pendingDead.delete(playerId);
        const scoreTeamId = this.scoreTeamForPlayer(player);
        if (scoreTeamId) this.eliminatedTeamIds.delete(scoreTeamId);
      }
      return true;
    }

    const pendingRevive = line.match(/NotifyPlayerEnterPendingRevive -> (\d+)/);
    if (pendingRevive) {
      const playerId = pendingRevive[1];
      const player = this.players.get(playerId);
      if (player) {
        player.alive = false;
      } else {
        this.pendingDead.add(playerId);
      }
      return true;
    }

    const quitRevive = line.match(/Player quit revive, (\d+)/);
    if (quitRevive) {
      const playerId = quitRevive[1];
      const player = this.players.get(playerId);
      if (player) {
        player.alive = false;
      } else {
        this.pendingDead.add(playerId);
      }
      return true;
    }

    const score = line.match(/OnTeamScoreChanged -> TeamID: (\d+) TeamScore: (\d+)/);
    if (score) {
      const team = this.ensureTeam(Number(score[1]));
      const nextScore = Number(score[2]);
      if (nextScore > team.liveScore) {
        this.eventScoreIncreases.add(team.teamId);
      }
      team.liveScore = nextScore;
      team.scoreOrder = this.scoreOrderCounter++;
      return true;
    }

    if (line.includes("[MatchResult] receive S2C_RUDP_MatchEnd_Res from GS")) {
      this.matchEnded = true;
      return true;
    }

    return false;
  }

  toPublicState(): PublicState {
    const rows = Array.from(this.teams.values()).map((team) => this.toRow(team));
    const seenHistoricalTeams = new Set(
      rows.flatMap((row) => [this.normalizeTeamName(row.name), this.normalizeTeamName(row.shortName)].filter(Boolean))
    );

    for (const historicalTeam of this.matchStatsBase.values()) {
      const key = this.normalizeTeamName(historicalTeam.teamName);
      if (!key || seenHistoricalTeams.has(key)) continue;
      rows.push(this.toHistoricalRow(historicalTeam));
      seenHistoricalTeams.add(key);
    }

    rows.sort((a, b) => {
      return (
        b.totalPoints - a.totalPoints ||
        b.historicalElims - a.historicalElims ||
        b.historicalRankPoint - a.historicalRankPoint ||
        b.liveScore - a.liveScore ||
        a.scoreOrder - b.scoreOrder ||
        b.alive - a.alive ||
        a.teamId - b.teamId
      );
    });

    rows.forEach((row, index) => {
      row.rank = index + 1;
    });

    const publicRows = rows.map(
      ({ scoreOrder: _scoreOrder, historicalElims: _historicalElims, historicalRankPoint: _historicalRankPoint, ...row }) => row
    );

    return {
      sourceLog: this.sourceLog,
      sourceLogUpdatedAt: this.sourceLogUpdatedAt,
      matchEnded: this.matchEnded,
      events: this.events,
      teams: publicRows
    };
  }

  private addKnockdownEvent(line: string, downedId: string, killerId: string): void {
    const downed = this.playerInfo(downedId);
    const killer = this.playerInfo(killerId);
    const timestamp = line.match(/^\[([^\]]+)\]/)?.[1] || null;

    this.events.unshift({
      id: `${++this.eventCounter}`,
      type: "knockdown",
      timestamp,
      eventId: this.currentEventId,
      downedId,
      killerId,
      downedName: downed.name,
      killerName: killer.name,
      downedTeam: downed.teamName,
      killerTeam: killer.teamName,
      message: `${killer.name} knocked ${downed.name}`
    });

    this.events = this.events.slice(0, 8);
  }

  private playerInfo(playerId: string): { name: string; teamName: string } {
    const player = this.players.get(playerId);
    const origin = this.playerOrigins.get(playerId);
    const originPlayerId = player?.originPlayerId || origin?.originPlayerId || playerId;
    const roster = this.playerRoster.get(originPlayerId);
    const teamName = player?.rosterTeamName || roster?.teamName || this.teamNameForPlayer(player) || "";
    const name = player?.name || origin?.name || roster?.playerName || `ID ${originPlayerId}`;

    return { name, teamName };
  }

  private teamNameForPlayer(player: PlayerInternal | undefined): string {
    if (!player) return "";
    const scoreTeamId = this.scoreTeamForPlayer(player);
    const team = scoreTeamId ? this.teams.get(scoreTeamId) : undefined;
    const config = scoreTeamId ? this.teamConfig.get(scoreTeamId) : undefined;
    return team?.logName || config?.displayName || config?.shortName || "";
  }

  private updateCurrentEvent(line: string): void {
    const event = line.match(/^\[[^\]]+\]\[\d+\]\[(\d+)\]/)?.[1] || null;
    if (!event || event === this.currentEventId) return;

    this.applyEventMapping();
    this.currentEventId = event;
  }

  private applyEventMapping(): void {
    if (this.eventKillerSourceTeams.size === 1 && this.eventScoreIncreases.size === 1) {
      const sourceTeamId = Array.from(this.eventKillerSourceTeams)[0];
      const scoreTeamId = Array.from(this.eventScoreIncreases)[0];
      this.voteTeamMapping(sourceTeamId, scoreTeamId);
    }

    this.eventKillerSourceTeams.clear();
    this.eventScoreIncreases.clear();
  }

  private voteTeamMapping(sourceTeamId: number, scoreTeamId: number): void {
    let votes = this.sourceScoreVotes.get(sourceTeamId);
    if (!votes) {
      votes = new Map<number, number>();
      this.sourceScoreVotes.set(sourceTeamId, votes);
    }

    votes.set(scoreTeamId, (votes.get(scoreTeamId) || 0) + 1);

    let bestScoreTeam = scoreTeamId;
    let bestVotes = 0;
    for (const [candidateScoreTeam, voteCount] of votes) {
      if (voteCount > bestVotes) {
        bestScoreTeam = candidateScoreTeam;
        bestVotes = voteCount;
      }
    }

    this.sourceToScoreTeam.set(sourceTeamId, bestScoreTeam);
  }

  private ensureTeam(teamId: number): TeamInternal {
    let team = this.teams.get(teamId);
    if (!team) {
      team = {
        teamId,
        logName: "",
        liveScore: 0,
        scoreOrder: Number.MAX_SAFE_INTEGER,
        playerIds: new Set<string>()
      };
      this.teams.set(teamId, team);
    }
    return team;
  }

  private toRow(team: TeamInternal): SortableTeamRow {
    const config = this.findConfigForTeam(team);
    const players = Array.from(this.players.values()).filter((player) => {
      return this.scoreTeamForPlayer(player) === team.teamId;
    });
    const rosterConfig = this.findRosterConfigForPlayers(players);
    const rosterName = this.rosterNameForPlayers(players);
    const historical = this.findHistoricalForTeam(team, config, rosterConfig, rosterName);
    const teamEliminated = this.eliminatedTeamIds.has(team.teamId);
    const rawAlive = teamEliminated ? 0 : players.filter((player) => player.alive).length;
    const alive = Math.min(4, rawAlive);
    const playerCount = Math.min(4, Math.max(players.length, rawAlive));
    const eliminated = Math.max(0, playerCount - alive);
    const name = rosterConfig?.displayName || rosterName || team.logName || config?.displayName || `Team ${team.teamId}`;
    const shortName = rosterConfig?.shortName || rosterName || config?.shortName || this.shortNameFrom(name);
    const basePoints = historical?.totalScore ?? rosterConfig?.basePoints ?? config?.basePoints ?? 0;

    return {
      rank: 0,
      teamId: team.teamId,
      name,
      shortName,
      logoPath: assetUrl(rosterConfig?.logoPath || config?.logoPath || ""),
      accentColor: rosterConfig?.accentColor || config?.accentColor || "#ff3b30",
      basePoints,
      liveScore: team.liveScore,
      totalPoints: basePoints + team.liveScore,
      teamEliminated: teamEliminated || (playerCount > 0 && alive === 0),
      scoreOrder: team.scoreOrder,
      historicalElims: historical?.elims ?? 0,
      historicalRankPoint: historical?.rankPoint ?? 0,
      alive,
      eliminated,
      players: playerCount
    };
  }

  private toHistoricalRow(team: MatchStatsBaseTeam): SortableTeamRow {
    const config = this.findConfigByName(team.teamName);
    const name = config?.displayName || team.teamName;
    const shortName = config?.shortName || this.shortNameFrom(name);

    return {
      rank: 0,
      teamId: config?.teamId || team.teamId || this.syntheticTeamId(team.teamName),
      name,
      shortName,
      logoPath: assetUrl(config?.logoPath || ""),
      accentColor: config?.accentColor || "#ff3b30",
      basePoints: team.totalScore,
      liveScore: 0,
      totalPoints: team.totalScore,
      teamEliminated: false,
      scoreOrder: Number.MAX_SAFE_INTEGER,
      historicalElims: team.elims,
      historicalRankPoint: team.rankPoint,
      alive: 0,
      eliminated: 0,
      players: 0
    };
  }

  private scoreTeamForPlayer(player: PlayerInternal): number | null {
    if (player.rosterTeamId) return player.rosterTeamId;

    const mappedTeamId = this.sourceToScoreTeam.get(player.teamId);
    if (mappedTeamId) return mappedTeamId;

    for (const [sourceTeamId, scoreTeamId] of this.sourceToScoreTeam) {
      if (sourceTeamId !== player.teamId && scoreTeamId === player.teamId) return null;
    }

    return player.teamId;
  }

  private teamIdForRosterName(teamName: string): number | null {
    if (!teamName) return null;
    const normalized = this.normalizeTeamName(teamName);
    const config = this.teamConfigs.find((team) => {
      return (
        this.normalizeTeamName(team.shortName) === normalized ||
        this.normalizeTeamName(team.displayName) === normalized
      );
    });
    return config?.teamId || null;
  }

  private rosterNameForPlayers(players: PlayerInternal[]): string {
    const counts = new Map<string, number>();
    for (const player of players) {
      if (!player.rosterTeamName) continue;
      counts.set(player.rosterTeamName, (counts.get(player.rosterTeamName) || 0) + 1);
    }

    let bestName = "";
    let bestCount = 0;
    for (const [teamName, count] of counts) {
      if (count > bestCount) {
        bestName = teamName;
        bestCount = count;
      }
    }

    return bestName;
  }

  private findRosterConfigForPlayers(players: PlayerInternal[]): TeamConfig | undefined {
    const rosterName = this.rosterNameForPlayers(players);
    if (!rosterName) return undefined;
    const normalized = this.normalizeTeamName(rosterName);
    return this.teamConfigs.find((team) => {
      return (
        this.normalizeTeamName(team.shortName) === normalized ||
        this.normalizeTeamName(team.displayName) === normalized
      );
    });
  }

  private findHistoricalForTeam(
    team: TeamInternal,
    config: TeamConfig | undefined,
    rosterConfig: TeamConfig | undefined,
    rosterName: string
  ): MatchStatsBaseTeam | undefined {
    const candidates = [
      team.logName,
      rosterName,
      config?.displayName,
      config?.shortName,
      rosterConfig?.displayName,
      rosterConfig?.shortName
    ];

    for (const candidate of candidates) {
      const key = this.normalizeTeamName(String(candidate || ""));
      const historical = key ? this.matchStatsBase.get(key) : undefined;
      if (historical) return historical;
    }

    return undefined;
  }

  private findConfigForTeam(team: TeamInternal): TeamConfig | undefined {
    if (team.logName) {
      const normalizedLogName = this.normalizeTeamName(team.logName);
      const byName = this.findConfigByName(normalizedLogName);
      return byName;
    }

    return this.teamConfig.get(team.teamId);
  }

  private findConfigByName(teamName: string): TeamConfig | undefined {
    const normalized = this.normalizeTeamName(teamName);
    return this.teamConfigs.find((config) => {
      return (
        this.normalizeTeamName(config.displayName) === normalized ||
        this.normalizeTeamName(config.shortName) === normalized
      );
    });
  }

  private normalizeTeamName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .toUpperCase();
  }

  private shortNameFrom(name: string): string {
    const words = name
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return "T";
    if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
    return words
      .slice(0, 4)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  private syntheticTeamId(teamName: string): number {
    let hash = 0;
    for (const character of teamName) {
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }
    return -1 * (hash || 1);
  }
}
