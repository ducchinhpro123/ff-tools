import assert from "node:assert/strict";
import test from "node:test";
import { isAbsoluteLogPath, isValidLogPath } from "../src/logPath";

test("accepts POSIX absolute debugger log paths", () => {
  const logPath = "/home/voducchinh/Downloads/debugger-2026-05-14T09-11-43.log";

  assert.equal(isAbsoluteLogPath(logPath), true);
  assert.equal(isValidLogPath(logPath), true);
});

test("accepts Windows absolute debugger log paths", () => {
  const logPath = "C:\\full\\path\\debugger-2026-05-14T08-39-14.log";

  assert.equal(isAbsoluteLogPath(logPath), true);
  assert.equal(isValidLogPath(logPath), true);
});

test("rejects invalid characters for the active path style", () => {
  assert.equal(isValidLogPath("/home/voducchinh/Downloads/debugger\n.log"), false);
  assert.equal(isValidLogPath("C:\\full\\path\\debugger:bad.log"), false);
});

test("rejects relative debugger log paths", () => {
  assert.equal(isAbsoluteLogPath("Downloads/debugger.log"), false);
  assert.equal(isValidLogPath("Downloads/debugger.log"), false);
});
