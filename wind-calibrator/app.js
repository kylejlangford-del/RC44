(function () {
  "use strict";

  // ---------- CSV parsing (B&G H5000 export: ISO-8859-1, comma-delimited, ~10Hz) ----------

  var COLS = {
    time: "Date/Time (UTC)",
    twd: "True Wind Direction °M",
    tws: "True Wind Speed m/s",
    twa: "True Wind Angle °",
    aws: "Apparent Wind Speed m/s",
    awa: "Apparent Wind Angle °",
    twaCorr: "TWA Correction °",
    twsCorr: "TWS Correction m/s",
    bspCorr: "Boat Speed Correction m/s",
    heel: "Heel °",
    heading: "Heading °M",
    bsp: "Boat Speed m/s",
    stw: "Speed Through Water m/s",
    sog: "Speed Over Ground m/s",
    rot: "Rate of Turn °/sec",
    mwa: "Measured Wind Angle °",
    mws: "Measured Wind Speed m/s",
    origTwa: "Orig TWA °",
    origTws: "Orig TWS m/s",
    corrMwa: "Corrected MWA °",
    corrMws: "Corrected MWS m/s",
    rudder: "Rudder Angle °"
  };

  var rows = []; // parsed numeric rows
  var header = [];
  var fileCount = 0;

  function parseCsvText(text) {
    var lines = text.split(/\r?\n/);
    if (!lines.length) return;
    var head = splitCsvLine(lines[0]);
    if (!header.length) header = head;
    var idx = {};
    Object.keys(COLS).forEach(function (key) {
      idx[key] = head.indexOf(COLS[key]);
    });
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
      if (row.twa !== null || row.tws !== null) rows.push(row);
    }
  }

  function splitCsvLine(line) {
    // No quoted fields with embedded commas in this export — plain split is safe and fast.
    return line.split(",");
  }

  function readFileAsLatin1(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var bytes = new Uint8Array(reader.result);
        var text = new TextDecoder("iso-8859-1").decode(bytes);
        resolve(text);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  var fileInput = document.getElementById("csvInput");
  var summaryEl = document.getElementById("csvSummary");
  var analyzeBtn = document.getElementById("analyzeBtn");

  fileInput.addEventListener("change", async function () {
    var files = Array.from(fileInput.files || []);
    if (!files.length) return;
    rows = [];
    header = [];
    fileCount = files.length;
    summaryEl.textContent = "Reading " + files.length + " file(s)…";
    summaryEl.classList.remove("is-hidden");
    for (var i = 0; i < files.length; i++) {
      var text = await readFileAsLatin1(files[i]);
      parseCsvText(text);
    }
    rows.sort(function (a, b) { return (a.timeRaw || "").localeCompare(b.timeRaw || ""); });
    summaryEl.textContent = files.length + " file(s) loaded · " + rows.length.toLocaleString() + " samples";
    analyzeBtn.disabled = rows.length === 0;
  });

  // ---------- Analysis ----------

  function mean(arr) {
    if (!arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function stdev(arr, m) {
    if (arr.length < 2) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / (arr.length - 1));
  }

  function angleMean(deg) {
    // circular mean, for headings/TWD that can wrap through 0/360
    if (!deg.length) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < deg.length; i++) {
      var r = deg[i] * Math.PI / 180;
      sx += Math.cos(r); sy += Math.sin(r);
    }
    var a = Math.atan2(sy / deg.length, sx / deg.length) * 180 / Math.PI;
    return a < 0 ? a + 360 : a;
  }

  function angleDiff(a, b) {
    var d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function runAnalysis() {
    var minBsp = parseFloat(document.getElementById("minBsp").value) || 0;
    var maxRot = parseFloat(document.getElementById("maxRot").value) || 999;
    var minTwa = parseFloat(document.getElementById("minTwa").value) || 0;
    var maxTwa = parseFloat(document.getElementById("maxTwa").value) || 180;

    var steady = rows.filter(function (r) {
      if (r.twa === null || r.bsp === null) return false;
      if (r.bsp < minBsp) return false;
      if (r.rot !== null && Math.abs(r.rot) > maxRot) return false;
      var a = Math.abs(r.twa);
      if (a < minTwa || a > maxTwa) return false;
      return true;
    });

    var port = steady.filter(function (r) { return r.twa < 0; });
    var stbd = steady.filter(function (r) { return r.twa >= 0; });

    var twdPort = angleMean(port.map(function (r) { return r.twd; }).filter(function (v) { return v !== null; }));
    var twdStbd = angleMean(stbd.map(function (r) { return r.twd; }).filter(function (v) { return v !== null; }));

    var results = {
      steadyCount: steady.length,
      portCount: port.length,
      stbdCount: stbd.length,
      twdPort: twdPort,
      twdStbd: twdStbd,
      twaOffset: null,
      twsPort: mean(port.map(function (r) { return r.tws; }).filter(function (v) { return v !== null; })),
      twsStbd: mean(stbd.map(function (r) { return r.tws; }).filter(function (v) { return v !== null; })),
      bspVsStw: null,
      bspVsSog: null,
      currentTwaCorr: mean(steady.map(function (r) { return r.twaCorr; }).filter(function (v) { return v !== null; })),
      currentTwsCorr: mean(steady.map(function (r) { return r.twsCorr; }).filter(function (v) { return v !== null; })),
      currentBspCorr: mean(steady.map(function (r) { return r.bspCorr; }).filter(function (v) { return v !== null; }))
    };

    if (twdPort !== null && twdStbd !== null) {
      // If the wind angle calibration is correct, TWD should read the same on both tacks
      // (same true wind, symmetric error cancels). Half the split is the angle correction needed.
      results.twaOffset = angleDiff(twdStbd, twdPort) / 2;
    }

    var bspVals = steady.map(function (r) { return r.bsp; }).filter(function (v) { return v !== null; });
    var stwVals = steady.map(function (r) { return r.stw; }).filter(function (v) { return v !== null; });
    var sogVals = steady.map(function (r) { return r.sog; }).filter(function (v) { return v !== null; });
    var bspMean = mean(bspVals), stwMean = mean(stwVals), sogMean = mean(sogVals);
    if (bspMean && stwMean) results.bspVsStw = bspMean - stwMean;
    if (bspMean && sogMean) results.bspVsSog = bspMean - sogMean;

    renderResults(results, steady.length);
  }

  function fmt(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return v.toFixed(d === undefined ? 2 : d);
  }

  function renderResults(res, n) {
    var out = document.getElementById("resultsPanel");
    out.classList.remove("is-hidden");

    document.getElementById("sampleCounts").textContent =
      n.toLocaleString() + " steady-state samples used (" + res.portCount.toLocaleString() +
      " port tack, " + res.stbdCount.toLocaleString() + " starboard tack)";

    var rowsHtml = "";
    rowsHtml += correctionRow(
      "TWA correction (wind angle offset)",
      fmt(res.currentTwaCorr, 2) + "°",
      res.twaOffset === null ? "—" : (res.twaOffset >= 0 ? "+" : "") + fmt(res.twaOffset, 2) + "°",
      "Port-tack TWD averaged " + fmt(res.twdPort, 1) + "°M, starboard " + fmt(res.twdStbd, 1) +
      "°M. If the sensor were perfectly calibrated these would match — half the gap is the angle correction to add to the H5000 wind-angle table."
    );
    rowsHtml += correctionRow(
      "TWS (wind speed) sanity check",
      fmt(res.currentTwsCorr, 2) + " m/s",
      "—",
      "Port-tack mean TWS " + fmt(res.twsPort, 2) + " m/s vs starboard " + fmt(res.twsStbd, 2) +
      " m/s. TWS calibration needs an independent reference (calibrated shore/buoy anemometer or a synced boat) — this log alone can flag a port/starboard split but not a true offset."
    );
    rowsHtml += correctionRow(
      "Boat speed vs speed-through-water",
      fmt(res.currentBspCorr, 3) + " m/s",
      res.bspVsStw === null ? "—" : (res.bspVsStw >= 0 ? "+" : "") + fmt(res.bspVsStw, 3) + " m/s",
      "Average Boat Speed (calibrated) minus Speed Through Water (paddle wheel) across the steady-state sample. A consistent non-zero gap suggests the boat-speed calibration factor needs adjusting by roughly this amount."
    );
    rowsHtml += correctionRow(
      "Boat speed vs speed-over-ground",
      "—",
      res.bspVsSog === null ? "—" : (res.bspVsSog >= 0 ? "+" : "") + fmt(res.bspVsSog, 3) + " m/s",
      "Same comparison against GPS SOG — only meaningful with negligible current/tide during the sample, shown for cross-checking against the STW comparison above."
    );

    document.getElementById("correctionsBody").innerHTML = rowsHtml;
  }

  function correctionRow(label, current, suggested, note) {
    return "<tr>" +
      "<td>" + label + "</td>" +
      "<td>" + current + "</td>" +
      "<td><input type=\"text\" class=\"correction-input\" value=\"" + (suggested === "—" ? "" : suggested) + "\"></td>" +
      "<td class=\"correction-note\">" + note + "</td>" +
      "</tr>";
  }

  analyzeBtn.addEventListener("click", runAnalysis);

  document.getElementById("downloadCorrectionsBtn").addEventListener("click", function () {
    var inputs = document.querySelectorAll(".correction-input");
    var labels = document.querySelectorAll("#correctionsBody tr td:first-child");
    var lines = ["Parameter,Suggested correction"];
    inputs.forEach(function (inp, i) {
      lines.push('"' + labels[i].textContent + '","' + inp.value.replace(/"/g, '""') + '"');
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "h5000-corrections-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
