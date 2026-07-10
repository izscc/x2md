import { isAutostartEnabled, setAutostartEnabled } from "./autostart.ts";

type TrayActions = {
  showSettings: () => void | Promise<void>;
  openSaveDir: () => void;
  openVideoDir: () => void;
  openExtensionDir: () => void;
  openLog: () => void;
  restart: () => void | Promise<void>;
  serviceRunning?: () => boolean;
  quit: () => void;
};

export function trayMenuItems(autostartEnabled = isAutostartEnabled(), serviceRunning = true): Array<Record<string, unknown>> {
  return [
    { type: "normal", label: `服务：${serviceRunning ? "运行中" : "未运行"}`, enabled: false },
    { type: "divider" },
    { type: "normal", label: "打开设置", action: "settings" },
    { type: "normal", label: "打开保存目录", action: "save-dir" },
    { type: "normal", label: "打开视频目录", action: "video-dir" },
    { type: "normal", label: "打开扩展目录", action: "extension-dir" },
    { type: "normal", label: "打开日志", action: "log" },
    { type: "divider" },
    { type: "normal", label: "重启服务", action: "restart" },
    { type: "normal", label: "开机自动运行", action: "autostart", checked: autostartEnabled },
    { type: "divider" },
    { type: "normal", label: "退出 X2MD", action: "quit" },
  ];
}

export async function handleTrayAction(action: string, actions: TrayActions): Promise<void> {
  if (action === "settings") await actions.showSettings();
  if (action === "save-dir") actions.openSaveDir();
  if (action === "video-dir") actions.openVideoDir();
  if (action === "extension-dir") actions.openExtensionDir();
  if (action === "log") actions.openLog();
  if (action === "restart") await actions.restart();
  if (action === "autostart") setAutostartEnabled(!isAutostartEnabled());
  if (action === "quit") actions.quit();
}

export async function createTray(actions: TrayActions): Promise<any> {
  try {
    const { Tray } = await import("electrobun/bun");
    const tray = new Tray({ title: "X2MD", image: "views://assets/tray-icon.png", template: false, width: 18, height: 18 });
    const updateMenu = () => tray.setMenu(trayMenuItems(isAutostartEnabled(), actions.serviceRunning?.() ?? true));
    updateMenu();
    tray.on("tray-clicked", async (event: any) => {
      const action = event?.data?.action || "";
      if (!action) return updateMenu();
      await handleTrayAction(action, actions);
      updateMenu();
    });
    return tray;
  } catch {
    return null;
  }
}
