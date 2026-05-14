import { assetUrl } from "./paths";
import type { PlayerRosterEntry, PublicState, TeamConfig, TeamRow } from "./types";

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
}

export class ScoreboardState {
  private teams = new Map<number, TeamInternal>();
  private players = new Map<string, PlayerInternal>();
  private pendingDead = new Set<string>();
  private playerOrigins = new Map<string, { originPlayerId: string; name: string }>();
  private playerRoster = new Map<string, PlayerRosterEntry>();
  private teamConfigs: TeamConfig[] = [];
  private teamConfig = new Map<number, TeamConfig>();
  private sourceToScoreTeam = new Map<number, number>();
  private sourceScoreVotes = new Map<number, Map<number, number>>();
  private currentEventId: string | null = null;
  private eventKillerSourceTeams = new Set<number>();
  private eventScoreIncreases = new Set<number>();
  private lastDeadPlayerByEvent = new Map<string, string>();
  private eliminatedTeamIds = new Set<number>();
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
    rows.sort((a, b) => {
      return (
        b.totalPoints - a.totalPoints ||
        b.liveScore - a.liveScore ||
        a.scoreOrder - b.scoreOrder ||
        b.alive - a.alive ||
        a.teamId - b.teamId
      );
    });

    rows.forEach((row, index) => {
      row.rank = index + 1;
    });

    const publicRows = rows.map(({ scoreOrder: _scoreOrder, ...row }) => row);

    return {
      sourceLog: this.sourceLog,
      sourceLogUpdatedAt: this.sourceLogUpdatedAt,
      matchEnded: this.matchEnded,
      teams: publicRows
    };
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
    const teamEliminated = this.eliminatedTeamIds.has(team.teamId);
    const alive = teamEliminated ? 0 : players.filter((player) => player.alive).length;
    const eliminated = Math.max(0, players.length - alive);
    const rosterName = this.rosterNameForPlayers(players);
    const name = rosterConfig?.displayName || rosterName || team.logName || config?.displayName || `Team ${team.teamId}`;
    const shortName = rosterConfig?.shortName || rosterName || config?.shortName || this.shortNameFrom(name);
    const basePoints = rosterConfig?.basePoints ?? config?.basePoints ?? 0;

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
      teamEliminated: teamEliminated || (players.length > 0 && alive === 0),
      scoreOrder: team.scoreOrder,
      alive,
      eliminated,
      players: players.length
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

  private findConfigForTeam(team: TeamInternal): TeamConfig | undefined {
    if (team.logName) {
      const normalizedLogName = this.normalizeTeamName(team.logName);
      const byName = this.teamConfigs.find((config) => {
        return this.normalizeTeamName(config.displayName) === normalizedLogName;
      });
      return byName;
    }

    return this.teamConfig.get(team.teamId);
  }

  private normalizeTeamName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
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
}
