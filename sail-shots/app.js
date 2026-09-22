(function () {
  "use strict";

  var STORAGE_KEY = "rc44-sail-shots-v2";
  var scans = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) scans = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  // Migrate anything saved under the old v1 key/shape once, so existing local edits aren't lost.
  if (!localStorage.getItem(STORAGE_KEY)) {
    try {
      var oldRaw = localStorage.getItem("rc44-sail-shots-v1");
      if (oldRaw) {
        var oldScans = JSON.parse(oldRaw);
        oldScans.forEach(function (s) {
          s.event = s.event || "";
          s.tack = s.tack || "";
          s.mechanic = s.mechanic || {};
          s.mechanic.mastSetup = s.mechanic.mastSetup !== undefined ? s.mechanic.mastSetup : null;
          s.mechanic.mainSheetMark = s.mechanic.mainSheetMark !== undefined ? s.mechanic.mainSheetMark : null;
          s.mechanic.chockSize = s.mechanic.chockSize !== undefined ? s.mechanic.chockSize : null;
          s.mast = s.mast || null;
        });
        scans = oldScans;
      }
    } catch (e) { /* ignore */ }
  }

  var selected = { artemis: null, gemera: null };
  var dirty = false;
  var sailFilter = ""; // "" = all sails; else "Main" | "G1" | "J2" | "J3"

  // Existing scans predate the Main/G1/J2/J3 split — they're all mainsail battens, so tag
  // anything without a sail code as "Main" rather than losing them from the filter.
  scans.forEach(function (s) { if (!s.sail) s.sail = "Main"; });

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scans)); } catch (e) { /* ignore */ }
    dirty = true;
    document.getElementById("changesBar").classList.toggle("is-hidden", !dirty);
  }

  function findScan(id) { return scans.filter(function (s) { return s.id === id; })[0] || null; }

  function dateOf(scan) {
    var d = new Date(scan.time);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  // ---------- Filters ----------

  function distinctValues(getter) {
    var seen = {};
    var out = [];
    scans.forEach(function (s) {
      var v = getter(s);
      if (v === null || v === undefined || v === "") return;
      var key = String(v);
      if (!seen[key]) { seen[key] = true; out.push(v); }
    });
    out.sort(function (a, b) {
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b));
    });
    return out;
  }

  function populateDropdown(id, values, formatFn) {
    var sel = document.getElementById(id);
    var current = sel.value;
    sel.innerHTML = "<option value=''>Any</option>";
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = formatFn ? formatFn(v) : String(v);
      sel.appendChild(opt);
    });
    if (values.some(function (v) { return String(v) === current; })) sel.value = current;
  }

  function refreshFilterOptions() {
    populateDropdown("fEvent", distinctValues(function (s) { return s.event; }));
    populateDropdown("fDate", distinctValues(dateOf));
    populateDropdown("fBsp", distinctValues(function (s) { return s.boat_ && s.boat_.bsp; }), function (v) { return v + " kn"; });
    populateDropdown("fChock", distinctValues(function (s) { return s.mechanic && s.mechanic.chockSize; }));
    populateDropdown("fMastSetup", distinctValues(function (s) { return s.mechanic && s.mechanic.mastSetup; }));
    populateDropdown("fTrimtab", distinctValues(function (s) { return s.mechanic && s.mechanic.trimtab; }));
    populateDropdown("fRake", distinctValues(function (s) { return s.mechanic && s.mechanic.rake; }));

    var twsVals = distinctValues(function (s) { return s.wind && s.wind.tws; });
    var twsMin = twsVals.length ? Math.floor(Math.min.apply(null, twsVals)) : 0;
    var twsMax = twsVals.length ? Math.ceil(Math.max.apply(null, twsVals)) : 30;
    if (twsMax <= twsMin) twsMax = twsMin + 1;
    var loEl = document.getElementById("fTwsLo"), hiEl = document.getElementById("fTwsHi");
    [loEl, hiEl].forEach(function (el) { el.min = twsMin; el.max = twsMax; });
    if (loEl.value === "" || Number(loEl.value) < twsMin) loEl.value = twsMin;
    if (hiEl.value === "" || Number(hiEl.value) > twsMax) hiEl.value = twsMax;
    updateTwsLabel();
  }

  function updateTwsLabel() {
    document.getElementById("fTwsLabel").textContent =
      document.getElementById("fTwsLo").value + " – " + document.getElementById("fTwsHi").value + " kn";
  }

  function passesFilter(scan) {
    var event = document.getElementById("fEvent").value;
    var date = document.getElementById("fDate").value;
    var bsp = document.getElementById("fBsp").value;
    var chock = document.getElementById("fChock").value;
    var mastSetup = document.getElementById("fMastSetup").value;
    var trimtab = document.getElementById("fTrimtab").value;
    var rake = document.getElementById("fRake").value;
    var twsLo = Number(document.getElementById("fTwsLo").value);
    var twsHi = Number(document.getElementById("fTwsHi").value);

    if (event && scan.event !== event) return false;
    if (date && dateOf(scan) !== date) return false;
    if (bsp && String(scan.boat_ && scan.boat_.bsp) !== bsp) return false;
    if (chock && String(scan.mechanic && scan.mechanic.chockSize) !== chock) return false;
    if (mastSetup && String(scan.mechanic && scan.mechanic.mastSetup) !== mastSetup) return false;
    if (trimtab && String(scan.mechanic && scan.mechanic.trimtab) !== trimtab) return false;
    if (rake && String(scan.mechanic && scan.mechanic.rake) !== rake) return false;
    if (sailFilter && (scan.sail || "Main") !== sailFilter) return false;

    var tws = scan.wind ? scan.wind.tws : null;
    if (tws !== null && tws !== undefined && (tws < twsLo || tws > twsHi)) return false;

    return true;
  }

  document.querySelectorAll("#sailToggle .view-toggle__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sailFilter = btn.dataset.sail;
      document.querySelectorAll("#sailToggle .view-toggle__btn").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      renderAll();
    });
  });

  ["fEvent", "fDate", "fBsp", "fChock", "fMastSetup", "fTrimtab", "fRake"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", renderAll);
  });
  ["fTwsLo", "fTwsHi"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function () {
      // keep the two handles from crossing
      var lo = document.getElementById("fTwsLo"), hi = document.getElementById("fTwsHi");
      if (Number(lo.value) > Number(hi.value)) {
        if (id === "fTwsLo") lo.value = hi.value; else hi.value = lo.value;
      }
      updateTwsLabel();
      renderAll();
    });
  });
  document.getElementById("resetFiltersBtn").addEventListener("click", function () {
    ["fEvent", "fDate", "fBsp", "fChock", "fMastSetup", "fTrimtab", "fRake"].forEach(function (id) {
      document.getElementById(id).value = "";
    });
    sailFilter = "";
    document.querySelectorAll("#sailToggle .view-toggle__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.sail === "");
    });
    refreshFilterOptions();
    renderAll();
  });

  // ---------- Catalog (thumbnail picker) ----------

  function scanCaption(scan) {
    var d = new Date(scan.time);
    var when = isNaN(d.getTime()) ? scan.time : d.toISOString().slice(0, 16).replace("T", " ");
    var bits = [when];
    if (scan.sail) bits.push(scan.sail);
    if (scan.wind && scan.wind.tws !== undefined && scan.wind.tws !== null) bits.push(scan.wind.tws + "kn TWS");
    if (scan.battenLabel) bits.push(scan.battenLabel);
    return bits.join(" · ");
  }

  function renderCatalog(boat) {
    var grid = document.getElementById("catalog-" + boat);
    grid.innerHTML = "";
    var matches = scans.filter(function (s) { return s.boat === boat && passesFilter(s); });
    matches.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });

    if (!matches.length) {
      grid.innerHTML = "<div class='scan-stage__empty' style='padding:24px;'>No scans match the current filters.</div>";
      return;
    }

    if (!selected[boat] || !matches.some(function (s) { return s.id === selected[boat]; })) {
      selected[boat] = matches[0].id;
    }

    matches.forEach(function (s) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "thumb" + (s.id === selected[boat] ? " thumb--active" : "");
      card.innerHTML = "<img src='" + s.file + "' alt=''><span>" + scanCaption(s) + "</span>";
      card.addEventListener("click", function () {
        selected[boat] = s.id;
        renderCatalog(boat);
        renderStage(boat);
        renderOverlay();
        renderMetricCharts();
      });
      grid.appendChild(card);
    });
  }

  // ---------- Stage (single-scan view + data) ----------

  function cell(label, value) {
    return "<div class='scan-data__cell'><span>" + label + "</span><strong>" + value + "</strong></div>";
  }

  function renderStage(boat) {
    var scan = selected[boat] ? findScan(selected[boat]) : null;
    var stage = document.getElementById("stage-" + boat);
    var dataBox = document.getElementById("data-" + boat);
    var calBtn = document.getElementById("calBtn-" + boat);

    if (!scan) {
      stage.innerHTML = "<div class='scan-stage__empty'>No scan selected.</div>";
      dataBox.innerHTML = "";
      calBtn.classList.add("is-hidden");
      return;
    }

    calBtn.classList.remove("is-hidden");
    calBtn.onclick = function () { openMastCalibrator(scan.id); };

    stage.innerHTML = "<img src='" + scan.file + "' alt='" + boat + " sail scan'>";

    var m = scan.mechanic || {};
    var cells = [];
    cells.push(cell("Event", scan.event || "—"));
    cells.push(cell("Time", scan.time ? scan.time.replace("T", " ") : "—"));
    cells.push(cell("Batten", scan.battenLabel || "—"));
    cells.push(cell("Tack", scan.tack || "—"));
    cells.push(cell("TWS", scan.wind && scan.wind.tws !== undefined ? scan.wind.tws + " kn" : "—"));
    cells.push(cell("TWA", scan.wind && scan.wind.twa !== undefined ? scan.wind.twa + "°" : "—"));
    cells.push(cell("BSP", scan.boat_ && scan.boat_.bsp !== undefined ? scan.boat_.bsp + " kn" : "—"));
    cells.push(cell("Forestay", m.forestay !== undefined && m.forestay !== null ? m.forestay : "—"));
    cells.push(cell("Rake", m.rake !== undefined && m.rake !== null ? m.rake : "—"));
    cells.push(cell("Trim tab", m.trimtab !== undefined && m.trimtab !== null ? m.trimtab : "—"));
    cells.push(cell("Mast setup", m.mastSetup !== undefined && m.mastSetup !== null ? m.mastSetup : "—"));
    cells.push(cell("Main sheet mark", m.mainSheetMark !== undefined && m.mainSheetMark !== null ? m.mainSheetMark : "—"));
    cells.push(cell("Chock size", m.chockSize || "—"));
    cells.push(cell("Mast aligned", scan.mast ? "Yes" : "Not set"));

    var html = "<div class='scan-data'>" + cells.join("") + "</div>";

    if (scan.camber && scan.camber.length) {
      html += "<table class='compare-table' style='margin-top:14px;'><thead><tr>" +
        "<th>Height</th><th>Camber</th><th>Draft</th><th>Twist</th><th>Entry</th><th>Exit</th><th>Fore cam</th><th>Back cam</th>" +
        "</tr></thead><tbody>";
      scan.camber.forEach(function (row) {
        html += "<tr><td>" + row.height + "</td><td>" + row.camber + "</td><td>" + row.draft + "</td><td>" +
          row.twist + "</td><td>" + row.entry + "</td><td>" + row.exit + "</td><td>" + row.foreCam + "</td><td>" + row.backCam + "</td></tr>";
      });
      html += "</tbody></table>";
    }

    dataBox.innerHTML = html;
  }

  // ---------- Overlay, mast-aligned ----------

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function renderOverlay() {
    var a = selected.artemis ? findScan(selected.artemis) : null;
    var g = selected.gemera ? findScan(selected.gemera) : null;
    var wrap = document.getElementById("overlayStage");
    var note = document.getElementById("overlayNote");

    if (!a || !g) {
      wrap.innerHTML = "<div class='scan-stage__empty'>Select a scan for both boats to overlay them.</div>";
      note.textContent = "";
      return;
    }

    wrap.innerHTML = "";
    var stageW = wrap.clientWidth || 640;
    var stageH = 480;
    wrap.style.height = stageH + "px";

    Promise.all([loadImage(g.file), loadImage(a.file)]).then(function (imgs) {
      var gImg = imgs[0], aImg = imgs[1];

      // Base (Gemera) — object-fit: contain, computed by hand so we know its exact pixel rect.
      var scale = Math.min(stageW / gImg.naturalWidth, stageH / gImg.naturalHeight);
      var renderedW = gImg.naturalWidth * scale, renderedH = gImg.naturalHeight * scale;
      var offsetX = (stageW - renderedW) / 2, offsetY = (stageH - renderedH) / 2;

      var baseEl = document.createElement("img");
      baseEl.src = g.file;
      baseEl.style.cssText = "position:absolute; left:" + offsetX + "px; top:" + offsetY + "px; width:" + renderedW + "px; height:" + renderedH + "px;";
      wrap.appendChild(baseEl);

      var overlayEl = document.createElement("img");
      overlayEl.src = a.file;
      overlayEl.style.cssText = "position:absolute; left:0; top:0; width:" + aImg.naturalWidth + "px; height:" + aImg.naturalHeight + "px; transform-origin:0 0;";
      var opacity = document.getElementById("overlayOpacity").value / 100;
      overlayEl.style.opacity = opacity;
      wrap.appendChild(overlayEl);

      if (g.mast && a.mast) {
        // Base mast points, in stage pixel space.
        var q1 = { x: offsetX + g.mast.x1 * renderedW, y: offsetY + g.mast.y1 * renderedH };
        var q2 = { x: offsetX + g.mast.x2 * renderedW, y: offsetY + g.mast.y2 * renderedH };
        // Overlay mast points, in the overlay image's own natural pixel space.
        var p1 = { x: a.mast.x1 * aImg.naturalWidth, y: a.mast.y1 * aImg.naturalHeight };
        var p2 = { x: a.mast.x2 * aImg.naturalWidth, y: a.mast.y2 * aImg.naturalHeight };

        var pDx = p2.x - p1.x, pDy = p2.y - p1.y;
        var qDx = q2.x - q1.x, qDy = q2.y - q1.y;
        var pLen = Math.sqrt(pDx * pDx + pDy * pDy) || 1;
        var qLen = Math.sqrt(qDx * qDx + qDy * qDy) || 1;
        var s = qLen / pLen;
        var theta = Math.atan2(qDy, qDx) - Math.atan2(pDy, pDx);
        var cosT = Math.cos(theta), sinT = Math.sin(theta);
        var tx = q1.x - s * (p1.x * cosT - p1.y * sinT);
        var ty = q1.y - s * (p1.x * sinT + p1.y * cosT);

        overlayEl.style.transform = "translate(" + tx + "px," + ty + "px) rotate(" + (theta * 180 / Math.PI) + "deg) scale(" + s + ")";
        note.textContent = "Aligned on the mast — both scans are mast-calibrated.";
        note.classList.remove("pill--warn");
      } else {
        // No calibration on one or both — best-effort contain-fit, uncorrected.
        var oScale = Math.min(stageW / aImg.naturalWidth, stageH / aImg.naturalHeight);
        overlayEl.style.transform = "translate(" + ((stageW - aImg.naturalWidth * oScale) / 2) + "px," +
          ((stageH - aImg.naturalHeight * oScale) / 2) + "px) scale(" + oScale + ")";
        note.textContent = "Not aligned — set mast alignment on " +
          (!g.mast && !a.mast ? "both scans" : (!g.mast ? "the Gemera scan" : "the Artemis scan")) +
          " for an accurate overlay.";
        note.classList.add("pill--warn");
      }
    });
  }

  document.getElementById("overlayOpacity").addEventListener("input", renderOverlay);
  window.addEventListener("resize", renderOverlay);

  // ---------- Camber / draft / twist mini charts ----------
  // Small hand-rolled SVG line+area charts (no charting library) — one per metric, each boat's
  // selected scan plotted as its own coloured line/fill, on the shared 25/50/75/87% height axis.

  var METRIC_CHARTS = [
    { id: "chart-camber", key: "camber", title: "Camber" },
    { id: "chart-draft", key: "draft", title: "Draft" },
    { id: "chart-twist", key: "twist", title: "Twist" }
  ];
  var BOAT_COLOR = { artemis: "var(--artemis)", gemera: "var(--gemera)" };
  var BOAT_LABEL = { artemis: "Artemis", gemera: "Gemera" };

  function buildMetricChartSvg(seriesList, metricKey) {
    var W = 320, H = 160, padL = 30, padR = 10, padT = 10, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var heights = [];
    var values = [];
    seriesList.forEach(function (s) {
      s.points.forEach(function (p) {
        if (heights.indexOf(p.h) === -1) heights.push(p.h);
        values.push(p.v);
      });
    });
    heights.sort(function (a, b) { return a - b; });
    if (!heights.length || !values.length) return null;

    var hMin = heights[0], hMax = heights[heights.length - 1];
    if (hMax === hMin) hMax = hMin + 1;
    var vMin = Math.min.apply(null, values), vMax = Math.max.apply(null, values);
    var vPad = (vMax - vMin) * 0.15 || Math.abs(vMax || 1) * 0.15 || 1;
    vMin -= vPad; vMax += vPad;

    function x(h) { return padL + (h - hMin) / (hMax - hMin) * plotW; }
    function y(v) { return padT + (1 - (v - vMin) / (vMax - vMin)) * plotH; }

    var svg = "<svg width='" + W + "' height='" + H + "' viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet'>";

    // Gridlines + axis labels (height %).
    heights.forEach(function (h) {
      var gx = x(h);
      svg += "<line class='mchart-axis' x1='" + gx + "' y1='" + padT + "' x2='" + gx + "' y2='" + (padT + plotH) + "'/>";
      svg += "<text class='mchart-axis-label' x='" + gx + "' y='" + (H - 6) + "' text-anchor='middle'>" + h + "%</text>";
    });
    svg += "<line class='mchart-axis' x1='" + padL + "' y1='" + (padT + plotH) + "' x2='" + (padL + plotW) + "' y2='" + (padT + plotH) + "'/>";

    seriesList.forEach(function (s) {
      var pts = s.points.slice().sort(function (a, b) { return a.h - b.h; });
      if (!pts.length) return;
      var linePath = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + x(p.h) + "," + y(p.v); }).join(" ");
      var areaPath = "M" + x(pts[0].h) + "," + (padT + plotH) + " " +
        pts.map(function (p) { return "L" + x(p.h) + "," + y(p.v); }).join(" ") +
        " L" + x(pts[pts.length - 1].h) + "," + (padT + plotH) + " Z";
      svg += "<path d='" + areaPath + "' fill='" + s.color + "' opacity='0.12'/>";
      svg += "<path d='" + linePath + "' fill='none' stroke='" + s.color + "' stroke-width='2'/>";
      pts.forEach(function (p) {
        svg += "<circle cx='" + x(p.h) + "' cy='" + y(p.v) + "' r='2.5' fill='" + s.color + "'/>";
      });
    });

    svg += "</svg>";
    return svg;
  }

  function renderMetricCharts() {
    var boatsWithScan = ["artemis", "gemera"].map(function (boat) {
      var scan = selected[boat] ? findScan(selected[boat]) : null;
      return { boat: boat, scan: scan };
    }).filter(function (b) { return b.scan && b.scan.camber && b.scan.camber.length; });

    METRIC_CHARTS.forEach(function (mc) {
      var container = document.getElementById(mc.id);
      container.innerHTML = "";

      if (!boatsWithScan.length) {
        container.innerHTML = "<div class='metric-chart__title'>" + mc.title + "</div>" +
          "<div class='mchart-empty'>Select a scan to see " + mc.title.toLowerCase() + ".</div>";
        return;
      }

      var seriesList = boatsWithScan.map(function (b) {
        return {
          label: BOAT_LABEL[b.boat],
          color: BOAT_COLOR[b.boat],
          points: b.scan.camber
            .filter(function (row) { return row[mc.key] !== null && row[mc.key] !== undefined; })
            .map(function (row) { return { h: row.height, v: row[mc.key] }; })
        };
      });

      var legend = "<div class='metric-chart__legend'>" + seriesList.map(function (s) {
        return "<span><i style='background:" + s.color + ";'></i>" + s.label + "</span>";
      }).join("") + "</div>";

      var svg = buildMetricChartSvg(seriesList, mc.key);
      container.innerHTML = "<div class='metric-chart__title'>" + mc.title + "</div>" + legend +
        (svg || "<div class='mchart-empty'>No camber-table data on the selected scan(s).</div>");
    });
  }

  function renderAll() {
    refreshFilterOptions();
    ["artemis", "gemera"].forEach(function (boat) {
      renderCatalog(boat);
      renderStage(boat);
    });
    renderOverlay();
    renderMetricCharts();
  }

  // ---------- Mast calibration dialog ----------

  var cal = { points: [], imgEl: null, scanId: null, onSave: null };

  function openMastCalibrator(scanId, imageSrcOverride, onSaveOverride) {
    var scan = scanId ? findScan(scanId) : null;
    var src = imageSrcOverride || (scan ? scan.file : null);
    if (!src) return;

    cal.points = [];
    cal.scanId = scanId;
    cal.onSave = onSaveOverride || null;

    var existing = scan ? scan.mast : null;

    var dlg = document.getElementById("calDialog");
    dlg.classList.remove("is-hidden");
    var stage = document.getElementById("calStage");
    stage.innerHTML = "";

    var img = document.createElement("img");
    img.src = src;
    img.className = "cal-image";
    stage.appendChild(img);

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "cal-svg");
    stage.appendChild(svg);
    cal.svg = svg;
    cal.imgEl = img;

    document.getElementById("calHint").textContent = "Click the top of the mast, then click the base (gooseneck).";
    document.getElementById("calSaveBtn").disabled = true;

    if (existing) {
      cal.points = [
        { xf: existing.x1, yf: existing.y1 },
        { xf: existing.x2, yf: existing.y2 }
      ];
      img.addEventListener("load", drawCalPoints, { once: true });
      document.getElementById("calSaveBtn").disabled = false;
      document.getElementById("calHint").textContent = "Existing alignment shown — click to start over, or Save to keep it.";
    }

    stage.onclick = function (e) {
      if (cal.points.length >= 2) cal.points = [];
      var rect = img.getBoundingClientRect();
      var xf = (e.clientX - rect.left) / rect.width;
      var yf = (e.clientY - rect.top) / rect.height;
      cal.points.push({ xf: xf, yf: yf });
      drawCalPoints();
      document.getElementById("calHint").textContent = cal.points.length === 1
        ? "Now click the base of the mast (gooseneck)."
        : "Two points set. Click again to redo, or Save.";
      document.getElementById("calSaveBtn").disabled = cal.points.length < 2;
    };
  }

  function drawCalPoints() {
    var svg = cal.svg, img = cal.imgEl;
    var w = img.clientWidth, h = img.clientHeight;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    if (cal.points.length === 2) {
      var p1 = cal.points[0], p2 = cal.points[1];
      var line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", p1.xf * w); line.setAttribute("y1", p1.yf * h);
      line.setAttribute("x2", p2.xf * w); line.setAttribute("y2", p2.yf * h);
      line.setAttribute("class", "cal-line");
      svg.appendChild(line);
    }
    cal.points.forEach(function (p, i) {
      var c = document.createElementNS(svg.namespaceURI, "circle");
      c.setAttribute("cx", p.xf * w); c.setAttribute("cy", p.yf * h);
      c.setAttribute("r", 8);
      c.setAttribute("class", "cal-point");
      svg.appendChild(c);
      var t = document.createElementNS(svg.namespaceURI, "text");
      t.setAttribute("x", p.xf * w + 12); t.setAttribute("y", p.yf * h - 10);
      t.setAttribute("class", "cal-label");
      t.textContent = i === 0 ? "Top" : "Base";
      svg.appendChild(t);
    });
  }

  document.getElementById("calClose").addEventListener("click", function () {
    document.getElementById("calDialog").classList.add("is-hidden");
  });
  document.getElementById("calClearBtn").addEventListener("click", function () {
    cal.points = [];
    drawCalPoints();
    document.getElementById("calSaveBtn").disabled = true;
    document.getElementById("calHint").textContent = "Click the top of the mast, then click the base (gooseneck).";
  });
  document.getElementById("calSaveBtn").addEventListener("click", function () {
    if (cal.points.length !== 2) return;
    var mast = { x1: cal.points[0].xf, y1: cal.points[0].yf, x2: cal.points[1].xf, y2: cal.points[1].yf };
    if (cal.onSave) {
      cal.onSave(mast);
    } else if (cal.scanId) {
      var scan = findScan(cal.scanId);
      if (scan) { scan.mast = mast; persist(); renderStage(scan.boat); renderOverlay(); }
    }
    document.getElementById("calDialog").classList.add("is-hidden");
  });

  // ---------- Add scan ----------

  var addForm = document.getElementById("addScanForm");
  var photoDataUrl = null;
  var pendingMast = null;

  document.getElementById("addPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    pendingMast = null;
    document.getElementById("addMastStatus").textContent = "Not set";
    var reader = new FileReader();
    reader.onload = function () {
      photoDataUrl = reader.result;
      document.getElementById("addMastBtn").disabled = false;
      scanPhotoForData(photoDataUrl);
    };
    reader.readAsDataURL(file);
  });

  // ---------- Auto-fill from the on-photo data overlay (OCR) ----------
  // The rig-cam photos have TIME/TWS/TWA/BSP/Forestay/MainSheetMark/MastSetUp/tack/batten-label
  // and the camber table burned into the image itself as plain computer-rendered text. We read
  // that text with Tesseract.js (loaded from a CDN, client-side only) and fill in whatever it
  // finds. Nothing here is authoritative — it's a first pass the sailor checks and corrects;
  // fields the overlay doesn't carry (Event, Chock size, Rake) and the boat always stay manual.
  function setOcrStatus(text, isError) {
    var el = document.getElementById("ocrStatus");
    el.textContent = text;
    el.classList.toggle("is-hidden", !text);
    el.style.color = isError ? "#ffcaa0" : "";
  }

  function fillIfEmpty(id, value) {
    if (value === null || value === undefined || value === "") return;
    var el = document.getElementById(id);
    if (el.value !== "") return; // don't clobber something the sailor already typed
    el.value = value;
  }

  function ocrNum(text, label) {
    var re = new RegExp(label.replace(/\s+/g, "\\s*") + "\\s*:?\\s*(-?\\d+(?:\\.\\d+)?)", "i");
    var m = text.match(re);
    return m ? m[1] : null;
  }

  function parseOcrText(text) {
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var result = {};

    var timeMatch = text.match(/TIME\s*:?\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/i);
    if (timeMatch) result.time = timeMatch[1] + "T" + timeMatch[2] + ":" + timeMatch[3];

    result.tws = ocrNum(text, "TWS");
    result.twa = ocrNum(text, "TWA");
    result.bsp = ocrNum(text, "BSP");
    result.forestay = ocrNum(text, "Forestay");
    result.mainSheetMark = ocrNum(text, "Main\\s*Sheet\\s*Mark");
    result.mastSetup = ocrNum(text, "Mast\\s*Set\\s*Up");

    var tackMatch = text.match(/\b(STBD|PORT)\b/i);
    if (tackMatch) result.tack = tackMatch[1].toUpperCase();

    // The batten/mainsail line, e.g. "M-12 - ___" or "Mn2 RedBattens 26mm Chock" — grab the
    // line that starts with a sail token like M-12 / M12 / MN1 / MN2.
    var battenLine = lines.filter(function (l) { return /^M\s*[-\s]?\d/i.test(l); })[0];
    if (battenLine) result.battenLabel = battenLine.replace(/[-_]+$/, "").trim();

    // Camber table rows: any line with 7+ whitespace-separated numeric-looking tokens.
    var camberRows = [];
    lines.forEach(function (l) {
      var tokens = l.split(/\s+/).filter(function (t) { return /^-?\d+(?:\.\d+)?$/.test(t); });
      if (tokens.length >= 8) camberRows.push(tokens.slice(0, 8).map(Number));
    });
    if (camberRows.length) result.camber = camberRows;

    return result;
  }

  function scanPhotoForData(dataUrl) {
    if (typeof Tesseract === "undefined") {
      setOcrStatus("Couldn't load the photo-scanning engine (no network?) — enter the numbers manually.", true);
      return;
    }
    setOcrStatus("Scanning photo for data… (first scan on this device downloads the OCR engine, ~10s)");
    Tesseract.recognize(dataUrl, "eng")
      .then(function (result) {
        var parsed = parseOcrText(result.data.text || "");
        var filledAny = false;

        if (parsed.time) { fillIfEmpty("addTime", parsed.time); filledAny = true; }
        if (parsed.tack) { document.getElementById("addTack").value = parsed.tack; filledAny = true; }
        if (parsed.battenLabel) { fillIfEmpty("addBatten", parsed.battenLabel); filledAny = true; }
        ["tws", "twa", "bsp", "forestay", "mainSheetMark", "mastSetup"].forEach(function (k) {
          if (parsed[k] === null) return;
          var idMap = { tws: "addTws", twa: "addTwa", bsp: "addBsp", forestay: "addForestay", mainSheetMark: "addMainSheetMark", mastSetup: "addMastSetup" };
          fillIfEmpty(idMap[k], parsed[k]);
          filledAny = true;
        });
        if (parsed.camber && parsed.camber.length) {
          var rows = document.querySelectorAll("#camberRows tr");
          parsed.camber.slice(0, rows.length).forEach(function (rowVals, i) {
            var inputs = rows[i].querySelectorAll("input");
            rowVals.forEach(function (v, j) { if (inputs[j] && inputs[j].value === "") inputs[j].value = v; });
          });
          filledAny = true;
        }

        setOcrStatus(filledAny
          ? "Auto-filled from the photo — check the numbers before saving (OCR can misread digits)."
          : "Couldn't find the usual data overlay on this photo — enter the numbers manually.", !filledAny);
      })
      .catch(function (err) {
        console.error("OCR failed", err);
        setOcrStatus("Couldn't scan this photo — enter the numbers manually.", true);
      });
  }

  document.getElementById("addMastBtn").addEventListener("click", function () {
    if (!photoDataUrl) return;
    openMastCalibrator(null, photoDataUrl, function (mast) {
      pendingMast = mast;
      document.getElementById("addMastStatus").textContent = "Set";
    });
  });

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!photoDataUrl) { alert("Choose a photo first."); return; }

    var camber = [];
    document.querySelectorAll("#camberRows tr").forEach(function (tr) {
      var inputs = tr.querySelectorAll("input");
      if (inputs[0].value === "") return;
      camber.push({
        height: Number(inputs[0].value), camber: Number(inputs[1].value), draft: Number(inputs[2].value),
        twist: Number(inputs[3].value), entry: Number(inputs[4].value), exit: Number(inputs[5].value),
        foreCam: Number(inputs[6].value), backCam: Number(inputs[7].value)
      });
    });

    var scan = {
      id: document.getElementById("addBoat").value + "-" + Date.now().toString(36),
      boat: document.getElementById("addBoat").value,
      sail: document.getElementById("addSail").value,
      event: document.getElementById("addEvent").value.trim(),
      file: photoDataUrl,
      time: document.getElementById("addTime").value,
      tack: document.getElementById("addTack").value,
      battenLabel: document.getElementById("addBatten").value,
      wind: { tws: numOrNull("addTws"), twa: numOrNull("addTwa") },
      boat_: { bsp: numOrNull("addBsp") },
      mechanic: {
        forestay: numOrNull("addForestay"), rake: numOrNull("addRake"), trimtab: numOrNull("addTrimtab"),
        mastSetup: numOrNull("addMastSetup"), mainSheetMark: numOrNull("addMainSheetMark"),
        chockSize: document.getElementById("addChock").value.trim() || null
      },
      mast: pendingMast,
      camber: camber
    };
    scans.push(scan);
    persist();
    renderAll();
    addForm.reset();
    photoDataUrl = null;
    pendingMast = null;
    document.getElementById("addMastStatus").textContent = "Not set";
    document.getElementById("addMastBtn").disabled = true;
    document.getElementById("addScanDialog").classList.add("is-hidden");
  });

  function numOrNull(id) {
    var v = document.getElementById(id).value;
    return v === "" ? null : Number(v);
  }

  document.getElementById("addScanBtn").addEventListener("click", function () {
    document.getElementById("addScanDialog").classList.remove("is-hidden");
  });
  document.getElementById("addScanClose").addEventListener("click", function () {
    document.getElementById("addScanDialog").classList.add("is-hidden");
  });

  // ---------- Save / export ----------

  document.getElementById("downloadDataBtn").addEventListener("click", function () {
    var out = scans.map(function (s) {
      var copy = JSON.parse(JSON.stringify(s));
      if (copy.file && copy.file.indexOf("data:") === 0) copy.file = "REPLACE_WITH_FILE_PATH__see_console";
      return copy;
    });
    var text = "/* RC44 Sail Shots — scan library. Edited via the Sail Shots page. */\n" +
      "window.SAIL_SHOTS = " + JSON.stringify(out, null, 2) + ";\n";
    var blob = new Blob([text], { type: "text/javascript" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "data.js";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    scans.forEach(function (s) {
      if (s.file && s.file.indexOf("data:") === 0) {
        console.log("Photo still needs saving as a file for scan " + s.id + ":", s.file.slice(0, 60) + "…");
      }
    });
  });

  document.getElementById("discardChangesBtn").addEventListener("click", function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    scans = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
    dirty = false;
    document.getElementById("changesBar").classList.add("is-hidden");
    renderAll();
  });

  renderAll();
})();
