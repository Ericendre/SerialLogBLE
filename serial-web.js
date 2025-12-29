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
    debugRx: true,
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

  const ECU_IDENTIFICATION_TABLE = [
    {
      offset: 0x82014,
      expected: [[54, 54, 50, 49]],
      ecu: {
        name: "SIMK43 8mbit",
        eeprom_size_bytes: 1048576,
        memory_offset: 0,
        bin_offset: 0,
        memory_write_offset: -0x7000,
        calibration_size_bytes: 0x10000,
        calibration_size_bytes_flash: 0xFEFE,
        program_section_offset: 0xA0000,
        program_section_size: 0x60000,
        program_section_flash_size: 0x5FFE8,
        program_section_flash_bin_offset: 0xA0010,
        program_section_flash_memory_offset: 0x10
      }
    },
    {
      offset: 0x90040,
      expected: [[99, 97, 54, 54]],
      ecu: {
        name: "SIMK43 2.0 4mbit",
        eeprom_size_bytes: 524288,
        memory_offset: 0,
        bin_offset: -0x80000,
        memory_write_offset: -0x7000,
        calibration_size_bytes: 0x10000,
        calibration_size_bytes_flash: 0xFEFE,
        program_section_offset: 0xA0000,
        program_section_size: 0x60000,
        program_section_flash_size: 0x5FFE8,
        program_section_flash_bin_offset: 0x20010,
        program_section_flash_memory_offset: 0x10
      }
    },
    {
      offset: 0x88040,
      expected: [[99, 97, 54, 53, 52, 48, 49]],
      ecu: {
        name: "SIMK43 V6 4mbit (5WY17)",
        eeprom_size_bytes: 524288,
        memory_offset: -0x8000,
        bin_offset: -0x88000,
        memory_write_offset: -0x7800,
        calibration_size_bytes: 0x8000,
        calibration_size_bytes_flash: 0x5F40,
        program_section_offset: 0x98000,
        program_section_size: 0x70000,
        program_section_flash_size: 0x6FFE4,
        program_section_flash_bin_offset: 0x10010,
        program_section_flash_memory_offset: -0x7FF0
      }
    },
    {
      offset: 0x88040,
      expected: [[99, 97, 54, 53, 52], [99, 97, 54, 53, 53]],
      ecu: {
        name: "SIMK43 V6 4mbit (5WY18+)",
        eeprom_size_bytes: 524288,
        memory_offset: -0x8000,
        bin_offset: -0x88000,
        memory_write_offset: -0x7800,
        calibration_size_bytes: 0x8000,
        calibration_size_bytes_flash: 0x6F20,
        program_section_offset: 0x98000,
        program_section_size: 0x70000,
        program_section_flash_size: 0x6FFE4,
        program_section_flash_bin_offset: 0x10010,
        program_section_flash_memory_offset: -0x7FF0
      }
    },
    {
      offset: 0x48040,
      expected: [[99, 97, 54, 54, 48], [99, 97, 54, 53, 50], [99, 97, 54, 53, 48]],
      ecu: {
        name: "SIMK41 / V6 2mbit",
        eeprom_size_bytes: 262144,
        memory_offset: -0x48000,
        bin_offset: -0x88000,
        memory_write_offset: -0xB800,
        calibration_size_bytes: 0x8000,
        calibration_size_bytes_flash: 0x7F00,
        program_section_offset: 0x98000,
        program_section_size: 0x30000,
        program_section_flash_size: 0x2FFF0,
        program_section_flash_bin_offset: 0x10010,
        program_section_flash_memory_offset: -0x47FF0
      }
    },
    {
      offset: 0x88040,
      expected: [[99, 97, 54, 54, 49]],
      ecu: {
        name: "SIMK43 2.0 4mbit (Sonata)",
        eeprom_size_bytes: 524288,
        memory_offset: -0x8000,
        bin_offset: -0x88000,
        memory_write_offset: -0x7800,
        calibration_size_bytes: 0x8000,
        calibration_size_bytes_flash: 0x5F40,
        program_section_offset: 0x98000,
        program_section_size: 0x70000,
        program_section_flash_size: 0x6FFE4,
        program_section_flash_bin_offset: 0x10010,
        program_section_flash_memory_offset: -0x7FF0
      }
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
  let readTimeoutMs = CONFIG.readTimeoutMs;
  let lastExecutionTime = Date.now();

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

  function hexDump(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  }

  function dropLeadingZeros() {
    while (buffer.length > 0 && buffer[0] === 0x00) {
      buffer.shift();
    }
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
    const effectiveTimeout = timeoutMs || readTimeoutMs;
    const deadline = Date.now() + effectiveTimeout;
    while (buffer.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timeout");
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), remaining));
      let result;
      try {
        result = await Promise.race([readPromise, timeoutPromise]);
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.toLowerCase().includes("break")) {
          continue;
        }
        throw e;
      }
      const { value, done } = result;
      if (done) throw new Error("serial closed");
      if (value && value.length) {
        if (CONFIG.debugRx) logUsb("RX " + hexDump(value));
        buffer.push(...value);
        dropLeadingZeros();
      }
    }
    const out = buffer.slice(0, length);
    buffer = buffer.slice(length);
    return Uint8Array.from(out);
  }

  async function readEcho(sentBytes, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 200);
    const collected = [];
    while (collected.length < sentBytes.length && Date.now() < deadline) {
      if (buffer.length > 0) {
        collected.push(buffer.shift());
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), remaining));
      let result;
      try {
        result = await Promise.race([readPromise, timeoutPromise]);
      } catch (e) {
        break;
      }
      const { value, done } = result;
      if (done) break;
      if (value && value.length) {
        if (CONFIG.debugRx) logUsb("RX " + hexDump(value));
        collected.push(...value);
      }
    }
    return collected;
  }

  async function writeRaw(bytes) {
    await delay(100);
    logUsb("TX " + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    await writer.write(bytes);
    const echo = await readEcho(bytes, 200);
    if (echo.length === 0) return;
    let same = true;
    const minLen = Math.min(echo.length, bytes.length);
    for (let i = 0; i < minLen; i++) {
      if (echo[i] !== bytes[i]) { same = false; break; }
    }
    if (!same) {
      buffer = echo.concat(buffer);
      dropLeadingZeros();
      logUsb("echo mismatch (kept as RX): " + hexDump(echo));
      return;
    }
    if (echo.length > bytes.length) {
      buffer = echo.slice(bytes.length).concat(buffer);
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

  async function readPdu(timeoutMs) {
    const header = await readExact(4, timeoutMs || readTimeoutMs);
    let counter = header[0];
    let data = [];
    if (counter === 0x80) {
      counter = header[3] + 1;
    } else {
      counter = counter - 0x80;
      data.push(header[3]);
    }
    const rest = await readExact(counter, timeoutMs || readTimeoutMs);
    for (let i = 0; i < rest.length - 1; i++) data.push(rest[i]);
    return Uint8Array.from(data);
  }

  async function sendReadPdu(pdu) {
    const payload = buildPayload(pdu);
    logUsb("PDU TX " + Array.from(pdu).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    await writeRaw(payload);
    const rx = await readPdu();
    logUsb("PDU RX " + Array.from(rx).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    return rx;
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
      const resp = await readExact(40, 400);
      return resp;
    } catch (e) {
      return null;
    }
  }

  async function initKwp() {
    await ensureReaderWriter();
    readTimeoutMs = 2000;

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
    let response = await fastInit(initPayload, 0);
    if (!response || ![0x00, 0x81, 0xC1].includes(response[0])) {
      response = await fastInit(initPayload, -2);
    }
    if (!response || ![0x00, 0x81, 0xC1].includes(response[0])) {
      response = await fastInit(initPayload, 2);
    }

    try { await readPdu(400); } catch (e) {}
  }

  async function execute(service, data) {
    return commandQueue = commandQueue.then(async () => {
      const pdu = Uint8Array.from([service].concat(data || []));
      let response = await sendReadPdu(pdu);
      let status = response[0];
      let payload = response.slice(1);
      while (status === 0x7f && payload[1] === 0x78) {
        response = await readPdu();
        status = response[0];
        payload = response.slice(1);
      }
      if (status === 0x7f) {
        const errService = payload[0];
        const errCode = payload[1];
        throw new Error("KWP negative response: service 0x" + errService.toString(16) + " code 0x" + errCode.toString(16));
      }
      lastExecutionTime = Date.now();
      return { status, data: payload };
    });
  }

  async function readMemoryByAddress(offset, size) {
    const b1 = (offset >> 16) & 0xff;
    const b2 = (offset >> 8) & 0xff;
    const b3 = offset & 0xff;
    const resp = await execute(0x23, [b1, b2, b3, size]);
    return Array.from(resp.data);
  }

  function calculateKey(seed) {
    let key = 0x9360;
    for (let i = 0; i < 0x24; i++) {
      key = (key * 2) ^ seed;
    }
    return key & 0xffff;
  }

  async function enableSecurityAccess() {
    const resp = await execute(0x27, [0x01]);
    const seed = resp.data.slice(1);
    if (seed.length < 2) return;
    if (seed[0] === 0x00 && seed[1] === 0x00) return;
    const seedConcat = ((seed[0] << 8) | seed[1]) & 0xffff;
    const key = calculateKey(seedConcat);
    const keyBytes = [(key >> 8) & 0xff, key & 0xff];
    await execute(0x27, [0x02].concat(keyBytes));
  }

  async function identifyEcu() {
    for (const entry of ECU_IDENTIFICATION_TABLE) {
      const expectedList = entry.expected || [];
      if (!expectedList.length) continue;
      const size = expectedList[0].length;
      try {
        const data = await readMemoryByAddress(entry.offset, size);
        for (const expected of expectedList) {
          if (expected.length !== data.length) continue;
          let match = true;
          for (let i = 0; i < expected.length; i++) {
            if (expected[i] !== data[i]) { match = false; break; }
          }
          if (match) return entry.ecu;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  async function readAscii(offset, size) {
    const data = await readMemoryByAddress(offset, size);
    return data.map((b) => String.fromCharCode(b)).join("");
  }

  async function startDiagnosticSession(sessionType, baudrateIdentifier) {
    const data = [sessionType];
    if (baudrateIdentifier !== undefined && baudrateIdentifier !== null) {
      data.push(baudrateIdentifier);
    }
    return execute(0x10, data);
  }

  async function setTimingParametersMax() {
    const timing = await execute(0x83, [0x00]);
    const params = Array.from(timing.data).slice(1);
    if (params.length >= 5) {
      await execute(0x83, [0x03].concat(params.slice(0, 5)));
    }
  }

  async function runKwpLogger() {
    logUsb("Selected protocol: kline. Initializing..");
    await initKwp();
    startKeepAlive();

    logUsb("Trying to start diagnostic session");
    await startDiagnosticSession(0x85);
    readTimeoutMs = 12000;

    logUsb("Set timing parameters to maximum");
    try { await setTimingParametersMax(); } catch (e) { logUsb("timing params failed"); }

    logUsb("Security Access");
    try { await enableSecurityAccess(); } catch (e) { logUsb("security access failed"); }

    logUsb("Trying to identify ECU automatically..");
    const ecu = await identifyEcu();
    if (!ecu) throw new Error("ECU identification failed");
    logUsb("Found! " + ecu.name);

    logUsb("Trying to find calibration..");
    try {
      const calib = await readAscii(0x090000 + ecu.memory_offset, 8);
      const desc = await readAscii(0x090040 + ecu.memory_offset, 8);
      logUsb("Found! Description: " + desc + ", calibration: " + calib);
    } catch (e) {
      logUsb("Calibration read failed");
    }

    logUsb("Building parameter header");
    emitHello();

    logUsb("Logging..");
    await startDiagnosticSession(0x81);
    startLogging();
  }

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      const elapsed = Date.now() - lastExecutionTime;
      if (elapsed >= CONFIG.keepAliveMs) {
        execute(0x3e, [0x01]).catch(() => {});
      }
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
      await runKwpLogger();
      setUiConnected(true);
      logUsb("KWP log started");
      try { if (typeof setStatus === "function") setStatus("connecte USB (KWP)"); } catch (e) {}
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      logUsb("connect error: " + msg);
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
