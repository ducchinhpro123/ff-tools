import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { DEFAULT_OVERLAY_CONFIG } from "./defaults";
import { groupsDataPath, overlayConfigPath, playersDataPath, teamsCsvPath } from "./paths";
import type { ManagedGroup, ManagedGroupMatch, ManagedPlayer, OverlayConfig, PlayerRosterEntry, TeamConfig } from "./types";

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function optionOrDefault(value: unknown, fallback: string, allowed: string[]): string {
  const option = String(value || "");
  return allowed.includes(option) ? option : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeString(value: unknown): string {
  return String(value || "").trim();
}

function normalizeMatch(entry: unknown): ManagedGroupMatch | null {
  if (typeof entry === "string") {
    const matchId = normalizeString(entry);
    return matchId ? { matchId, description: "", addTime: nowIso() } : null;
  }

  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const matchId = normalizeString(record.matchId);
  if (!matchId) return null;

  return {
    matchId,
    description: normalizeString(record.description),
    addTime: normalizeString(record.addTime) || nowIso()
  };
}

export function normalizeManagedGroups(input: unknown): ManagedGroup[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const groupId = normalizeString(item.groupId || item.name || `group-${index + 1}`);
      const matches = Array.isArray(item.matches)
        ? item.matches.map(normalizeMatch).filter((match): match is ManagedGroupMatch => Boolean(match))
        : Array.isArray(item.matchIds)
          ? item.matchIds.map(normalizeMatch).filter((match): match is ManagedGroupMatch => Boolean(match))
          : [];

      return {
        groupId,
        note: normalizeString(item.note),
        createdAt: normalizeString(item.createdAt) || nowIso(),
        matches,
        teamNames: Array.isArray(item.teamNames)
          ? [...new Set(item.teamNames.map(normalizeString).filter(Boolean))]
          : []
      };
    })
    .filter((group) => group.groupId);
}

export function normalizeManagedPlayers(input: unknown): ManagedPlayer[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      teamName: normalizeString(item.teamName || item.tagName),
      playerId: normalizeString(item.playerId || item.playerID || item.memberId),
      playerName: normalizeString(item.playerName || item.gameName),
      createdAt: normalizeString(item.createdAt) || nowIso()
    }))
    .filter((player) => {
      if (!player.playerId || !player.playerName || !player.teamName || seen.has(player.playerId)) return false;
      seen.add(player.playerId);
      return true;
    });
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function loadTeamConfig(): Promise<TeamConfig[]> {
  try {
    const csv = await fs.readFile(teamsCsvPath, "utf8");
    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    return records
      .map((row) => ({
        teamId: numberOrDefault(row.teamId, 0),
        shortName: row.shortName || "",
        displayName: row.displayName || "",
        basePoints: numberOrDefault(row.basePoints, 0),
        logoPath: row.logoPath || "",
        accentColor: row.accentColor || DEFAULT_OVERLAY_CONFIG.accentColor
      }))
      .filter((team) => team.teamId > 0);
  } catch (error) {
    console.warn(`Không thể đọc CSV đội tại ${teamsCsvPath}:`, error);
    return [];
  }
}

export async function loadPlayerRoster(): Promise<PlayerRosterEntry[]> {
  const managedPlayers = await loadManagedPlayers();
  if (managedPlayers.length > 0) {
    return managedPlayers.map(({ teamName, playerId, playerName }) => ({ teamName, playerId, playerName }));
  }

  const rosterPath = process.env.FF_ROSTER_CSV;
  if (!rosterPath) return [];

  try {
    const csv = await fs.readFile(rosterPath, "utf8");
    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    return records
      .map((row) => ({
        teamName: row.teamName || row.tagName || "",
        playerId: row.playerId || row.playerID || row.memberId || "",
        playerName: row.playerName || row.gameName || ""
      }))
      .filter((player) => player.teamName && player.playerId);
  } catch (error) {
    console.warn(`Không thể đọc CSV đội hình tại ${rosterPath}:`, error);
    return [];
  }
}

export async function loadManagedGroups(): Promise<ManagedGroup[]> {
  try {
    return normalizeManagedGroups(await readJsonFile(groupsDataPath));
  } catch {
    return [];
  }
}

export async function saveManagedGroups(groups: ManagedGroup[]): Promise<void> {
  await fs.mkdir(path.dirname(groupsDataPath), { recursive: true });
  await fs.writeFile(groupsDataPath, `${JSON.stringify(normalizeManagedGroups(groups), null, 2)}\n`, "utf8");
}

export async function loadManagedPlayers(): Promise<ManagedPlayer[]> {
  try {
    return normalizeManagedPlayers(await readJsonFile(playersDataPath));
  } catch {
    return [];
  }
}

export async function saveManagedPlayers(players: ManagedPlayer[]): Promise<void> {
  await fs.mkdir(path.dirname(playersDataPath), { recursive: true });
  await fs.writeFile(playersDataPath, `${JSON.stringify(normalizeManagedPlayers(players), null, 2)}\n`, "utf8");
}

export async function loadOverlayConfig(): Promise<OverlayConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(overlayConfigPath, "utf8")) as Partial<OverlayConfig>;
    return normalizeOverlayConfig(raw);
  } catch {
    return DEFAULT_OVERLAY_CONFIG;
  }
}

export function normalizeOverlayConfig(input: Partial<OverlayConfig>): OverlayConfig {
  return {
    width: Math.max(240, Math.min(900, numberOrDefault(input.width, DEFAULT_OVERLAY_CONFIG.width))),
    scale: Math.max(0.5, Math.min(2.5, numberOrDefault(input.scale, DEFAULT_OVERLAY_CONFIG.scale))),
    rowCount: Math.max(1, Math.min(30, Math.round(numberOrDefault(input.rowCount, DEFAULT_OVERLAY_CONFIG.rowCount)))),
    fontSize: Math.max(10, Math.min(34, numberOrDefault(input.fontSize, DEFAULT_OVERLAY_CONFIG.fontSize))),
    rowHeight: Math.max(28, Math.min(90, numberOrDefault(input.rowHeight, DEFAULT_OVERLAY_CONFIG.rowHeight))),
    opacity: Math.max(0.2, Math.min(1, numberOrDefault(input.opacity, DEFAULT_OVERLAY_CONFIG.opacity))),
    rowOpacity: Math.max(0, Math.min(1, numberOrDefault(input.rowOpacity, DEFAULT_OVERLAY_CONFIG.rowOpacity))),
    accentColor: String(input.accentColor || DEFAULT_OVERLAY_CONFIG.accentColor),
    headerColor: String(input.headerColor || DEFAULT_OVERLAY_CONFIG.headerColor),
    panelColor: String(input.panelColor || DEFAULT_OVERLAY_CONFIG.panelColor),
    textColor: String(input.textColor || DEFAULT_OVERLAY_CONFIG.textColor),
    mutedColor: String(input.mutedColor || DEFAULT_OVERLAY_CONFIG.mutedColor),
    showLogo: booleanOrDefault(input.showLogo, DEFAULT_OVERLAY_CONFIG.showLogo),
    showFooter: booleanOrDefault(input.showFooter, DEFAULT_OVERLAY_CONFIG.showFooter),
    showDebug: booleanOrDefault(input.showDebug, DEFAULT_OVERLAY_CONFIG.showDebug),
    animationEnabled: booleanOrDefault(input.animationEnabled, DEFAULT_OVERLAY_CONFIG.animationEnabled),
    moveAnimation: optionOrDefault(input.moveAnimation, DEFAULT_OVERLAY_CONFIG.moveAnimation, ["glide", "slide", "snap", "top-pop", "off"]),
    rowEnterAnimation: optionOrDefault(input.rowEnterAnimation, DEFAULT_OVERLAY_CONFIG.rowEnterAnimation, ["slide", "fade", "off"]),
    playerLostAnimation: optionOrDefault(input.playerLostAnimation, DEFAULT_OVERLAY_CONFIG.playerLostAnimation, ["pulse", "shake", "off"]),
    animationSpeed: Math.max(0.15, Math.min(2, numberOrDefault(input.animationSpeed, DEFAULT_OVERLAY_CONFIG.animationSpeed)))
  };
}

export async function saveOverlayConfig(config: OverlayConfig): Promise<void> {
  await fs.writeFile(overlayConfigPath, `${JSON.stringify(normalizeOverlayConfig(config), null, 2)}\n`, "utf8");
}
