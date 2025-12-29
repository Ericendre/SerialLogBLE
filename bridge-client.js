(() => {
  async function fetchPorts() {
    const res = await fetch("/api/ports");
    if (!res.ok) throw new Error("ports fetch failed");
    return res.json();
  }

  function setStartStop(running) {
    const btnStart = document.getElementById("btnPyStart");
    const btnStop = document.getElementById("btnPyStop");
    if (btnStart) btnStart.disabled = running;
    if (btnStop) btnStop.disabled = !running;
  }

  async function refreshPorts() {
    const select = document.getElementById("comPort");
    if (!select) return;
    select.innerHTML = "";
    try {
      const ports = await fetchPorts();
      for (const p of ports) {
        const opt = document.createElement("option");
        opt.value = p.port;
        opt.textContent = p.port + (p.description ? " - " + p.description : "");
        select.appendChild(opt);
      }
    } catch (e) {
      try { if (typeof appendLog === "function") appendLog("Liste des ports indisponible", "py"); } catch (e2) {}
    }
  }

  async function startLog() {
    const select = document.getElementById("comPort");
    const port = select ? select.value : "";
    if (!port) {
      try { if (typeof appendLog === "function") appendLog("Aucun port COM selectionne", "py"); } catch (e) {}
      return;
    }
    const res = await fetch("/api/start?port=" + encodeURIComponent(port), { method: "POST" });
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
    const btnRefresh = document.getElementById("btnComRefresh");
    const btnStart = document.getElementById("btnPyStart");
    const btnStop = document.getElementById("btnPyStop");
    if (btnRefresh) btnRefresh.addEventListener("click", refreshPorts);
    if (btnStart) btnStart.addEventListener("click", startLog);
    if (btnStop) btnStop.addEventListener("click", stopLog);
    setStartStop(false);
    refreshPorts();
    startStream();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
