(() => {
  if (!("serial" in navigator)) {
    console.warn("WebSerial not supported in this browser.");
    return;
  }

  const CONFIG = {
    baudRate: 120000,
    txId: 0x11,
    rxId: 0xf1,
    logIntervalMs: 100,
    readTimeoutMs: 2000,
    keepAliveMs: 1500
  };

  const DATA_SOURCES = [
    {
      id: 0x01,
      parameters: [
        { name: "Oxygen Sensor-Bank1/Sensor1", unit: "mV", position: 38, size: 2, conversion: (a) => a * 4.883, precision: 1 },
        { name: "Air Flow Rate from Mass Air Flow Sensor", unit: "kg/h", position: 15, size: 2, conversion: (a) => a * 0.03125, precision: 2 },
        { name: "Engine Coolant Temperature Sensor", unit: "C", position: 4, size: 1, conversion: (a) => a * 0.75, precision: 2 },
        { name: "Oil Temperature Sensor", unit: "C", position: 6, size: 1, conversion: (a) => (a * 1) - 40, precision: 2 },
        { name: "Intake Air Temperature Sensor", unit: "C", position: 9, size: 1, conversion: (a) => (a * 0.75) - 48, precision: 2 },
        { name: "Throttle Position", unit: "'", position: 11, size: 1, conversion: (a) => a * 0.468627, precision: 2 },
        { name: "Battery voltage", unit: "V", position: 1, size: 1, conversion: (a) => a * 0.10159, precision: 2 },
        { name: "Vehicle Speed", unit: "km/h", position: 30, size: 1, conversion: (a) => a, precision: 1 },
        { name: "Engine Speed", unit: "RPM", position: 31, size: 2, conversion: (a) => a, precision: 1 },
        { name: "Oxygen Sensor-Bank1/Sensor2", unit: "mV", position: 40, size: 2, conversion: (a) => a * 4.883, precision: 2 },
        { name: "Ignition Timing Advance for 1 Cylinder", unit: "'", position: 58, size: 1, conversion: (a) => (a * -0.325) - 72, precision: 2 },
        { name: "Cylinder Injection Time-Bank1", unit: "ms", position: 76, size: 2, conversion: (a) => a * 0.004, precision: 2 },
        { name: "Long Term Fuel Trim-Idle Load", unit: "ms", position: 89, size: 2, conversion: (a) => a * 0.004, precision: 2 },
        { name: "Long Term Fuel Trim-Part Load", unit: "%", position: 91, size: 2, conversion: (a) => a * 0.001529, precision: 2 },
        { name: "Camshaft Actual Position", unit: "'", position: 142, size: 1, conversion: (a) => (a * 0.375) - 60, precision: 2 },
        { name: "Camshaft position target", unit: "'", position: 143, size: 1, conversion: (a) => (a * 0.375) - 60, precision: 2 },
        { name: "Ignition dwell time", unit: "ms", position: 106, size: 2, conversion: (a) => a * 0.004, precision: 2 },
        { name: "EVAP Purge valve", unit: "%", position: 101, size: 2, conversion: (a) => a * 0.003052, precision: 2 },
        { name: "Idle speed control actuator", unit: "%", position: 99, size: 2, conversion: (a) => a * 0.001529, precision: 2 },
        { name: "CVVT Valve Duty", unit: "%", position: 156, size: 2, conversion: (a) => a * 0.001526, precision: 2 },
        { name: "Oxygen Sensor Heater Duty-Bank1/Sensor1", unit: "%", position: 93, size: 1, conversion: (a) => a * 0.390625, precision: 2 },
        { name: "Oxygen Sensor Heater Duty-Bank1/Sensor2", unit: "%", position: 94, size: 1, conversion: (a) => a * 0.390625, precision: 2 },
        { name: "CVVT Status", unit: "", position: 145, size: 1, conversion: (a) => a, precision: 1 },
        { name: "CVVT Actuation Status", unit: "", position: 146, size: 1, conversion: (a) => a, precision: 1 },
        { name: "CVVT Duty Control Status", unit: "", position: 160, size: 1, conversion: (a) => a, precision: 1 }
      ]
    }
  ];

  let port = null;
  let reader = null;
  let writer = null;
  let buffer = [];
  let keepAliveTimer = null;
  let logTimer = null;
  let commandQueue = Promise.resolve();
  let breakSupported = true;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setUiConnected(connected) {
    const btnConnect = document.getElementById("btnSerialConnect");
    const btnDisconnect = document.getElementById("btnSerialDisconnect");
    if (btnConnect) btnConnect.disabled = connected;
    if (btnDisconnect) btnDisconnect.disabled = !connected;
  }

  function logUsb(line) {
    try { if (typeof appendLog === "function") appendLog(line, "usb"); } catch (e) {}
  }

  function readLE(bytes) {
    let val = 0;
    for (let i = 0; i < bytes.length; i++) {
      val |= (bytes[i] << (8 * i));
    }
    return val >>> 0;
  }

  function round(value, precision) {
    const p = Math.max(0, Math.min(6, precision || 0));
    return Number(value.toFixed(p));
  }

  function makeKey(name) {
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function buildHello() {
    const fields = [];
    for (const source of DATA_SOURCES) {
      for (const p of source.parameters) {
        fields.push({ key: makeKey(p.name), label: p.name, unit: p.unit || "" });
      }
    }
    const hello = { device: "KWP2000", schema: 1, fields };
    return "HELLO " + JSON.stringify(hello);
  }

  function emitHello() {
    try { if (typeof handleLine === "function") handleLine(buildHello()); } catch (e) {}
  }

  function emitData(values) {
    const t = Date.now();
    const csv = "DATA " + [t].concat(values.map((v) => Number.isFinite(v) ? v : "NaN")).join(",");
    try { if (typeof handleLine === "function") handleLine(csv); } catch (e) {}
  }

  async function ensureReaderWriter() {
    if (!reader) reader = port.readable.getReader();
    if (!writer) writer = port.writable.getWriter();
  }

  async function readExact(length, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (buffer.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timeout");
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), remaining));
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) throw new Error("serial closed");
      if (value && value.length) {
        buffer.push(...value);
      }
    }
    const out = buffer.slice(0, length);
    buffer = buffer.slice(length);
    return Uint8Array.from(out);
  }

  async function writeRaw(bytes) {
    await delay(100);
    await writer.write(bytes);
    const echo = await readExact(bytes.length, CONFIG.readTimeoutMs);
    let same = true;
    for (let i = 0; i < bytes.length; i++) {
      if (echo[i] !== bytes[i]) { same = false; break; }
    }
    if (!same) {
      logUsb("echo mismatch");
    }
  }

  function checksum(payload) {
    let sum = 0;
    for (let i = 0; i < payload.length; i++) sum = (sum + payload[i]) & 0xff;
    return sum & 0xff;
  }

  function buildPayload(data) {
    let payloadData = Array.from(data);
    let counter;
    if (payloadData.length < 127) {
      counter = 0x80 + payloadData.length;
    } else {
      counter = 0x80;
      payloadData = [payloadData.length].concat(payloadData);
    }
    const payload = [counter, CONFIG.txId, CONFIG.rxId].concat(payloadData);
    payload.push(checksum(payload));
    return Uint8Array.from(payload);
  }

  async function readPdu() {
    const header = await readExact(4, CONFIG.readTimeoutMs);
    let counter = header[0];
    let data = [];
    if (counter === 0x80) {
      counter = header[3] + 1;
    } else {
      counter = counter - 0x80;
      data.push(header[3]);
    }
    const rest = await readExact(counter, CONFIG.readTimeoutMs);
    for (let i = 0; i < rest.length - 1; i++) data.push(rest[i]);
    return Uint8Array.from(data);
  }

  async function sendReadPdu(pdu) {
    const payload = buildPayload(pdu);
    await writeRaw(payload);
    return readPdu();
  }

  async function fastInit(payload, timingOffsetMs) {
    const lowMs = 25 - timingOffsetMs;
    const highMs = 25 - timingOffsetMs;
    if (breakSupported) {
      try {
        await port.setSignals({ break: true });
        await delay(lowMs);
        await port.setSignals({ break: false });
        await delay(highMs);
      } catch (e) {
        breakSupported = false;
        logUsb("fast init break not supported");
      }
    }
    await writer.write(payload);
    try {
      await readExact(40, 400);
    } catch (e) {
      return null;
    }
    return true;
  }

  async function initKwp() {
    await ensureReaderWriter();

    try {
      await port.setSignals({ dataTerminalReady: true });
      await delay(100);
      await port.setSignals({ dataTerminalReady: false });
      await delay(100);
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await delay(100);
    } catch (e) {
      logUsb("DTR/RTS control not supported");
    }

    const initPdu = Uint8Array.from([0x81]);
    const initPayload = buildPayload(initPdu);
    let ok = await fastInit(initPayload, 0);
    if (!ok) {
      await fastInit(initPayload, -2);
      await fastInit(initPayload, 2);
    }
  }

  async function execute(service, data) {
    return commandQueue = commandQueue.then(async () => {
      const pdu = Uint8Array.from([service].concat(data || []));
      const response = await sendReadPdu(pdu);
      const status = response[0];
      const payload = response.slice(1);
      if (status === 0x7f) {
        const errService = payload[0];
        const errCode = payload[1];
        throw new Error("KWP negative response: service 0x" + errService.toString(16) + " code 0x" + errCode.toString(16));
      }
      return { status, data: payload };
    });
  }

  async function startSession() {
    await execute(0x10, [0x81]);
    try {
      const timing = await execute(0x83, [0x00]);
      const params = Array.from(timing.data);
      if (params.length >= 6) {
        const p = params.slice(1, 6);
        await execute(0x83, [0x03].concat(p));
      }
    } catch (e) {
      logUsb("timing params failed");
    }
  }

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      execute(0x3e, [0x01]).catch(() => {});
    }, CONFIG.keepAliveMs);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function grab(payload, param) {
    const slice = payload.slice(param.position, param.position + param.size);
    if (slice.length < param.size) return NaN;
    const raw = readLE(slice);
    return round(param.conversion(raw), param.precision);
  }

  async function pollOnce() {
    const values = [];
    for (const source of DATA_SOURCES) {
      const resp = await execute(0x21, [source.id]);
      const raw = Array.from(resp.data);
      for (const p of source.parameters) {
        values.push(grab(raw, p));
      }
    }
    emitData(values);
  }

  function startLogging() {
    stopLogging();
    emitHello();
    logTimer = setInterval(() => {
      pollOnce().catch((e) => logUsb("poll error"));
    }, CONFIG.logIntervalMs);
  }

  function stopLogging() {
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
  }

  async function connectSerial() {
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: CONFIG.baudRate });
      await ensureReaderWriter();
      await initKwp();
      await startSession();
      startKeepAlive();
      startLogging();
      setUiConnected(true);
      logUsb("KWP log started");
      try { if (typeof setStatus === "function") setStatus("connecte USB (KWP)"); } catch (e) {}
    } catch (e) {
      logUsb("connect error");
      try { if (typeof setStatus === "function") setStatus("erreur USB: " + e.message); } catch (e2) {}
      setUiConnected(false);
    }
  }

  async function disconnectSerial() {
    stopLogging();
    stopKeepAlive();
    try { if (reader) reader.releaseLock(); } catch (e) {}
    try { if (writer) writer.releaseLock(); } catch (e) {}
    reader = null;
    writer = null;
    try { if (port) await port.close(); } catch (e) {}
    port = null;
    buffer = [];
    setUiConnected(false);
    try { if (typeof setStatus === "function") setStatus("deconnecte USB"); } catch (e) {}
  }

  function initSerialUi() {
    const btnConnect = document.getElementById("btnSerialConnect");
    const btnDisconnect = document.getElementById("btnSerialDisconnect");
    if (!btnConnect || !btnDisconnect) return;
    setUiConnected(false);
    btnConnect.addEventListener("click", connectSerial);
    btnDisconnect.addEventListener("click", disconnectSerial);
  }

  navigator.serial.addEventListener("disconnect", (event) => {
    if (port && event.target === port) {
      disconnectSerial();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSerialUi);
  } else {
    initSerialUi();
  }
})();
