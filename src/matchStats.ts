const MATCH_STATS_ENDPOINT = "https://matchstats.sea.ffesports.com/api/match_stats/match_data";
const MATCH_STATS_SIGN = "8665d8e498e24059ac460b2c6febe1d0";
const MATCH_STATS_BATCH_SIZE = 8;

export interface MatchStatsApiResponse {
  code: number;
  status: string;
  msg?: string;
  data?: {
    match_info?: unknown[];
    team_stats?: MatchStatsByMatch[];
  };
}

export interface MatchStatsByMatch {
  match_id?: string;
  team_stats?: MatchStatsTeam[];
}

export interface MatchStatsTeam {
  team_id?: number | string;
  team_name?: string;
  match_rank?: number | string;
  total_score?: number | string;
  kills?: number | string;
  rank_point?: number | string;
  survival_score?: number | string;
}

export interface AggregatedMatchStatsTeam {
  teamName: string;
  teamId: number | null;
  totalScore: number;
  elims: number;
  rankPoint: number;
  matchCount: number;
}

export interface AggregatedMatchStats {
  teams: AggregatedMatchStatsTeam[];
  matchCount: number;
  failedBatches: number;
}

interface MatchStatsFetchOptions {
  fetcher?: typeof fetch;
}

export function normalizeMatchIds(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : input.split(/[\n,;]+/);
  const seen = new Set<string>();
  const matchIds: string[] = [];

  for (const value of values) {
    const matchId = String(value || "").trim();
    if (!matchId || seen.has(matchId)) continue;
    seen.add(matchId);
    matchIds.push(matchId);
  }

  return matchIds;
}

export async function fetchMatchStatsBatch(
  matchIdsInput: string | string[],
  options: MatchStatsFetchOptions = {}
): Promise<MatchStatsApiResponse> {
  const matchIds = normalizeMatchIds(matchIdsInput);
  if (matchIds.length === 0) {
    throw new Error("matchIds là bắt buộc");
  }
  if (matchIds.length > MATCH_STATS_BATCH_SIZE) {
    throw new Error(`Không thể yêu cầu quá ${MATCH_STATS_BATCH_SIZE} ID trận trong một lô`);
  }

  const fetcher = options.fetcher || fetch;
  const response = await fetcher(MATCH_STATS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      match_ids: matchIds,
      single_match_id: [],
      _ts: Date.now(),
      _sign: MATCH_STATS_SIGN
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP dữ liệu trận ${response.status}`);
  }

  return (await response.json()) as MatchStatsApiResponse;
}

export async function fetchMatchStats(
  matchIdsInput: string | string[],
  options: MatchStatsFetchOptions = {}
): Promise<{ status: "success" | "error"; message: string; data?: MatchStatsApiResponse }> {
  try {
    const response = await fetchMatchStatsBatch(matchIdsInput, options);
    if (response.code === 0 && response.status === "success") {
      return { status: "success", message: "", data: response };
    }

    return {
      status: "error",
      message: response.msg || "Dữ liệu trận không hợp lệ",
      data: response
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function fetchAggregatedMatchStats(
  matchIdsInput: string | string[],
  teamNamesFallback: string[] = [],
  options: MatchStatsFetchOptions = {}
): Promise<AggregatedMatchStats> {
  const matchIds = normalizeMatchIds(matchIdsInput);
  const responses: Array<MatchStatsApiResponse | null> = [];
  let failedBatches = 0;

  for (let index = 0; index < matchIds.length; index += MATCH_STATS_BATCH_SIZE) {
    const batch = matchIds.slice(index, index + MATCH_STATS_BATCH_SIZE);
    try {
      responses.push(await fetchMatchStatsBatch(batch, options));
    } catch (error) {
      failedBatches += 1;
      console.warn("[MATCHSTATS] Không thể lấy lô dữ liệu trận:", error);
      responses.push(null);
    }
  }

  return aggregateMatchStatsResponses(responses, teamNamesFallback, failedBatches);
}

export function aggregateMatchStatsResponses(
  responses: Array<MatchStatsApiResponse | null | undefined>,
  teamNamesFallback: string[] = [],
  failedBatches = 0
): AggregatedMatchStats {
  const teamMap = new Map<string, AggregatedMatchStatsTeam>();
  let matchCount = 0;

  const upsertTeam = (teamNameRaw: unknown, teamIdRaw: unknown = null): AggregatedMatchStatsTeam | null => {
    const teamName = String(teamNameRaw || "").trim();
    if (!teamName) return null;

    const key = normalizeTeamName(teamName);
    const existing = teamMap.get(key);
    if (existing) {
      if (existing.teamId === null) existing.teamId = numberOrNull(teamIdRaw);
      return existing;
    }

    const created: AggregatedMatchStatsTeam = {
      teamName,
      teamId: numberOrNull(teamIdRaw),
      totalScore: 0,
      elims: 0,
      rankPoint: 0,
      matchCount: 0
    };
    teamMap.set(key, created);
    return created;
  };

  for (const response of responses) {
    const matches = response?.data?.team_stats;
    if (!Array.isArray(matches)) continue;

    for (const match of matches) {
      const teamStatsList = match?.team_stats;
      if (!Array.isArray(teamStatsList)) continue;

      matchCount += 1;
      for (const teamStats of teamStatsList) {
        const team = upsertTeam(teamStats?.team_name, teamStats?.team_id);
        if (!team) continue;

        team.totalScore += numberOrZero(teamStats?.total_score);
        team.elims += numberOrZero(teamStats?.kills);
        team.rankPoint += numberOrZero(teamStats?.rank_point ?? teamStats?.survival_score);
        team.matchCount += 1;
      }
    }
  }

  for (const teamName of teamNamesFallback) {
    upsertTeam(teamName);
  }

  return {
    teams: Array.from(teamMap.values()).sort((a, b) => {
      return b.totalScore - a.totalScore || b.elims - a.elims || b.rankPoint - a.rankPoint || a.teamName.localeCompare(b.teamName);
    }),
    matchCount,
    failedBatches
  };
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}
