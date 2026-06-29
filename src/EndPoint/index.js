const PluginMarketView = document.createElement("div");
const PluginMarketIcon = document.createElement("span");
PluginMarketIcon.className = "functionBtnIcon mdi-powershell";

const PluginMarketText = document.createElement("span");
PluginMarketText.className = "functionBtnFont";
PluginMarketText.innerText = "插件市场";

PluginMarketView.className = "functionButton";
PluginMarketView.appendChild(PluginMarketIcon);
PluginMarketView.appendChild(PluginMarketText);

const CreateWindow = () => {
  if (document.getElementById("plugin-market-overlay")) {
    return;
  }

  const bridgeHandler = (event) => {
    const data = event.data;
    if (!data || data.source !== "plugin-market" || data.target !== "iirosejs") {
      return;
    }

    if (data.action === "extJs:get") {
      event.source?.postMessage(
        {
          source: "iirosejs",
          target: "plugin-market",
          requestId: data.requestId,
          ok: true,
          value: localStorage.getItem("extJs"),
        },
        event.origin,
      );
      return;
    }

    if (data.action === "extJs:set") {
      try {
        localStorage.setItem("extJs", data.payload?.value ?? "");
        event.source?.postMessage(
          {
            source: "iirosejs",
            target: "plugin-market",
            requestId: data.requestId,
            ok: true,
            value: localStorage.getItem("extJs"),
          },
          event.origin,
        );
      } catch (error) {
        event.source?.postMessage(
          {
            source: "iirosejs",
            target: "plugin-market",
            requestId: data.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "failed to write extJs",
          },
          event.origin,
        );
      }
    }
  };

  if (!window.__pluginMarketBridgeInstalled) {
    window.addEventListener("message", bridgeHandler);
    window.__pluginMarketBridgeInstalled = true;
  }

  const overlay = document.createElement("div");
  overlay.id = "plugin-market-overlay";
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "background: rgba(0, 0, 0, 0.55)",
    "display: flex",
    "align-items: stretch",
    "justify-content: stretch",
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position: relative",
    "width: 100vw",
    "height: 100vh",
    "background: #111827",
    "overflow: hidden",
    "box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08)",
    "display: flex",
    "flex-direction: column",
  ].join(";");

  const topbar = document.createElement("div");
  topbar.style.cssText = [
    "height: 56px",
    "flex: 0 0 56px",
    "display: flex",
    "align-items: center",
    "justify-content: space-between",
    "padding: 0 16px 0 20px",
    "background: rgba(15, 23, 42, 0.98)",
    "color: #ffffff",
    "box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08)",
    "z-index: 2",
  ].join(";");

  const topbarLeft = document.createElement("div");
  topbarLeft.style.cssText = [
    "display: flex",
    "align-items: center",
    "gap: 10px",
    "min-width: 0",
  ].join(";");

  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.textContent = "⟳";
  reloadButton.setAttribute("aria-label", "重载网站");
  reloadButton.title = "重载网站";
  reloadButton.style.cssText = [
    "width: 36px",
    "height: 36px",
    "border: none",
    "border-radius: 10px",
    "background: rgba(255, 255, 255, 0.08)",
    "color: #ffffff",
    "font-size: 18px",
    "font-weight: 700",
    "cursor: pointer",
    "display: flex",
    "align-items: center",
    "justify-content: center",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "插件市场";
  title.style.cssText = [
    "font-size: 16px",
    "font-weight: 600",
    "letter-spacing: 0.04em",
    "white-space: nowrap",
  ].join(";");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "X";
  closeButton.setAttribute("aria-label", "关闭插件市场");
  closeButton.style.cssText = [
    "width: 36px",
    "height: 36px",
    "border: none",
    "border-radius: 10px",
    "background: rgba(255, 255, 255, 0.08)",
    "color: #ffffff",
    "font-size: 18px",
    "font-weight: 700",
    "cursor: pointer",
    "display: flex",
    "align-items: center",
    "justify-content: center",
  ].join(";");

  const iframe = document.createElement("iframe");
  iframe.title = "插件市场";
  iframe.src = new URL("https://iirosemarket.reifuu.icu");
  iframe.style.cssText = [
    "flex: 1 1 auto",
    "width: 100%",
    "width: 100%",
    "height: calc(100vh - 56px)",
    "border: none",
    "background: #111827",
  ].join(";");

  const reloadWindow = () => {
    window.location.reload();
  };

  const closeWindow = () => {
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", bridgeHandler);
    window.__pluginMarketBridgeInstalled = false;
    overlay.remove();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeWindow();
    }
  };

  reloadButton.addEventListener("click", reloadWindow);
  closeButton.addEventListener("click", closeWindow);
  document.addEventListener("keydown", onKeyDown);

  topbarLeft.appendChild(reloadButton);
  topbarLeft.appendChild(title);

  topbar.appendChild(topbarLeft);
  topbar.appendChild(closeButton);
  panel.appendChild(topbar);
  panel.appendChild(iframe);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
};

PluginMarketView.addEventListener("click", () => {
  CreateWindow();
});

const targetElement = document.querySelector(
  "div#functionHolder > div > div:nth-child(9)",
);
if (targetElement) {
  targetElement.appendChild(PluginMarketView);
}
