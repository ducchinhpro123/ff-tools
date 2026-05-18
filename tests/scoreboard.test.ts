import assert from "node:assert/strict";
import test from "node:test";
import { ScoreboardState } from "../src/scoreboard";

test("parses teams, players, deaths, scores, and ranks by total points", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 1,
      shortName: "AAA",
      displayName: "Alpha",
      basePoints: 10,
      logoPath: "",
      accentColor: "#ff007a"
    },
    {
      teamId: 2,
      shortName: "BBB",
      displayName: "Beta",
      basePoints: 0,
      logoPath: "",
      accentColor: "#00aaff"
    }
  ]);

  [
    "OnTeamScoreInited -> TeamName: Alpha TeamID: 1",
    "OnTeamScoreInited -> TeamName: Beta TeamID: 2",
    "[UIModelSpectator] AddPlayer id101,nameOne,gsTeam1",
    "[UIModelSpectator] AddPlayer id102,nameTwo,gsTeam1",
    "[UIModelSpectator] AddPlayer id201,nameThree,gsTeam2",
    "Player 102 Dead, killed by 201",
    "Player 102 Dead, killed by 201",
    "OnTeamScoreChanged -> TeamID: 1 TeamScore: 5",
    "OnTeamScoreChanged -> TeamID: 2 TeamScore: 12"
  ].forEach((line) => state.consumeLine(line));

  const rows = state.toPublicState().teams;
  assert.equal(rows[0].teamId, 1);
  assert.equal(rows[0].totalPoints, 15);
  assert.equal(rows[0].alive, 1);
  assert.equal(rows[0].eliminated, 1);
  assert.equal(rows[1].teamId, 2);
  assert.equal(rows[1].totalPoints, 12);
});

test("applies death seen before player join", () => {
  const state = new ScoreboardState();
  state.consumeLine("Player 999 Dead, killed by 111");
  state.consumeLine("[UIModelSpectator] AddPlayer id999,nameLate,gsTeam5");
  state.consumeLine("OnTeamScoreInited -> TeamName: Late Team TeamID: 5");

  const row = state.toPublicState().teams[0];
  assert.equal(row.teamId, 5);
  assert.equal(row.alive, 0);
  assert.equal(row.eliminated, 1);
});

test("revive restores a dead player to alive", () => {
  const state = new ScoreboardState();
  state.consumeLine("[UIModelSpectator] AddPlayer id999,nameLate,gsTeam5");
  state.consumeLine("Player 999 Dead, killed by 111");
  state.consumeLine("Revive Player 999, revivePosition=(106.09, 300.00, 385.72)");

  const row = state.toPublicState().teams[0];
  assert.equal(row.alive, 1);
  assert.equal(row.eliminated, 0);
});

test("pending revive counts as out until actual revive", () => {
  const state = new ScoreboardState();
  state.consumeLine("[UIModelSpectator] AddPlayer id999,nameLate,gsTeam5");
  state.consumeLine("Player 999 Dead, killed by 111");
  state.consumeLine("NotifyPlayerEnterPendingRevive -> 999");

  let row = state.toPublicState().teams[0];
  assert.equal(row.alive, 0);
  assert.equal(row.eliminated, 1);

  state.consumeLine("Revive Player 999, revivePosition=(106.09, 300.00, 385.72)");
  row = state.toPublicState().teams[0];
  assert.equal(row.alive, 1);
  assert.equal(row.eliminated, 0);

  state.consumeLine("Player quit revive, 999");
  row = state.toPublicState().teams[0];
  assert.equal(row.alive, 0);
  assert.equal(row.eliminated, 1);
});

test("falls back when CSV config is missing", () => {
  const state = new ScoreboardState();
  state.consumeLine("OnTeamScoreInited -> TeamName: Thunder Z TeamID: 14");
  state.consumeLine("[UIModelSpectator] AddPlayer id1,namePlayer,gsTeam14");
  state.consumeLine("OnTeamScoreChanged -> TeamID: 14 TeamScore: 20");

  const row = state.toPublicState().teams[0];
  assert.equal(row.name, "Thunder Z");
  assert.equal(row.shortName, "TZ");
  assert.equal(row.basePoints, 0);
  assert.equal(row.totalPoints, 20);
});

test("log team name wins when CSV team id mapping is stale", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 8,
      shortName: "PKNC",
      displayName: "PKNC ESPORTS",
      basePoints: 50,
      logoPath: "",
      accentColor: "#ff3b30"
    },
    {
      teamId: 13,
      shortName: "EVLG",
      displayName: "EVLG",
      basePoints: 10,
      logoPath: "",
      accentColor: "#ff3b30"
    }
  ]);

  state.consumeLine("OnTeamScoreInited -> TeamName: EVLG TeamID: 8");
  state.consumeLine("OnTeamScoreChanged -> TeamID: 8 TeamScore: 7");

  const row = state.toPublicState().teams[0];
  assert.equal(row.teamId, 8);
  assert.equal(row.name, "EVLG");
  assert.equal(row.shortName, "EVLG");
  assert.equal(row.totalPoints, 17);
});

test("CSV aliases can match log names with accents and symbols", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 7,
      shortName: "BCA",
      displayName: "BO CUOI ACADEMY",
      basePoints: 0,
      logoPath: "",
      accentColor: "#ff3b30"
    }
  ]);

  state.consumeLine("OnTeamScoreInited -> TeamName: BÒ CƯỜI ACADEMY TeamID: 12");
  const row = state.toPublicState().teams[0];
  assert.equal(row.teamId, 12);
  assert.equal(row.name, "BÒ CƯỜI ACADEMY");
  assert.equal(row.shortName, "BCA");
});

test("stale CSV id is ignored when live log name has no matching CSV name", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 14,
      shortName: "TDZ",
      displayName: "THUNDER Z",
      basePoints: 99,
      logoPath: "",
      accentColor: "#ff3b30"
    }
  ]);

  state.consumeLine("OnTeamScoreInited -> TeamName: BABY BÒ ESP TeamID: 14");
  state.consumeLine("OnTeamScoreChanged -> TeamID: 14 TeamScore: 2");

  const row = state.toPublicState().teams[0];
  assert.equal(row.name, "BABY BÒ ESP");
  assert.equal(row.shortName, "BBE");
  assert.equal(row.totalPoints, 2);
});

test("marks match end", () => {
  const state = new ScoreboardState();
  state.consumeLine("[MatchResult] receive S2C_RUDP_MatchEnd_Res from GS");
  assert.equal(state.toPublicState().matchEnded, true);
});

test("publishes knockdown events from combat log lines", () => {
  const state = new ScoreboardState();
  state.setPlayerRoster([
    {
      teamName: "LQTA",
      playerId: "4579338001",
      playerName: "LQTA.KILLER"
    },
    {
      teamName: "EVLG",
      playerId: "4579338002",
      playerName: "EVLG.DOWNED"
    }
  ]);

  [
    "[2026-05-14 09:39:53.900][1][21545] Player Join, 4579338001, 33554465, LQTA.KILLER,False10",
    "[2026-05-14 09:39:53.910][1][21545] Player Join, 4579338002, 50331651, EVLG.DOWNED,False10",
    "[UIModelSpectator] AddPlayer id33554465,nameLQTA.KILLER,gsTeam1",
    "[UIModelSpectator] AddPlayer id50331651,nameEVLG.DOWNED,gsTeam2",
    "[2026-05-14 09:39:53.970][1][21545] Player '50331651' Knock Down, by '33554465'",
    "[2026-05-14 09:39:53.980][1][21545] Teammate 50331651 Knock Down"
  ].forEach((line) => state.consumeLine(line));

  const events = state.toPublicState().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "knockdown");
  assert.equal(events[0].eventId, "21545");
  assert.equal(events[0].timestamp, "2026-05-14 09:39:53.970");
  assert.equal(events[0].downedId, "50331651");
  assert.equal(events[0].killerId, "33554465");
  assert.equal(events[0].downedName, "EVLG.DOWNED");
  assert.equal(events[0].killerName, "LQTA.KILLER");
  assert.equal(events[0].downedTeam, "EVLG");
  assert.equal(events[0].killerTeam, "LQTA");
});

test("uses latest game score order to break ties", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: HUNTER ESPORTS TeamID: 5",
    "OnTeamScoreInited -> TeamName: BÒ CƯỜI ACADEMY TeamID: 7",
    "OnTeamScoreInited -> TeamName: WED TeamID: 9",
    "OnTeamScoreInited -> TeamName: LEKIEN Esports TeamID: 10",
    "OnTeamScoreChanged -> TeamID: 7 TeamScore: 4",
    "OnTeamScoreChanged -> TeamID: 9 TeamScore: 4",
    "OnTeamScoreChanged -> TeamID: 5 TeamScore: 4",
    "OnTeamScoreChanged -> TeamID: 10 TeamScore: 4"
  ].forEach((line) => state.consumeLine(line));

  assert.deepEqual(
    state.toPublicState().teams.map((team) => team.teamId),
    [7, 9, 5, 10]
  );
});

test("applies match stats totals as base points and keeps live score additive", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 1,
      shortName: "AAA",
      displayName: "Alpha",
      basePoints: 0,
      logoPath: "",
      accentColor: "#ff007a"
    },
    {
      teamId: 2,
      shortName: "BBB",
      displayName: "Beta",
      basePoints: 0,
      logoPath: "",
      accentColor: "#00aaff"
    }
  ]);
  state.setMatchStatsBase([
    {
      teamName: "Alpha",
      teamId: 1,
      totalScore: 20,
      elims: 7,
      rankPoint: 13,
      matchCount: 2
    },
    {
      teamName: "Beta",
      teamId: 2,
      totalScore: 12,
      elims: 4,
      rankPoint: 8,
      matchCount: 2
    }
  ]);

  assert.deepEqual(
    state.toPublicState().teams.map((team) => [team.shortName, team.totalPoints]),
    [
      ["AAA", 20],
      ["BBB", 12]
    ]
  );

  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  state.consumeLine("OnTeamScoreChanged -> TeamID: 1 TeamScore: 5");

  const alpha = state.toPublicState().teams.find((team) => team.shortName === "AAA");
  assert.equal(alpha?.basePoints, 20);
  assert.equal(alpha?.liveScore, 5);
  assert.equal(alpha?.totalPoints, 25);
});

test("uses historical elims and rank points to break tied match stats totals", () => {
  const state = new ScoreboardState();
  state.setMatchStatsBase([
    {
      teamName: "Alpha",
      teamId: 1,
      totalScore: 20,
      elims: 5,
      rankPoint: 10,
      matchCount: 2
    },
    {
      teamName: "Beta",
      teamId: 2,
      totalScore: 20,
      elims: 7,
      rankPoint: 8,
      matchCount: 2
    },
    {
      teamName: "Gamma",
      teamId: 3,
      totalScore: 20,
      elims: 7,
      rankPoint: 12,
      matchCount: 2
    }
  ]);

  assert.deepEqual(
    state.toPublicState().teams.map((team) => team.name),
    ["Gamma", "Beta", "Alpha"]
  );
});

test("caps public alive slots to four players", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: Alpha TeamID: 1",
    "[UIModelSpectator] AddPlayer id101,nameOne,gsTeam1",
    "[UIModelSpectator] AddPlayer id102,nameTwo,gsTeam1",
    "[UIModelSpectator] AddPlayer id103,nameThree,gsTeam1",
    "[UIModelSpectator] AddPlayer id104,nameFour,gsTeam1",
    "[UIModelSpectator] AddPlayer id105,nameFive,gsTeam1"
  ].forEach((line) => state.consumeLine(line));

  const row = state.toPublicState().teams[0];
  assert.equal(row.alive, 4);
  assert.equal(row.players, 4);
});

test("maps player gsTeam to scoreboard TeamID for alive counts", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: DK TeamID: 4",
    "OnTeamScoreInited -> TeamName: WAIT TeamID: 15",
    "[UIModelSpectator] AddPlayer id401,nameWaitOne,gsTeam4",
    "[UIModelSpectator] AddPlayer id402,nameWaitTwo,gsTeam4",
    "[UIModelSpectator] AddPlayer id1501,nameOtherOne,gsTeam15",
    "[2026-05-13 06:39:55.822][1][14028] OnTeamScoreChanged -> TeamID: 15 TeamScore: 1",
    "[2026-05-13 06:39:55.822][1][14028] Player 1501 Dead, killed by 401",
    "[2026-05-13 06:39:55.822][1][14028] NotifyPlayerEnterPendingRevive -> 1501",
    "[2026-05-13 06:39:55.900][1][14029] noop"
  ].forEach((line) => state.consumeLine(line));

  const wait = state.toPublicState().teams.find((team) => team.teamId === 15);
  const dk = state.toPublicState().teams.find((team) => team.teamId === 4);

  assert.equal(wait?.alive, 2);
  assert.equal(wait?.players, 2);
  assert.equal(dk?.players, 0);
});

test("marks team eliminated from isTeamLastKill event", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: DK TeamID: 4",
    "[UIModelSpectator] AddPlayer id401,nameOne,gsTeam4",
    "[UIModelSpectator] AddPlayer id402,nameTwo,gsTeam4",
    "[2026-05-13 06:48:00.614][1][18162] Player 401 Dead, killed by 999",
    "[2026-05-13 06:48:00.614][1][18162] Event data isTeamLastKill: True",
    "[2026-05-13 06:48:00.615][1][18162] Event data isTeamLastKill: True"
  ].forEach((line) => state.consumeLine(line));

  const row = state.toPublicState().teams[0];
  assert.equal(row.teamEliminated, true);
  assert.equal(row.alive, 0);
  assert.equal(row.eliminated, 2);
  const eliminated = state.toPublicState().eliminatedEvents[0];
  assert.equal(state.toPublicState().eliminatedEvents.length, 1);
  assert.equal(eliminated.teamName, "DK");
  assert.equal(eliminated.rank, 1);
  assert.deepEqual(eliminated.teamMateIds, ["401", "402"]);
  assert.equal(state.toPublicState().events[0].type, "team_eliminated");
});

test("calculates win rate from alive players and live points", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: Alpha TeamID: 1",
    "OnTeamScoreInited -> TeamName: Beta TeamID: 2",
    "[UIModelSpectator] AddPlayer id101,nameA1,gsTeam1",
    "[UIModelSpectator] AddPlayer id102,nameA2,gsTeam1",
    "[UIModelSpectator] AddPlayer id103,nameA3,gsTeam1",
    "[UIModelSpectator] AddPlayer id104,nameA4,gsTeam1",
    "[UIModelSpectator] AddPlayer id201,nameB1,gsTeam2",
    "[UIModelSpectator] AddPlayer id202,nameB2,gsTeam2",
    "OnTeamScoreChanged -> TeamID: 1 TeamScore: 10",
    "OnTeamScoreChanged -> TeamID: 2 TeamScore: 0"
  ].forEach((line) => state.consumeLine(line));

  const rates = state.toPublicState().winRates;
  assert.equal(rates[0].name, "Alpha");
  assert.equal(rates[0].winRate, 88.89);
  assert.equal(rates[1].name, "Beta");
  assert.equal(rates[1].winRate, 11.11);
  assert.equal(Number(rates.reduce((sum, row) => sum + row.winRate, 0).toFixed(2)), 100);
});

test("uses roster player IDs from Player Join to resolve team names and team IDs", () => {
  const state = new ScoreboardState();
  state.setTeamConfig([
    {
      teamId: 3,
      shortName: "CPE",
      displayName: "CPE",
      basePoints: 0,
      logoPath: "",
      accentColor: "#ff3b30"
    }
  ]);
  state.setPlayerRoster([
    {
      teamName: "CPE",
      playerId: "4579338093",
      playerName: "CPE.MESSI"
    }
  ]);

  [
    "OnTeamScoreInited -> TeamName: CHAMPION ESPORT TeamID: 3",
    "[2026-05-13 06:24:57.583][1][130] Player Join, 4579338093, 167772186, CPE.MESSI,False10",
    "[UIModelSpectator] AddPlayer id167772186,nameCPE.MESSI,gsTeam10",
    "OnTeamScoreChanged -> TeamID: 3 TeamScore: 1"
  ].forEach((line) => state.consumeLine(line));

  const row = state.toPublicState().teams[0];
  assert.equal(row.teamId, 3);
  assert.equal(row.name, "CPE");
  assert.equal(row.shortName, "CPE");
  assert.equal(row.players, 1);
  assert.equal(row.alive, 1);
});


test("onMatchStart fires once per match boundary (initial + after match end)", async () => {
  const state = new ScoreboardState();
  let calls = 0;
  // Use 0ms debounce so we can assert synchronously.
  state.setOnMatchStart(() => {
    calls += 1;
  }, 0);

  // First match: 4 teamInit lines should still fire only once.
  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  state.consumeLine("OnTeamScoreInited -> TeamName: Beta TeamID: 2");
  state.consumeLine("OnTeamScoreInited -> TeamName: Gamma TeamID: 3");
  state.consumeLine("OnTeamScoreInited -> TeamName: Delta TeamID: 4");
  assert.equal(calls, 1);

  // Mid-match teamInit (e.g. spectator reconnect re-emits) must not retrigger.
  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  assert.equal(calls, 1);

  // End of match 1.
  state.consumeLine("[MatchResult] receive S2C_RUDP_MatchEnd_Res from GS");
  assert.equal(state.toPublicState().matchEnded, true);

  // Match 2 begins.
  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  assert.equal(calls, 2);
  // Match 2 sets matchEnded back to false because a new match started.
  assert.equal(state.toPublicState().matchEnded, false);

  // Match 2 mid-init burst is suppressed too.
  state.consumeLine("OnTeamScoreInited -> TeamName: Beta TeamID: 2");
  state.consumeLine("OnTeamScoreInited -> TeamName: Gamma TeamID: 3");
  assert.equal(calls, 2);
});

test("onMatchStart re-arms after state.reset (new log file)", () => {
  const state = new ScoreboardState();
  let calls = 0;
  state.setOnMatchStart(() => {
    calls += 1;
  }, 0);

  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  assert.equal(calls, 1);

  // Switching log files via reset should let the next teamInit fire again.
  state.reset(null);
  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  assert.equal(calls, 2);
});

test("clears live players when a new match starts in the same debugger log", () => {
  const state = new ScoreboardState();

  [
    "OnTeamScoreInited -> TeamName: OLD TeamID: 1",
    "[2026-05-14 09:12:11.345][1][105] Player Join, 1001, 777, OldName,False1",
    "[2026-05-14 09:12:11.377][1][105] [UIModelSpectator] AddPlayer id777,nameOldName,gsTeam1",
    "[MatchResult] receive S2C_RUDP_MatchEnd_Res from GS",
    "[2026-05-14 09:27:30.797][1][258] Player Join, 2002, 777, NewName,False2",
    "[2026-05-14 09:27:30.804][1][258] [UIModelSpectator] AddPlayer id777,nameNewName,gsTeam2",
    "[2026-05-14 09:27:30.810][1][258] Player Join, 3003, 888, Killer,False3",
    "[2026-05-14 09:27:30.817][1][258] [UIModelSpectator] AddPlayer id888,nameKiller,gsTeam3",
    "[2026-05-14 09:27:33.601][1][343] OnTeamScoreInited -> TeamName: NEW TeamID: 2",
    "[2026-05-14 09:27:33.602][1][343] OnTeamScoreInited -> TeamName: KILL TeamID: 3",
    "[2026-05-14 09:28:00.000][1][500] Player 777 Dead, killed by 888"
  ].forEach((line) => state.consumeLine(line));

  const publicState = state.toPublicState();
  assert.equal(publicState.matchEnded, false);
  assert.equal(publicState.events[0].victimName, "NewName");
  assert.equal(publicState.events[0].killerName, "Killer");
  assert.equal(publicState.teams.some((team) => team.name === "OLD"), false);
});

test("onMatchStart debounce coalesces rapid teamInit bursts", async () => {
  const state = new ScoreboardState();
  let calls = 0;
  state.setOnMatchStart(() => {
    calls += 1;
  }, 30);

  state.consumeLine("OnTeamScoreInited -> TeamName: Alpha TeamID: 1");
  state.consumeLine("OnTeamScoreInited -> TeamName: Beta TeamID: 2");
  // Synchronously the timer hasn't fired yet.
  assert.equal(calls, 0);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1);

  // Subsequent teamInit within the same match shouldn't queue another timer.
  state.consumeLine("OnTeamScoreInited -> TeamName: Gamma TeamID: 3");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1);
});
