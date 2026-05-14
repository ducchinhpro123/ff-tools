import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { LogTailer } from "../src/logTailer";
import { ScoreboardState } from "../src/scoreboard";

test("clears scoreboard state when the active log is deleted", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), ".tmp-logtailer-"));

  try {
    const logPath = path.join(dir, "debugger-2026-05-13T04-20-07.log");
    await fs.writeFile(
      logPath,
      [
        "OnTeamScoreInited -> TeamName: Alpha TeamID: 1",
        "[UIModelSpectator] AddPlayer id101,nameOne,gsTeam1",
        "OnTeamScoreChanged -> TeamID: 1 TeamScore: 5",
        ""
      ].join("\n")
    );

    const state = new ScoreboardState();
    let changes = 0;
    const tailer = new LogTailer(state, () => {
      changes += 1;
    }, dir);

    await tailer.tick();

    let publicState = state.toPublicState();
    assert.equal(publicState.sourceLog, logPath);
    assert.equal(publicState.teams.length, 1);
    assert.equal(changes, 1);

    await fs.unlink(logPath);
    await tailer.tick();

    publicState = state.toPublicState();
    assert.equal(publicState.sourceLog, null);
    assert.equal(publicState.sourceLogUpdatedAt, null);
    assert.equal(publicState.teams.length, 0);
    assert.equal(changes, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("reads an explicitly selected log instead of the newest log", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), ".tmp-logtailer-"));

  try {
    const selectedLog = path.join(dir, "debugger-2026-05-13T04-20-07.log");
    const newestLog = path.join(dir, "debugger-2026-05-14T04-20-07.log");
    await fs.writeFile(
      selectedLog,
      [
        "OnTeamScoreInited -> TeamName: Selected Team TeamID: 1",
        "[UIModelSpectator] AddPlayer id101,nameOne,gsTeam1",
        "OnTeamScoreChanged -> TeamID: 1 TeamScore: 7",
        ""
      ].join("\n")
    );
    await fs.writeFile(
      newestLog,
      [
        "OnTeamScoreInited -> TeamName: Newest Team TeamID: 2",
        "[UIModelSpectator] AddPlayer id201,nameTwo,gsTeam2",
        "OnTeamScoreChanged -> TeamID: 2 TeamScore: 12",
        ""
      ].join("\n")
    );

    const state = new ScoreboardState();
    const tailer = new LogTailer(state, () => {}, dir);

    tailer.useLogFile(selectedLog);
    await tailer.tick();

    let publicState = state.toPublicState();
    assert.equal(tailer.getSelectedLog(), selectedLog);
    assert.equal(publicState.sourceLog, selectedLog);
    assert.equal(publicState.teams[0]?.name, "Selected Team");
    assert.equal(publicState.teams[0]?.totalPoints, 7);

    tailer.useLogFile(null);
    await tailer.tick();

    publicState = state.toPublicState();
    assert.equal(tailer.getSelectedLog(), null);
    assert.equal(publicState.sourceLog, newestLog);
    assert.equal(publicState.teams[0]?.name, "Newest Team");
    assert.equal(publicState.teams[0]?.totalPoints, 12);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("does not fall back to newest log when selected log is missing", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), ".tmp-logtailer-"));

  try {
    const selectedLog = path.join(dir, "debugger-2026-05-13T04-20-07.log");
    const newestLog = path.join(dir, "debugger-2026-05-14T04-20-07.log");
    await fs.writeFile(
      selectedLog,
      [
        "OnTeamScoreInited -> TeamName: Selected Team TeamID: 1",
        "[UIModelSpectator] AddPlayer id101,nameOne,gsTeam1",
        "OnTeamScoreChanged -> TeamID: 1 TeamScore: 7",
        ""
      ].join("\n")
    );
    await fs.writeFile(
      newestLog,
      [
        "OnTeamScoreInited -> TeamName: Newest Team TeamID: 2",
        "[UIModelSpectator] AddPlayer id201,nameTwo,gsTeam2",
        "OnTeamScoreChanged -> TeamID: 2 TeamScore: 12",
        ""
      ].join("\n")
    );

    const state = new ScoreboardState();
    const tailer = new LogTailer(state, () => {}, dir);

    tailer.useLogFile(selectedLog);
    await tailer.tick();
    await fs.unlink(selectedLog);
    await tailer.tick();

    const publicState = state.toPublicState();
    assert.equal(publicState.sourceLog, null);
    assert.equal(publicState.teams.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
