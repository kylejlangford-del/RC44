// RC44 Wind Calibrator — on-board calibration settings sync live across devices via Firebase
// Firestore (same project as Main Battens). Falls back to local-only (this browser only) mode if
// firebase-config.js hasn't been filled in yet.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

(function () {
  "use strict";

  // ================= CSV parsing (B&G H5000 export: ISO-8859-1, comma-delimited, ~10Hz) =================

  var COLS = {
    time: "Date/Time (UTC)",
    twd: "True Wind Direction °M",
    tws: "True Wind Speed m/s",
    twa: "True Wind Angle °",
    twaCorr: "TWA Correction °",
    twsCorr: "TWS Correction m/s",
    bspCorr: "Boat Speed Correction m/s",
    heel: "Heel °",
    heading: "Heading °M",
    bsp: "Boat Speed m/s",
    stw: "Speed Through Water m/s",
    sog: "Speed Over Ground m/s",
    cog: "Course Over Ground °M",
    rot: "Rate of Turn °/sec",
    leeway: "Signed Leeway Angle °"
  };

  var STATE_PREFIX = "rc44-windcal-v1-";
  var currentBoat = "artemis";
  var rowsByBoat = { artemis: [], gemera: [] };
  var tideByBoat = { artemis: [], gemera: [] };

  // Current on-board H5000 calibration settings (what's typed into the instrument right now),
  // per boat — three flat maps keyed "row|col" matching the breakpoints below: twa (° correction,
  // TWS x TWA), tws (kn correction, TWS x TWA), bsp (kn correction, boat speed x heel). Synced
  // live across devices via Firestore, same as Main Battens, so it only needs entering once.
  var onboardByBoat = {
    artemis: { twa: {}, tws: {}, bsp: {} },
    gemera: { twa: {}, tws: {}, bsp: {} }
  };
  var onboardLive = false;
  var onboardDb = null;

  loadTide();
  loadOnboardLocal();

  function loadTide() {
    try {
      var raw = localStorage.getItem(STATE_PREFIX + currentBoat + "-tide");
      tideByBoat[currentBoat] = raw ? JSON.parse(raw) : [];
    } catch (e) { tideByBoat[currentBoat] = []; }
  }

  function saveTide() {
    try { localStorage.setItem(STATE_PREFIX + currentBoat + "-tide", JSON.stringify(tideByBoat[currentBoat])); } catch (e) { /* ignore */ }
  }

  // ---------- On-board settings: Firebase sync (falls back to local-only) ----------

  function loadOnboardLocal() {
    ["artemis", "gemera"].forEach(function (boat) {
      try {
        var raw = localStorage.getItem(STATE_PREFIX + boat + "-onboard");
        if (raw) {
          var parsed = JSON.parse(raw);
          onboardByBoat[boat] = {
            twa: parsed.twa || {}, tws: parsed.tws || {}, bsp: parsed.bsp || {}
          };
        }
      } catch (e) { /* ignore */ }
    });
  }

  function saveOnboardLocal(boat) {
    try { localStorage.setItem(STATE_PREFIX + boat + "-onboard", JSON.stringify(onboardByBoat[boat])); } catch (e) { /* ignore */ }
  }

  var cfg = window.RC44_FIREBASE_CONFIG || {};
  var configured = cfg.apiKey && cfg.apiKey.indexOf("REPLACE_ME") === -1;

  if (configured) {
    try {
      var fbApp = initializeApp(cfg);
      onboardDb = getFirestore(fbApp);
      var auth = getAuth(fbApp);
      onAuthStateChanged(auth, function (user) {
        if (user) {
          onboardLive = true;
          var warn = document.getElementById("configWarning");
          if (warn) warn.classList.add("is-hidden");
          ["artemis", "gemera"].forEach(subscribeOnboard);
        }
      });
      signInAnonymously(auth).catch(function (e) {
        console.error("Anonymous sign-in failed, on-board settings stay local-only:", e);
      });
    } catch (e) {
      console.error("Firebase init failed, on-board settings stay local-only:", e);
    }
  } else {
    var warnEl = document.getElementById("configWarning");
    if (warnEl) warnEl.classList.remove("is-hidden");
  }

  function subscribeOnboard(boat) {
    var ref = doc(onboardDb, "rc44-onboard-settings", boat);
    onSnapshot(ref, function (snap) {
      if (snap.exists()) {
        var d = snap.data();
        onboardByBoat[boat] = { twa: d.twa || {}, tws: d.tws || {}, bsp: d.bsp || {} };
      }
      if (boat === currentBoat && lastResults) renderResults(lastResults);
    }, function (err) { console.error("On-board settings sync error for " + boat, err); });
  }

  function saveOnboard(boat) {
    if (!onboardLive) { saveOnboardLocal(boat); return; }
    var ref = doc(onboardDb, "rc44-onboard-settings", boat);
    setDoc(ref, {
      twa: onboardByBoat[boat].twa,
      tws: onboardByBoat[boat].tws,
      bsp: onboardByBoat[boat].bsp,
      updatedAt: serverTimestamp()
    }).catch(function (e) { console.error("On-board settings save failed for " + boat, e); });
  }

  function setOnboardValue(boat, table, key, value) {
    onboardByBoat[boat][table][key] = value;
    saveOnboard(boat);
  }

  function splitCsvLine(line) { return line.split(","); }

  function parseCsvText(text, target) {
    var lines = text.split(/\r?\n/);
    if (!lines.length) return;
    var head = splitCsvLine(lines[0]);
    var idx = {};
    Object.keys(COLS).forEach(function (key) { idx[key] = head.indexOf(COLS[key]); });
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      var cells = splitCsvLine(line);
      if (cells.length < 3) continue;
      var row = {};
      Object.keys(idx).forEach(function (key) {
        var v = idx[key] >= 0 ? cells[idx[key]] : "";
        row[key] = v === "" || v === undefined ? null : parseFloat(v);
      });
      row.timeRaw = cells[0];
      row.minuteOfDay = parseMinuteOfDay(cells[0]);
      if (row.twa !== null || row.tws !== null) target.push(row);
    }
  }

  function parseMinuteOfDay(raw) {
    // "27.06.2026 09:10:00.470" -> minutes since midnight (UTC, as logged)
    var m = /(\d{2}):(\d{2}):(\d{2})/.exec(raw || "");
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  }

  function readFileAsLatin1(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new TextDecoder("iso-8859-1").decode(new Uint8Array(reader.result)));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function isZipFile(file) {
    return /\.zip$/i.test(file.name || "") ||
      file.type === "application/zip" || file.type === "application/x-zip-compressed";
  }

  function isGzFile(file) {
    return /\.(gz|tgz)$/i.test(file.name || "") ||
      file.type === "application/gzip" || file.type === "application/x-gzip";
  }

  // Decompresses a .gz file to raw bytes — the browser's native gzip support if it has it,
  // falling back to the vendored pako library (older Safari/WebViews, e.g. an embedded browser
  // launched from the phone's Files app, don't always have DecompressionStream).
  async function gunzipToBytes(file) {
    if (typeof DecompressionStream !== "undefined") {
      try {
        var stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
        var buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { /* fall through to pako below */ }
    }
    if (typeof pako !== "undefined") {
      return pako.ungzip(new Uint8Array(await file.arrayBuffer()));
    }
    throw new Error("Can't unzip .gz files in this browser — try updating it, or unzip the file first.");
  }

  // A .tar.gz (a gzipped bundle of several files, rather than a single gzipped CSV) decompresses
  // to a plain (uncompressed) tar archive — this reads its file entries without needing a
  // separate tar library, since the tar format itself is just fixed-size headers, no compression.
  function readTarEntries(bytes) {
    var entries = [];
    var offset = 0;
    while (offset + 512 <= bytes.length) {
      var header = bytes.subarray(offset, offset + 512);
      if (header.every(function (b) { return b === 0; })) break; // end-of-archive marker
      var name = latin1Bytes(header.subarray(0, 100)).replace(/\0.*$/, "");
      var sizeStr = latin1Bytes(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
      var size = parseInt(sizeStr, 8) || 0;
      var typeFlag = String.fromCharCode(header[156] || 0);
      offset += 512;
      if (name && (typeFlag === "0" || typeFlag === "\0") && !/\/$/.test(name)) {
        entries.push({ name: name, bytes: bytes.subarray(offset, offset + size) });
      }
      offset += Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  function latin1Bytes(bytes) {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }

  // Expands any .zip/.gz/.tar.gz archive (e.g. the export downloaded straight off the phone,
  // before it's been unzipped) into its inner .csv entries, decoded the same ISO-8859-1 way as a
  // plain CSV upload. Plain .csv files selected alongside/instead of an archive are read as-is.
  async function collectCsvEntries(files) {
    var out = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (isZipFile(file)) {
        if (typeof JSZip === "undefined") throw new Error("Zip support failed to load — reload the page and try again.");
        var buf = await file.arrayBuffer();
        var zip = await JSZip.loadAsync(buf);
        var names = Object.keys(zip.files).filter(function (name) {
          var entry = zip.files[name];
          return entry && !entry.dir && /\.csv$/i.test(name);
        });
        for (var j = 0; j < names.length; j++) {
          var bytes = await zip.files[names[j]].async("uint8array");
          out.push({ name: names[j], text: latin1Bytes(bytes) });
        }
      } else if (isGzFile(file)) {
        var unzipped = await gunzipToBytes(file);
        var looksLikeTar = unzipped.length > 262 &&
          latin1Bytes(unzipped.subarray(257, 262)) === "ustar";
        if (looksLikeTar || /\.tar\.gz$|\.tgz$/i.test(file.name || "")) {
          var tarEntries = readTarEntries(unzipped).filter(function (e) { return /\.csv$/i.test(e.name); });
          tarEntries.forEach(function (e) { out.push({ name: e.name, text: latin1Bytes(e.bytes) }); });
        } else {
          out.push({ name: (file.name || "log").replace(/\.gz$/i, ""), text: latin1Bytes(unzipped) });
        }
      } else {
        out.push({ name: file.name, text: await readFileAsLatin1(file) });
      }
    }
    return out;
  }

  var fileInput = document.getElementById("csvInput");
  var summaryEl = document.getElementById("csvSummary");
  var analyzeBtn = document.getElementById("analyzeBtn");

  fileInput.addEventListener("change", async function () {
    var files = Array.from(fileInput.files || []);
    if (!files.length) return;
    summaryEl.textContent = "Reading " + files.length + " file(s)…";
    summaryEl.classList.remove("is-hidden");

    var entries;
    try {
      entries = await collectCsvEntries(files);
    } catch (e) {
      console.error("Failed to read log files", e);
      summaryEl.textContent = "Couldn't read that — check it's the CSV export, or the .zip/.gz from your phone. (" + e.message + ")";
      analyzeBtn.disabled = true;
      return;
    }

    if (!entries.length) {
      var hadArchive = files.some(function (f) { return isZipFile(f) || isGzFile(f); });
      summaryEl.textContent = hadArchive ? "No CSV files found inside that." : "No CSV files selected.";
      analyzeBtn.disabled = true;
      return;
    }

    var rows = [];
    entries.forEach(function (e) { parseCsvText(e.text, rows); });
    rows.sort(function (a, b) { return (a.timeRaw || "").localeCompare(b.timeRaw || ""); });
    rowsByBoat[currentBoat] = rows;
    summaryEl.textContent = entries.length + " CSV file(s) loaded · " + rows.length.toLocaleString() + " samples";
    analyzeBtn.disabled = rows.length === 0;
  });

  // ================= Boat switcher =================

  document.querySelectorAll(".boat-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentBoat = btn.dataset.boat;
      document.querySelectorAll(".boat-tab").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      loadTide();
      renderTideTable();
      var rows = rowsByBoat[currentBoat];
      summaryEl.textContent = rows.length ? rows.length.toLocaleString() + " samples loaded for " + currentBoat : "";
      summaryEl.classList.toggle("is-hidden", !rows.length);
      analyzeBtn.disabled = !rows.length;
      document.getElementById("resultsPanel").classList.add("is-hidden");
    });
  });

  // ================= Tide / current input =================

  function renderTideTable() {
    var body = document.getElementById("tideBody");
    body.innerHTML = "";
    tideByBoat[currentBoat].forEach(function (t, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><input type='time' value='" + t.time + "' data-i='" + i + "' data-f='time'></td>" +
        "<td><input type='number' step='0.01' value='" + t.rate + "' data-i='" + i + "' data-f='rate' style='width:80px;'></td>" +
        "<td><input type='number' step='1' value='" + t.set + "' data-i='" + i + "' data-f='set' style='width:80px;'></td>" +
        "<td><button type='button' class='text-link' data-remove='" + i + "'>Remove</button></td>";
      body.appendChild(tr);
    });
    body.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var i = Number(inp.dataset.i), f = inp.dataset.f;
        tideByBoat[currentBoat][i][f] = f === "time" ? inp.value : Number(inp.value);
        saveTide();
      });
    });
    body.querySelectorAll("[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        tideByBoat[currentBoat].splice(Number(btn.dataset.remove), 1);
        saveTide();
        renderTideTable();
      });
    });
  }

  document.getElementById("addTideRowBtn").addEventListener("click", function () {
    tideByBoat[currentBoat].push({ time: "12:00", rate: 1.0, set: 0 });
    saveTide();
    renderTideTable();
  });

  function currentAt(minuteOfDay) {
    var tide = tideByBoat[currentBoat];
    if (!tide.length || minuteOfDay === null) return null;
    var best = null, bestDiff = Infinity;
    tide.forEach(function (t) {
      var m = /(\d{2}):(\d{2})/.exec(t.time);
      if (!m) return;
      var tm = Number(m[1]) * 60 + Number(m[2]);
      var diff = Math.abs(tm - minuteOfDay);
      if (diff < bestDiff) { bestDiff = diff; best = t; }
    });
    return best; // nearest-time reading, {rate (kn), set (deg true)}
  }

  // ================= Math helpers =================

  function toRad(d) { return d * Math.PI / 180; }
  function mean(arr) { if (!arr.length) return null; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }
  function angleMean(deg) {
    if (!deg.length) return null;
    var sx = 0, sy = 0;
    deg.forEach(function (d) { sx += Math.cos(toRad(d)); sy += Math.sin(toRad(d)); });
    var a = Math.atan2(sy / deg.length, sx / deg.length) * 180 / Math.PI;
    return a < 0 ? a + 360 : a;
  }
  function angleDiff(a, b) { var d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
  function angleStd(deg) {
    // Circular standard deviation (degrees) — how scattered the TWD readings are.
    // Wide sailing-in-shifts logs give a high value; a clean steady leg gives a low one.
    if (!deg.length) return null;
    var sx = 0, sy = 0;
    deg.forEach(function (d) { sx += Math.cos(toRad(d)); sy += Math.sin(toRad(d)); });
    var R = Math.sqrt(sx * sx + sy * sy) / deg.length;
    if (R <= 0) return 180;
    if (R >= 1) return 0;
    return Math.sqrt(-2 * Math.log(R)) * 180 / Math.PI;
  }
  function ms2kn(v) { return v === null || v === undefined ? null : v * 1.94384; }
  function fmt(v, d) { return v === null || v === undefined || isNaN(v) ? "—" : v.toFixed(d === undefined ? 2 : d); }

  function bucketFloor(value, breakpoints) {
    // Largest breakpoint <= value; clamps to range.
    var b = breakpoints[0];
    for (var i = 0; i < breakpoints.length; i++) {
      if (breakpoints[i] <= value) b = breakpoints[i]; else break;
    }
    return b;
  }
  function bucketNearest(value, step, min, max) {
    var v = Math.round(value / step) * step;
    return Math.max(min, Math.min(max, v));
  }
  function bucketNearestFromList(value, list) {
    // Nearest breakpoint in an arbitrary (possibly uneven) sorted list, clamped to range.
    var best = list[0], bestDiff = Math.abs(value - list[0]);
    for (var i = 1; i < list.length; i++) {
      var d = Math.abs(value - list[i]);
      if (d < bestDiff) { bestDiff = d; best = list[i]; }
    }
    return best;
  }

  // Vector subtraction: boat-over-ground (sog,cog) minus current (rate,set) -> water-referenced speed (kn).
  function waterSpeedKn(sogMs, cogDeg, currentRateKn, currentSetDeg) {
    if (sogMs === null || cogDeg === null) return null;
    var sogKn = ms2kn(sogMs);
    var bx = sogKn * Math.sin(toRad(cogDeg)), by = sogKn * Math.cos(toRad(cogDeg));
    var cx = 0, cy = 0;
    if (currentRateKn !== null && currentSetDeg !== null) {
      cx = currentRateKn * Math.sin(toRad(currentSetDeg));
      cy = currentRateKn * Math.cos(toRad(currentSetDeg));
    }
    var wx = bx - cx, wy = by - cy;
    return Math.sqrt(wx * wx + wy * wy);
  }

  // ================= Analysis =================

  // Table breakpoints — matched exactly to the boat's own H5000 on-board calibration tables
  // (confirmed from screenshots of the actual instrument: TWA-correction, TWS-correction and
  // boat-speed-vs-heel tables). Both boats run the same H5000 table layout.
  var BSP_BINS = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];
  var HEEL_BINS = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30];
  var TWS_BINS = [1, 5, 10, 15, 20, 25, 30];
  var TWA_BINS = [0, 30, 50, 90, 140, 150, 160, 180];

  // MHU confidence: a whole-session port-vs-starboard TWD average (H5000 manual Method 1)
  // is a cruder estimate than a professional's matched tack-by-tack manoeuvre analysis, and
  // checking it against two real calibration reports for the same physical logs showed why:
  // both real sessions had similar TWD spread (7-14°) and plenty of samples, yet one report
  // called for an adjustment and the other explicitly said "not enough valid manoeuvres,
  // leave as is" — a whole-day spread/count threshold alone can't reliably tell those two
  // apart. So this isn't a pass/fail gate pretending to replicate that judgment call; it's a
  // three-tier confidence label (High / Moderate / Low) that always shows the underlying
  // numbers, and asks for a sanity-check against feel/logbook whenever it isn't clearly High.
  var MHU_HIGH_SAMPLES = 300, MHU_HIGH_STD = 6, MHU_HIGH_BALANCE = 0.5;   // apply as suggested
  var MHU_LOW_SAMPLES = 50, MHU_LOW_STD = 25, MHU_LOW_BALANCE = 0.15;      // too thin to use at all

  var lastResults = null;

  function runAnalysis() {
    var rows = rowsByBoat[currentBoat];
    var minBsp = parseFloat(document.getElementById("minBsp").value) || 0;
    var maxRot = parseFloat(document.getElementById("maxRot").value) || 999;
    var mhuMinTwa = parseFloat(document.getElementById("minTwa").value) || 15;
    var mhuMaxTwa = parseFloat(document.getElementById("maxTwa").value) || 60;
    var hasTide = tideByBoat[currentBoat].length > 0;

    var steady = rows.filter(function (r) {
      if (r.twa === null || r.bsp === null) return false;
      if (r.bsp < minBsp) return false;
      if (r.rot !== null && Math.abs(r.rot) > maxRot) return false;
      return true;
    });

    // ---- MHU offset / global TWA correction (H5000 manual Method 1: TWD monitoring across tacks) ----
    var mhuSet = steady.filter(function (r) { return Math.abs(r.twa) >= mhuMinTwa && Math.abs(r.twa) <= mhuMaxTwa; });
    var port = mhuSet.filter(function (r) { return r.twa < 0; });
    var stbd = mhuSet.filter(function (r) { return r.twa >= 0; });
    var portTwds = port.map(function (r) { return r.twd; }).filter(function (v) { return v !== null; });
    var stbdTwds = stbd.map(function (r) { return r.twd; }).filter(function (v) { return v !== null; });
    var twdPort = angleMean(portTwds);
    var twdStbd = angleMean(stbdTwds);
    var twdPortStd = angleStd(portTwds);
    var twdStbdStd = angleStd(stbdTwds);
    var mhuAdjustment = (twdPort !== null && twdStbd !== null) ? angleDiff(twdStbd, twdPort) / 2 : null;
    var currentTwaCorr = mean(mhuSet.map(function (r) { return r.twaCorr; }).filter(function (v) { return v !== null; }));
    var suggestedMhu = (currentTwaCorr !== null && mhuAdjustment !== null) ? currentTwaCorr + mhuAdjustment : null;

    // Confidence — see the MHU_HIGH_* / MHU_LOW_* constants above for the reasoning.
    var balance = (port.length && stbd.length) ? Math.min(port.length, stbd.length) / Math.max(port.length, stbd.length) : 0;
    var worstStd = Math.max(twdPortStd === null ? 0 : twdPortStd, twdStbdStd === null ? 0 : twdStbdStd);
    var minSamp = Math.min(port.length, stbd.length);
    var mhuLevel;
    if (suggestedMhu === null) {
      mhuLevel = "low";
    } else if (minSamp < MHU_LOW_SAMPLES || balance < MHU_LOW_BALANCE || worstStd > MHU_LOW_STD) {
      mhuLevel = "low";
    } else if (minSamp >= MHU_HIGH_SAMPLES && balance >= MHU_HIGH_BALANCE && worstStd <= MHU_HIGH_STD) {
      mhuLevel = "high";
    } else {
      mhuLevel = "moderate";
    }
    var mhuReasons = [];
    if (minSamp < MHU_HIGH_SAMPLES) mhuReasons.push("smaller tack has " + minSamp + " samples (High needs " + MHU_HIGH_SAMPLES + "+)");
    if (balance < MHU_HIGH_BALANCE) mhuReasons.push("time split " + fmt(balance * 100, 0) + "/100 between tacks (High needs " + Math.round(MHU_HIGH_BALANCE * 100) + "/100+)");
    if (worstStd > MHU_HIGH_STD) mhuReasons.push("TWD spread up to ±" + fmt(worstStd, 1) + "° within a tack (High needs ≤" + MHU_HIGH_STD + "°) — likely real shifts during the session, not just noise");

    // ---- BSP vs heel correction table (tide-corrected water speed minus logged BSP) ----
    var bspBins = BSP_BINS;
    var bspHeelTable = {};
    var bspHeelCounts = {};
    steady.forEach(function (r) {
      if (r.heel === null) return;
      var cur = currentAt(r.minuteOfDay);
      var water = waterSpeedKn(r.sog, r.cog, cur ? cur.rate : null, cur ? cur.set : null);
      if (water === null) return;
      var bBsp = bucketNearestFromList(ms2kn(r.bsp), bspBins);
      var bHeel = bucketNearest(r.heel, 5, -30, 30);
      var key = bBsp + "|" + bHeel;
      var corr = water - ms2kn(r.bsp);
      if (!bspHeelTable[key]) { bspHeelTable[key] = []; }
      bspHeelTable[key].push(corr);
    });
    Object.keys(bspHeelTable).forEach(function (k) {
      bspHeelCounts[k] = bspHeelTable[k].length;
      bspHeelTable[k] = mean(bspHeelTable[k]);
    });

    // ---- Upwash angle table (TWA correction, indexed by TWS x |TWA|) ----
    var angleBins = {}; // key: twsBin|twaBin -> {port:[twd], stbd:[twd], twaCorr:[]}
    steady.forEach(function (r) {
      if (r.tws === null || r.twa === null || r.twd === null) return;
      var bTws = bucketFloor(r.tws, TWS_BINS);
      var bTwa = bucketFloor(Math.abs(r.twa), TWA_BINS);
      var key = bTws + "|" + bTwa;
      if (!angleBins[key]) angleBins[key] = { port: [], stbd: [], twaCorr: [] };
      (r.twa < 0 ? angleBins[key].port : angleBins[key].stbd).push(r.twd);
      if (r.twaCorr !== null) angleBins[key].twaCorr.push(r.twaCorr);
    });
    var angleTable = {}, angleCounts = {};
    Object.keys(angleBins).forEach(function (key) {
      var b = angleBins[key];
      var tp = angleMean(b.port), ts = angleMean(b.stbd);
      var cur = mean(b.twaCorr);
      angleCounts[key] = b.port.length + b.stbd.length;
      if (tp === null || ts === null || cur === null) { angleTable[key] = null; return; }
      var adj = angleDiff(ts, tp) / 2;
      angleTable[key] = { current: cur, suggested: cur + adj, n: angleCounts[key] };
    });

    // ---- Upwash speed table (TWS correction, indexed by TWS x |TWA|; reaching = reference) ----
    var speedBins = {}; // key: twsBin|twaBin -> {tws:[], twsCorr:[]}
    steady.forEach(function (r) {
      if (r.tws === null || r.twa === null) return;
      var bTws = bucketFloor(r.tws, TWS_BINS);
      var bTwa = bucketFloor(Math.abs(r.twa), TWA_BINS);
      var key = bTws + "|" + bTwa;
      if (!speedBins[key]) speedBins[key] = { tws: [], twsCorr: [] };
      speedBins[key].tws.push(r.tws);
      if (r.twsCorr !== null) speedBins[key].twsCorr.push(r.twsCorr);
    });
    var speedTable = {};
    TWS_BINS.forEach(function (bTws) {
      var refKey = bTws + "|90";
      var ref = speedBins[refKey] ? mean(speedBins[refKey].tws) : null;
      TWA_BINS.forEach(function (bTwa) {
        var key = bTws + "|" + bTwa;
        var b = speedBins[key];
        if (!b || !b.tws.length) { speedTable[key] = null; return; }
        var thisMean = mean(b.tws);
        var cur = mean(b.twsCorr);
        if (cur === null || ref === null) { speedTable[key] = { current: cur, suggested: null, n: b.tws.length }; return; }
        var delta = ref - thisMean;
        speedTable[key] = { current: cur, suggested: cur + delta, n: b.tws.length };
      });
    });

    lastResults = {
      boat: currentBoat, hasTide: hasTide,
      steadyCount: steady.length, portCount: port.length, stbdCount: stbd.length,
      twdPort: twdPort, twdStbd: twdStbd, twdPortStd: twdPortStd, twdStbdStd: twdStbdStd, mhuAdjustment: mhuAdjustment,
      currentTwaCorr: currentTwaCorr, suggestedMhu: suggestedMhu, mhuLevel: mhuLevel, mhuReasons: mhuReasons,
      bspBins: bspBins, bspHeelTable: bspHeelTable, bspHeelCounts: bspHeelCounts,
      angleTable: angleTable, speedTable: speedTable
    };
    renderResults(lastResults);
  }

  analyzeBtn.addEventListener("click", runAnalysis);

  // ================= Rendering =================

  function renderResults(res) {
    document.getElementById("resultsPanel").classList.remove("is-hidden");
    document.getElementById("resultsBoat").textContent = res.boat.charAt(0).toUpperCase() + res.boat.slice(1);
    document.getElementById("sampleCounts").textContent =
      res.steadyCount.toLocaleString() + " steady-state samples (" + res.portCount.toLocaleString() + " port / " +
      res.stbdCount.toLocaleString() + " starboard in the MHU angle window)" +
      (res.hasTide ? " · tide-corrected using " + tideByBoat[currentBoat].length + " current reading(s)" : " · no tide data entered — boat-speed table uses raw SOG");

    // Headline answers
    if (res.mhuLevel === "low") {
      document.getElementById("mhuAnswer").innerHTML =
        "<strong style='font-size:1.1rem;'>No change recommended</strong> " +
        "<span class='pill pill--warn'>not enough clean data to trust an MHU adjustment</span>" +
        (res.currentTwaCorr !== null ? "<div style='font-size:.95rem; color:var(--muted-2); margin-top:6px;'>Leave the TWA correction at " + fmt(res.currentTwaCorr, 1) + "° · would have computed " + fmt(res.suggestedMhu, 1) + "° — see detailed report for why that number isn't trusted.</div>" : "");
    } else if (res.mhuLevel === "high") {
      document.getElementById("mhuAnswer").innerHTML =
        "<strong>" + fmt(res.suggestedMhu, 1) + "°</strong>" +
        (res.currentTwaCorr !== null ? " <span class='pill'>currently " + fmt(res.currentTwaCorr, 1) + "°</span>" : "");
    } else {
      document.getElementById("mhuAnswer").innerHTML =
        "<strong>" + fmt(res.suggestedMhu, 1) + "°</strong>" +
        (res.currentTwaCorr !== null ? " <span class='pill'>currently " + fmt(res.currentTwaCorr, 1) + "°</span>" : "") +
        " <span class='pill pill--warn'>moderate confidence — cross-check before applying</span>";
    }

    renderCompareGrid({
      containerId: "twaGrid", summaryId: "twaSummary", boat: res.boat, table: "twa",
      rows: TWS_BINS, cols: TWA_BINS, tol: 0.3, decimals: 1, unit: "°",
      caption: "row = TWS (kn), col = TWA (°) — matches the H5000's TWA correction table",
      getSuggested: function (r, c) {
        var e = res.angleTable[r + "|" + c];
        return e ? { value: e.suggested, n: e.n } : { value: null, n: 0 };
      }
    });

    renderCompareGrid({
      containerId: "twsGrid", summaryId: "twsSummary", boat: res.boat, table: "tws",
      rows: TWS_BINS, cols: TWA_BINS, tol: 0.05, decimals: 2, unit: "kn",
      caption: "row = TWS (kn), col = TWA (°) — matches the H5000's TWS correction table · reaching (90°) used as reference",
      getSuggested: function (r, c) {
        var e = res.speedTable[r + "|" + c];
        return e ? { value: e.suggested, n: e.n } : { value: null, n: 0 };
      }
    });

    renderCompareGrid({
      containerId: "bspGrid", summaryId: "bspSummary", boat: res.boat, table: "bsp",
      rows: res.bspBins, cols: HEEL_BINS, tol: 0.05, decimals: 2, unit: "kn",
      caption: "row = boat speed (kn), col = heel (° · negative = port heel, positive = starboard)",
      getSuggested: function (r, c) {
        var v = res.bspHeelTable[r + "|" + c];
        var n = res.bspHeelCounts[r + "|" + c] || 0;
        return { value: v === undefined ? null : v, n: n };
      }
    });

    // Detailed report
    var detail = "";
    detail += "<h3>MHU offset / TWA — method detail</h3>";
    detail += "<p class='import-step__hint'>H5000 manual Method 1: compare mean True Wind Direction on each tack — if they don't match, half the gap is added to the TWA/MHU correction, in the direction that brings both tacks' TWD to agree.</p>";
    detail += "<table class='compare-table'><tbody>" +
      "<tr><td>Port-tack mean TWD</td><td>" + fmt(res.twdPort, 1) + "° <span style='color:var(--muted-2);'>(±" + fmt(res.twdPortStd, 1) + "° spread, n=" + res.portCount + ")</span></td></tr>" +
      "<tr><td>Starboard-tack mean TWD</td><td>" + fmt(res.twdStbd, 1) + "° <span style='color:var(--muted-2);'>(±" + fmt(res.twdStbdStd, 1) + "° spread, n=" + res.stbdCount + ")</span></td></tr>" +
      "<tr><td>Suggested adjustment</td><td>" + (res.mhuAdjustment >= 0 ? "+" : "") + fmt(res.mhuAdjustment, 2) + "°</td></tr>" +
      "<tr><td>Current TWA correction (from log)</td><td>" + fmt(res.currentTwaCorr, 2) + "°</td></tr>" +
      "<tr><td>Computed value</td><td>" + fmt(res.suggestedMhu, 2) + "°</td></tr>" +
      "<tr><td>Confidence</td><td>" + ({ high: "<strong>High</strong> — apply as suggested", moderate: "<strong>Moderate</strong> — reasonable estimate, but verify against feel/logbook before entering it", low: "<strong>Low</strong> — not enough clean data, no change recommended" }[res.mhuLevel]) +
      (res.mhuReasons.length ? "<div style='color:var(--muted-2); font-size:.86rem; margin-top:4px;'>" + res.mhuReasons.join("<br>") + "</div>" : "") + "</td></tr>" +
      "</tbody></table>";
    detail += "<p class='import-step__hint' style='margin-top:8px;'>This is a whole-session port-vs-starboard average, same as the H5000 manual's Method 1 — it isn't a matched tack-by-tack manoeuvre analysis, so it's a cruder estimate than a professional calibration session. Checking it against two real reports for the same boat found the confidence level matters: a whole day's spread and sample count can look similar whether or not an adjustment was actually warranted, so treat anything below High as a hint to sanity-check, not a number to type straight into the H5000.</p>";

    detail += "<h3 style='margin-top:22px;'>BSP vs heel — sample counts</h3>";
    detail += gridHtml(res.bspBins, HEEL_BINS, function (r, c) {
      var n = res.bspHeelCounts[r + "|" + c];
      return n ? String(n) : "";
    }, "Samples per bin — a cell with few samples is a noisy suggestion.");

    detail += "<h3 style='margin-top:22px;'>Upwash angle — current vs suggested</h3>";
    detail += "<table class='compare-table'><thead><tr><th>TWS</th><th>|TWA|</th><th>n</th><th>Current</th><th>Suggested</th></tr></thead><tbody>";
    TWS_BINS.forEach(function (bTws) {
      TWA_BINS.forEach(function (bTwa) {
        var e = res.angleTable[bTws + "|" + bTwa];
        if (!e) return;
        detail += "<tr><td>" + bTws + "</td><td>" + bTwa + "</td><td>" + e.n + "</td><td>" + fmt(e.current, 1) + "°</td><td>" + fmt(e.suggested, 1) + "°</td></tr>";
      });
    });
    detail += "</tbody></table>";

    document.getElementById("detailBody").innerHTML = detail;
  }

  // Minimum samples in a cell before its computed suggestion is trusted enough to flag a change —
  // below this it's treated the same as "no data yet" (shown dim, never highlighted red), same
  // spirit as the MHU confidence tiers above.
  var CELL_MIN_SAMPLES = 5;

  // Renders one on-board calibration table as a single grid: editable inputs holding what's
  // currently set on the H5000 (synced live across devices), with any cell where the log's
  // computed suggestion differs from that current value highlighted red and showing the new
  // number underneath — so the grid IS the report the user asked for, not a separate readout.
  function renderCompareGrid(opts) {
    var current = onboardByBoat[opts.boat][opts.table];
    var withSuggestion = 0, changes = 0;
    var html = "<p class='import-step__hint'>" + opts.caption + "</p>";
    html += "<table class='compare-table grid-table'><thead><tr><th></th>";
    opts.cols.forEach(function (c) { html += "<th>" + c + "</th>"; });
    html += "</tr></thead><tbody>";
    opts.rows.forEach(function (r) {
      html += "<tr><th>" + r + "</th>";
      opts.cols.forEach(function (c) {
        var key = r + "|" + c;
        var curVal = current[key];
        var hasCur = curVal !== undefined && curVal !== null && curVal !== "";
        var sug = opts.getSuggested(r, c);
        var hasSug = sug && sug.value !== null && sug.n >= CELL_MIN_SAMPLES;
        var needsChange = hasCur && hasSug && Math.abs(sug.value - curVal) > opts.tol;
        if (hasSug) withSuggestion++;
        if (needsChange) changes++;
        var tdClass = "grid-td" + (needsChange ? " grid-td--change" : "") + (!hasSug ? " grid-td--nodata" : "");
        var suggestHtml = "";
        if (hasSug) {
          // Always shows what the log computed for this cell — not just when it differs from
          // what's currently on the instrument — so the whole table is visible at a glance:
          // red "→ X" where a change is needed, muted "✓ X" / "log: X" everywhere else.
          if (needsChange) {
            suggestHtml = "<div class='grid-suggest grid-suggest--change'>→ " + fmt(sug.value, opts.decimals) + "</div>";
          } else if (hasCur) {
            suggestHtml = "<div class='grid-suggest grid-suggest--muted'>✓ " + fmt(sug.value, opts.decimals) + "</div>";
          } else {
            suggestHtml = "<div class='grid-suggest grid-suggest--muted'>log: " + fmt(sug.value, opts.decimals) + "</div>";
          }
        }
        html += "<td class='" + tdClass + "'>" +
          "<input type='number' step='any' inputmode='decimal' class='grid-input' " +
          "data-table='" + opts.table + "' data-r='" + r + "' data-c='" + c + "' " +
          "value='" + (hasCur ? curVal : "") + "'>" +
          suggestHtml +
          "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";

    var container = document.getElementById(opts.containerId);
    container.innerHTML = html;
    container.querySelectorAll(".grid-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var key = inp.dataset.r + "|" + inp.dataset.c;
        var v = inp.value.trim();
        setOnboardValue(opts.boat, opts.table, key, v === "" ? null : Number(v));
        renderCompareGrid(opts); // re-render this grid immediately so the highlight updates live
      });
    });

    var summaryEl = document.getElementById(opts.summaryId);
    if (withSuggestion === 0) {
      summaryEl.textContent = "No data yet from this log for this table.";
    } else if (changes === 0) {
      summaryEl.textContent = "No changes — current settings match the log.";
    } else {
      summaryEl.textContent = changes + " cell" + (changes === 1 ? "" : "s") + " need" + (changes === 1 ? "s" : "") + " updating (highlighted below).";
    }
  }

  function gridHtml(rows, cols, getVal, caption) {
    var html = "<p class='import-step__hint'>" + caption + "</p>";
    html += "<table class='compare-table grid-table'><thead><tr><th></th>";
    cols.forEach(function (c) { html += "<th>" + c + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr><th>" + r + "</th>";
      cols.forEach(function (c) {
        var v = getVal(r, c);
        html += "<td>" + (v === null || v === undefined || v === "" ? "—" : v) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  document.getElementById("detailToggle").addEventListener("click", function () {
    var body = document.getElementById("detailBody");
    var open = !body.classList.contains("is-hidden");
    body.classList.toggle("is-hidden", open);
    document.getElementById("detailToggle").textContent = open ? "Show detailed report ▾" : "Hide detailed report ▴";
  });

  document.getElementById("downloadCorrectionsBtn").addEventListener("click", function () {
    if (!lastResults) return;
    var lines = ["RC44 Wind Calibrator — " + lastResults.boat + " — " + new Date().toISOString()];
    lines.push("");
    lines.push("MHU / TWA correction, confidence," + lastResults.mhuLevel);
    if (lastResults.mhuLevel === "low") {
      lines.push("MHU / TWA correction, no change recommended (insufficient clean data)");
      lines.push("MHU / TWA correction, computed but not trusted," + fmt(lastResults.suggestedMhu, 2));
    } else {
      lines.push("MHU / TWA correction, suggested," + fmt(lastResults.suggestedMhu, 2));
    }
    if (lastResults.mhuReasons.length) lines.push("MHU / TWA notes," + lastResults.mhuReasons.join(" / ").replace(/,/g, ";"));
    lines.push("");
    lines.push("BSP vs Heel table (kn correction)");
    lines.push("bsp\\heel," + HEEL_BINS.join(","));
    lastResults.bspBins.forEach(function (r) {
      var row = [r];
      HEEL_BINS.forEach(function (c) { var v = lastResults.bspHeelTable[r + "|" + c]; row.push(v === undefined ? "" : v.toFixed(2)); });
      lines.push(row.join(","));
    });
    lines.push("");
    lines.push("Upwash angle table (deg correction, suggested)");
    lines.push("tws\\twa," + TWA_BINS.join(","));
    TWS_BINS.forEach(function (r) {
      var row = [r];
      TWA_BINS.forEach(function (c) { var e = lastResults.angleTable[r + "|" + c]; row.push(e && e.suggested !== null ? e.suggested.toFixed(1) : ""); });
      lines.push(row.join(","));
    });
    lines.push("");
    lines.push("Upwash speed table (kn correction, suggested)");
    lines.push("tws\\twa," + TWA_BINS.join(","));
    TWS_BINS.forEach(function (r) {
      var row = [r];
      TWA_BINS.forEach(function (c) { var e = lastResults.speedTable[r + "|" + c]; row.push(e && e.suggested !== null ? e.suggested.toFixed(2) : ""); });
      lines.push(row.join(","));
    });

    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "h5000-corrections-" + lastResults.boat + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  renderTideTable();
})();
