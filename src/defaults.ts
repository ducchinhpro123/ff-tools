import type { OverlayConfig } from "./types";

export const DEFAULT_PORT = 5173;
export const DEFAULT_LOG_DIR =
  "C:\\Users\\c\\Downloads\\OB53\\Free Fire_64_Data\\Debugger";

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  width: 720,
  scale: 1,
  rowCount: 12,
  fontSize: 16,
  rowHeight: 54,
  opacity: 1,
  rowOpacity: 1,
  accentColor: "#ff3b30",
  headerColor: "#ff9d1e",
  panelColor: "#1c1d23",
  textColor: "#ffffff",
  mutedColor: "#767780",
  showLogo: true,
  showFooter: true,
  showDebug: true,
  animationEnabled: true,
  moveAnimation: "glide",
  rowEnterAnimation: "slide",
  playerLostAnimation: "pulse",
  animationSpeed: 1,
  rowStyle: "classic",
  rowBackgroundImage: "",
  rowEliminatedBackgroundImage: ""
};
