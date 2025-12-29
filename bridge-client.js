(() => {
  function setStartStop(running) {
    const btnStart = document.getElementById("btnSerialConnect");
    const btnStop = document.getElementById("btnSerialDisconnect");
    if (btnStart) btnStart.disabled = running;
    if (btnStop) btnStop.disabled = !running;
  }

  async function startLogWithPort(info) {
    const params = new URLSearchParams();
    if (info && info.usbVendorId != null) params.set("vid", String(info.usbVendorId));
    if (info && info.usbProductId != null) params.set("pid", String(info.usbProductId));
    const res = await fetch("/api/start?" + params.toString(), { method: "POST" });
    if (!res.ok) {
      try { if (typeof appendLog === "function") appendLog("Demarrage serveur impossible", "py"); } catch (e) {}
      return;
    }
    setStartStop(true);
  }

  async function stopLog() {
    await fetch("/api/stop", { method: "POST" });
    setStartStop(false);
  }

  function startStream() {
    const es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.type === "line") {
          if (typeof handleLine === "function") handleLine(payload.text);
          return;
        }
        if (payload.type === "log") {
          if (typeof appendLog === "function") appendLog(payload.text, "py");
        }
      } catch (e) {}
    };
  }

  function init() {
    const btnStart = document.getElementById("btnSerialConnect");
    const btnStop = document.getElementById("btnSerialDisconnect");
    if (btnStart) btnStart.addEventListener("click", async () => {
      if (!("serial" in navigator)) {
        try { if (typeof appendLog === "function") appendLog("WebSerial non supporte", "py"); } catch (e) {}
        return;
      }
      try {
        const port = await navigator.serial.requestPort();
        const info = port.getInfo ? port.getInfo() : {};
        await startLogWithPort(info);
      } catch (e) {
        try { if (typeof appendLog === "function") appendLog("Selection port annulee", "py"); } catch (e2) {}
      }
    });
    if (btnStop) btnStop.addEventListener("click", stopLog);
    setStartStop(false);
    startStream();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
