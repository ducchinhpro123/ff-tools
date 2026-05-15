import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMatchStatsResponses, normalizeMatchIds } from "../src/matchStats";

test("normalizes comma, semicolon, and newline match IDs", () => {
  assert.deepEqual(normalizeMatchIds("m1, m2\nm1;m3"), ["m1", "m2", "m3"]);
});

test("aggregates match stats team totals across response batches", () => {
  const aggregate = aggregateMatchStatsResponses(
    [
      {
        code: 0,
        status: "success",
        data: {
          team_stats: [
            {
              match_id: "match-1",
              team_stats: [
                { team_id: 1, team_name: "Alpha", total_score: 12, kills: 5, survival_score: 7 },
                { team_id: 2, team_name: "Beta", total_score: 10, kills: 6, rank_point: 4 }
              ]
            },
            {
              match_id: "match-2",
              team_stats: [{ team_id: 1, team_name: "Alpha", total_score: 8, kills: 2, survival_score: 6 }]
            }
          ]
        }
      }
    ],
    ["Gamma"]
  );

  assert.equal(aggregate.matchCount, 2);
  assert.equal(aggregate.failedBatches, 0);
  assert.deepEqual(
    aggregate.teams.map((team) => ({
      teamName: team.teamName,
      totalScore: team.totalScore,
      elims: team.elims,
      rankPoint: team.rankPoint,
      matchCount: team.matchCount
    })),
    [
      { teamName: "Alpha", totalScore: 20, elims: 7, rankPoint: 13, matchCount: 2 },
      { teamName: "Beta", totalScore: 10, elims: 6, rankPoint: 4, matchCount: 1 },
      { teamName: "Gamma", totalScore: 0, elims: 0, rankPoint: 0, matchCount: 0 }
    ]
  );
});
