(function () {
  "use strict";

  var DATA = window.TARGETS_DATA || { downwind: null, upwind: null };
  var body = document.getElementById("targetsBody");
  var tabs = document.querySelectorAll("#modeTabs .boat-tab");
  var currentMode = "downwind";
  var currentXMetric = "tws"; // "tws" | "vmg"
  var currentBoatFilter = "all"; // "all" | "gemera" | "artemis"

  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabs.forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      currentMode = btn.getAttribute("data-mode");
      render();
    });
  });

  function render() {
    var data = DATA[currentMode];
    if (!data) {
      renderPending(currentMode);
      return;
    }
    renderTargets(currentMode, data);
  }

  function renderPending(mode) {
    var label = mode === "upwind" ? "Upwind" : "Downwind";
    body.innerHTML =
      '<div class="note-box note-box--pending">' +
      '<b>' + label + ' targets aren’t built yet.</b></div>';
  }

  function binLabel(t) {
    var lower = parseInt(String(t.bin).split("-")[0], 10);
    if (isNaN(lower)) lower = Math.floor(t.avgTWS);
    return lower + " knots";
  }

  function fmt(v, unit) {
    if (v === null || v === undefined) return "–";
    return v + (unit || "");
  }

  // X-axis metric definitions: which point/target field to use, label, unit,
  // and whether to draw a linear best-fit line through the scatter data.
  var X_METRICS = {
    tws: { pointIdx: 1, targetKey: "avgTWS", label: "True Wind Speed (kt)", unit: " kt", statLo: "tws_min", statHi: "tws_max", fitLine: false },
    vmg: { pointIdx: 9, targetKey: "vmgPct", label: "VMG % (Polar Performance)", unit: "%", statLo: "vmg_min", statHi: "vmg_max", fitLine: true }
  };

  // Metrics with rudder/trimtab/forestay only shown for upwind (downwind doesn't need them).
  function extraMetricsForMode(mode) {
    return mode === "upwind";
  }

  function filterPointsByBoat(points, boatFilter) {
    if (boatFilter === "all") return points;
    var code = boatFilter === "gemera" ? 0 : 1;
    return points.filter(function (p) { return p[0] === code; });
  }

  function renderTargets(mode, data) {
    var stats = data.statsByBoat[currentBoatFilter];
    var targets = data.targetsByBoat[currentBoatFilter];
    var points = filterPointsByBoat(data.points, currentBoatFilter);
    var showExtra = extraMetricsForMode(mode);
    var xm = X_METRICS[currentXMetric];

    var html = "";

    html += '<div class="stat-grid">';
    html += statCard(stats.total, "Total phases", "");
    html += statCard(stats.gemera, "Gemera phases", "stat-card--gemera");
    html += statCard(stats.artemis, "Artemis phases", "stat-card--artemis");
    html += statCard(stats.n_bins, "TWS bins covered", "");
    html += statCard(stats.tws_min + "–" + stats.tws_max, "TWS range (kt)", "");
    html += "</div>";

    html += '<div class="chart-controls" style="display:flex; flex-wrap:wrap; align-items:center; gap:18px; margin:24px 0 6px;">';
    html += '<span style="display:flex; align-items:center; gap:10px;">';
    html += '<label style="font-size:.82rem; color:var(--muted-2);">Chart x-axis</label>';
    html += '<select id="xMetricSelect" class="ghost-select">';
    html += '<option value="tws"' + (currentXMetric === "tws" ? " selected" : "") + '>True Wind Speed</option>';
    html += '<option value="vmg"' + (currentXMetric === "vmg" ? " selected" : "") + '>VMG %</option>';
    html += '</select>';
    html += '</span>';
    html += '<span style="display:flex; align-items:center; gap:10px;">';
    html += '<label style="font-size:.82rem; color:var(--muted-2);">Boats</label>';
    html += '<select id="boatFilterSelect" class="ghost-select">';
    html += '<option value="all"' + (currentBoatFilter === "all" ? " selected" : "") + '>Gemera + Artemis</option>';
    html += '<option value="gemera"' + (currentBoatFilter === "gemera" ? " selected" : "") + '>Gemera only</option>';
    html += '<option value="artemis"' + (currentBoatFilter === "artemis" ? " selected" : "") + '>Artemis only</option>';
    html += '</select>';
    html += '</span>';
    html += "</div>";

    html += '<div class="legend-row" style="margin:10px 0 8px;">' +
      (currentBoatFilter !== "artemis" ? '<span class="legend-item"><span class="boat-dot boat-dot--gemera"></span> Gemera</span>' : '') +
      (currentBoatFilter !== "gemera" ? '<span class="legend-item"><span class="boat-dot boat-dot--artemis"></span> Artemis</span>' : '') +
      '<span class="legend-item"><span class="legend-dot legend-dot--target"></span> Target (avg of top phases per bin)</span>' +
      (xm.fitLine ? '<span class="legend-item"><span class="legend-line legend-line--fit"></span> Target fit trend</span>' : '') +
      "</div>";

    html += '<p class="import-step__hint" style="margin:2px 0 18px;">Click and drag to draw a box around an area and zoom into it, scroll to zoom (both capped to the full data range), double-click to reset. TWA, AWA, Heel' +
      (showExtra ? ', Rudder and Trim Tab are' : ' are') + ' normalised (absolute value, port/starboard folded together).</p>';

    html += '<div class="chart-grid chart-grid--big">';
    html += chartBox("bsp-" + mode, "Boat speed vs " + xm.label.toLowerCase(), "BSP (kt)");
    html += chartBox("twa-" + mode, "True wind angle vs " + xm.label.toLowerCase() + " (normalised)", "|TWA| (°)");
    html += chartBox("heel-" + mode, "Heel vs " + xm.label.toLowerCase() + " (normalised)", "|Heel| (°)");
    html += chartBox("awa-" + mode, "Apparent wind angle vs " + xm.label.toLowerCase() + " (normalised)", "|AWA| (°)");
    if (showExtra) {
      html += chartBox("rudder-" + mode, "Rudder angle vs " + xm.label.toLowerCase() + " (normalised)", "|Rudder| (°)");
      html += chartBox("trimtab-" + mode, "Trim tab angle vs " + xm.label.toLowerCase() + " (normalised)", "|Trim Tab| (°)");
      html += chartBox("forestay-" + mode, "Inner forestay load vs " + xm.label.toLowerCase(), "Forestay");
    }
    html += "</div>";

    html += '<h2 class="targets-h2" style="margin-top:32px;">Targets by wind speed</h2>';
    html += '<div class="table-scroll">';
    html += '<table class="compare-table compare-table--tgt compare-table--condensed">';
    html += "<thead><tr><th>Wind</th><th>n</th><th>BSP</th>" +
      "<th>TWA</th><th>Heel</th><th>AWA</th>" +
      (showExtra ? "<th>Rudder</th><th>Trim</th><th>Forestay</th>" : "") +
      "<th>Best</th></tr></thead><tbody>";
    targets.forEach(function (t) {
      html += "<tr><td>" + binLabel(t) + "</td><td>" + t.n + "</td>" +
        "<td>" + fmt(t.bsp) + "</td><td>" + fmt(t.twa, "°") + "</td><td>" + fmt(t.heel, "°") + "</td><td>" + fmt(t.awa, "°") + "</td>" +
        (showExtra ? "<td>" + fmt(t.rudder, "°") + "</td><td>" + fmt(t.trimtab, "°") + "</td><td>" + fmt(t.forestay) + "</td>" : "") +
        '<td><span class="boat-dot boat-dot--' + t.boat.toLowerCase() + '" style="vertical-align:middle; margin-right:5px;"></span>' + t.boat + "</td></tr>";
    });
    html += "</tbody></table></div>";

    html += '<h2 class="targets-h2" style="margin-top:36px;">Methodology</h2>';
    html += '<div class="note-box">';
    html += '<b>Building a phase:</b> each point is a true <b>10-second segment</b>, built by ' +
      'downsampling the boat’s own B&amp;G H5000 CSV telemetry export logs to 1Hz and grouping ' +
      'into 10-second tumbling windows (minimum 8 valid 1Hz samples). Point of sail is classified ' +
      'per-second from true wind angle: <b>|TWA| &gt; 100°</b> is downwind, <b>|TWA| &lt; 75°</b> ' +
      'is upwind, and the 75–100° reaching/transition band is excluded, since the local logs carry ' +
      'no race-leg boundary metadata. Every segment must average <b>≥70% of target boat speed</b> ' +
      '(the H5000’s own Polar Performance % column, selectable as the chart x-axis as VMG%) and hold <b>TWA within a ' +
      '±6° band</b> across the window, so gybes, tacks and maneuvers are excluded by construction. ' +
      'Phases below <b>5kt true wind speed</b> are excluded — too few, noisy samples at that end.<br><br>';
    html += '<b>Targets:</b> the target line for each wind-speed bin is the <b>average of the ' +
      'fastest ~20% of phases</b> in that bin (minimum 3), not a single best phase — a lone ' +
      'outlier segment (a moment where TWS is over-reading, say) would otherwise set the whole ' +
      'target. TWA, AWA, Heel' + (showExtra ? ', Rudder and Trim Tab are' : ' are') + ' averaged as ' +
      'absolute values so port and starboard tacks don’t cancel out' +
      (showExtra ? '; Inner Forestay Load is already unsigned and not present on every boat-day, ' +
        'so that column/chart reflects whichever phases have it' : '') + '. The <b>Boats</b> filter ' +
      'above recomputes the targets from scratch for the selected boat(s) — it doesn’t just hide ' +
      'points from the combined target line.<br><br>';
    html += '<b>Coverage:</b> both boats, all four events this season — Lanzarote, Sardinia, ' +
      'Marstrand and Cowes — processed entirely from local telemetry logs rather than Njord’s ' +
      'CDN (which has been affected by a sustained outage on the raw metric data). <b>' +
      stats.total + ' ' + mode + ' phases</b> shown for the current boat filter.<br><br>';
    html += '<i>The scatter charts above plot a representative sample of segments for display; the ' +
      'target table and phase counts reflect the complete filtered dataset.</i>';
    html += "</div>";

    body.innerHTML = html;

    var xSelect = document.getElementById("xMetricSelect");
    if (xSelect) {
      xSelect.addEventListener("change", function () {
        currentXMetric = xSelect.value;
        render();
      });
    }
    var boatSelect = document.getElementById("boatFilterSelect");
    if (boatSelect) {
      boatSelect.addEventListener("change", function () {
        currentBoatFilter = boatSelect.value;
        render();
      });
    }

    var xPad = (stats[xm.statHi] - stats[xm.statLo]) * 0.05 || 1;
    var baseX = [Math.max(0, stats[xm.statLo] - xPad), stats[xm.statHi] + xPad];

    var twaVals = collect(points, targets, 3, "twa", true);
    var awaVals = collect(points, targets, 5, "awa", true);
    var bspVals = collect(points, targets, 2, "bsp", false);
    var heelVals = collect(points, targets, 4, "heel", true);

    initChart("bsp-" + mode, points, targets, 2, "bsp", niceDomain(bspVals), false, baseX, xm);
    initChart("twa-" + mode, points, targets, 3, "twa", niceDomain(twaVals), true, baseX, xm);
    initChart("heel-" + mode, points, targets, 4, "heel", niceDomain(heelVals), true, baseX, xm);
    initChart("awa-" + mode, points, targets, 5, "awa", niceDomain(awaVals), true, baseX, xm);

    if (showExtra) {
      var rudderVals = collect(points, targets, 6, "rudder", true);
      var trimtabVals = collect(points, targets, 7, "trimtab", true);
      var forestayVals = collect(points, targets, 8, "forestay", false);
      initChart("rudder-" + mode, points, targets, 6, "rudder", niceDomain(rudderVals), true, baseX, xm);
      initChart("trimtab-" + mode, points, targets, 7, "trimtab", niceDomain(trimtabVals), true, baseX, xm);
      initChart("forestay-" + mode, points, targets, 8, "forestay", niceDomain(forestayVals), false, baseX, xm);
    }
  }

  function collect(points, targets, idx, key, abs) {
    var out = [];
    points.forEach(function (p) {
      var v = p[idx];
      if (v === null || v === undefined) return;
      out.push(abs ? Math.abs(v) : v);
    });
    targets.forEach(function (t) {
      var v = t[key];
      if (v === null || v === undefined) return;
      out.push(abs ? Math.abs(v) : v);
    });
    if (!out.length) out = [0, 1];
    return out;
  }

  function statCard(n, label, extraClass) {
    return '<div class="stat-card ' + extraClass + '">' +
      '<div class="stat-n">' + n + "</div>" +
      '<div class="stat-l">' + label + "</div></div>";
  }

  function chartBox(id, title, yLabel) {
    return '<div class="panel chart-box"><h3>' + title + '</h3>' +
      '<svg id="chart-' + id + '" viewBox="0 0 960 480" data-ylabel="' + yLabel + '"></svg></div>';
  }

  function niceDomain(vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.08 || 1;
    return [lo - pad, hi + pad];
  }

  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Zoomable/pannable chart with crosshairs. yIndex/targetKey pick the y metric;
  // normalise=true takes abs() of that metric (used for TWA/AWA/Heel/Rudder/TrimTab).
  // xMetric picks the x-axis field (TWS or VMG%) from point/target data, and
  // optionally draws a linear best-fit line through the TARGET dots (VMG%).
  // Null/undefined values (e.g. missing forestay readings) are skipped.
  function initChart(id, points, targets, yIndex, targetKey, baseYDomain, normalise, baseXDomain, xMetric) {
    var svg = document.getElementById("chart-" + id);
    if (!svg) return;
    var W = 960, H = 480, M = { l: 56, r: 16, t: 14, b: 40 };
    var plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    var xDomain = baseXDomain.slice();
    var yDomain = baseYDomain.slice();
    var xPointIdx = xMetric.pointIdx;
    var xTargetKey = xMetric.targetKey;
    var xUnit = xMetric.unit;

    function val(v) { return normalise ? Math.abs(v) : v; }

    function xPos(xv) { return M.l + (xv - xDomain[0]) / (xDomain[1] - xDomain[0]) * plotW; }
    function yPos(v) { return M.t + plotH - (v - yDomain[0]) / (yDomain[1] - yDomain[0]) * plotH; }
    function xInv(px) { return xDomain[0] + (px - M.l) / plotW * (xDomain[1] - xDomain[0]); }
    function yInv(py) { return yDomain[0] + (M.t + plotH - py) / plotH * (yDomain[1] - yDomain[0]); }

    // Linear least-squares fit through the TARGET dots (per-bin top-phase averages),
    // not the raw scatter cloud — shows the trend of the targets themselves.
    function computeFit() {
      var xs = [], ys = [];
      targets.forEach(function (t) {
        var xv = t[xTargetKey], yv = t[targetKey];
        if (xv === null || xv === undefined || yv === null || yv === undefined) return;
        xs.push(xv);
        ys.push(val(yv));
      });
      var n = xs.length;
      if (n < 2) return null;
      var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      for (var i = 0; i < n; i++) {
        sumX += xs[i]; sumY += ys[i]; sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i];
      }
      var denom = n * sumXX - sumX * sumX;
      if (denom === 0) return null;
      var slope = (n * sumXY - sumX * sumY) / denom;
      var intercept = (sumY - slope * sumX) / n;
      return { slope: slope, intercept: intercept };
    }

    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // clip plot area so zoomed/panned points don't spill into margins
      var clipId = "clip-" + id;
      var defs = el("defs", {});
      var clipPath = el("clipPath", { id: clipId });
      clipPath.appendChild(el("rect", { x: M.l, y: M.t, width: plotW, height: plotH }));
      defs.appendChild(clipPath);
      svg.appendChild(defs);

      var xStep = niceStep(xDomain[1] - xDomain[0]);
      var yStep = niceStep(yDomain[1] - yDomain[0]);
      var xStart = Math.ceil(xDomain[0] / xStep) * xStep;
      for (var x = xStart; x <= xDomain[1]; x += xStep) {
        svg.appendChild(el("line", { x1: xPos(x), y1: M.t, x2: xPos(x), y2: M.t + plotH, class: "chart-grid-line" }));
        var tx = el("text", { x: xPos(x), y: H - 20, class: "chart-axis-label", "text-anchor": "middle" });
        tx.textContent = round1(x);
        svg.appendChild(tx);
      }
      var yStart = Math.ceil(yDomain[0] / yStep) * yStep;
      for (var y = yStart; y <= yDomain[1]; y += yStep) {
        svg.appendChild(el("line", { x1: M.l, y1: yPos(y), x2: M.l + plotW, y2: yPos(y), class: "chart-grid-line" }));
        var ty = el("text", { x: M.l - 8, y: yPos(y) + 3, class: "chart-axis-label", "text-anchor": "end" });
        ty.textContent = round1(y);
        svg.appendChild(ty);
      }
      var xt = el("text", { x: M.l + plotW / 2, y: H - 4, class: "chart-axis-label", "text-anchor": "middle" });
      xt.textContent = xMetric.label;
      svg.appendChild(xt);
      var ylab = el("text", {
        x: 14, y: M.t + plotH / 2, class: "chart-axis-label", "text-anchor": "middle",
        transform: "rotate(-90 14 " + (M.t + plotH / 2) + ")"
      });
      ylab.textContent = svg.getAttribute("data-ylabel") || "";
      svg.appendChild(ylab);

      var dataLayer = el("g", { "clip-path": "url(#" + clipId + ")" });
      points.forEach(function (p) {
        var raw = p[yIndex];
        var xv = p[xPointIdx];
        if (raw === null || raw === undefined || xv === null || xv === undefined) return;
        var boat = p[0];
        var v = val(raw);
        dataLayer.appendChild(el("circle", {
          cx: xPos(xv), cy: yPos(v), r: 2.6,
          fill: boat === 0 ? "var(--gemera)" : "var(--artemis)",
          "fill-opacity": 0.55
        }));
      });

      if (xMetric.fitLine) {
        var fit = computeFit();
        if (fit) {
          var fx0 = xDomain[0], fx1 = xDomain[1];
          var fy0 = fit.slope * fx0 + fit.intercept;
          var fy1 = fit.slope * fx1 + fit.intercept;
          dataLayer.appendChild(el("line", {
            x1: xPos(fx0), y1: yPos(fy0), x2: xPos(fx1), y2: yPos(fy1), class: "fit-line"
          }));
        }
      }

      targets.forEach(function (t) {
        var raw = t[targetKey];
        var xv = t[xTargetKey];
        if (raw === null || raw === undefined || xv === null || xv === undefined) return;
        dataLayer.appendChild(el("circle", {
          cx: xPos(xv), cy: yPos(val(raw)), r: 5,
          fill: "var(--accent)", stroke: "#00000066", "stroke-width": 1
        }));
      });
      svg.appendChild(dataLayer);

      // border
      svg.appendChild(el("rect", { x: M.l, y: M.t, width: plotW, height: plotH, fill: "none", stroke: "var(--line)" }));

      // crosshair group (hidden until pointer moves over plot)
      var ch = el("g", { class: "crosshair-group", style: "display:none;" });
      ch.appendChild(el("line", { class: "crosshair-line", x1: 0, y1: M.t, x2: 0, y2: M.t + plotH }));
      ch.appendChild(el("line", { class: "crosshair-line", x1: M.l, y1: 0, x2: M.l + plotW, y2: 0 }));
      var chLabelBg = el("rect", { class: "crosshair-label-bg", x: 0, y: 0, width: 1, height: 1, rx: 4 });
      var chLabel = el("text", { class: "crosshair-label", x: 0, y: 0 });
      ch.appendChild(chLabelBg);
      ch.appendChild(chLabel);
      svg.appendChild(ch);

      function toSvgPointLocal(evt) {
        var rect = svg.getBoundingClientRect();
        var sx = (evt.clientX - rect.left) / rect.width * W;
        var sy = (evt.clientY - rect.top) / rect.height * H;
        return { x: sx, y: sy };
      }

      svg.onmousemove = function (evt) {
        var p = toSvgPointLocal(evt);
        if (p.x < M.l || p.x > M.l + plotW || p.y < M.t || p.y > M.t + plotH) {
          ch.style.display = "none";
          return;
        }
        ch.style.display = "";
        var lines = ch.querySelectorAll(".crosshair-line");
        lines[0].setAttribute("x1", p.x); lines[0].setAttribute("x2", p.x);
        lines[1].setAttribute("y1", p.y); lines[1].setAttribute("y2", p.y);
        var dataX = xInv(p.x), dataY = yInv(p.y);
        var text = dataX.toFixed(1) + xUnit + ", " + dataY.toFixed(1);
        chLabel.textContent = text;
        var lx = Math.min(p.x + 10, M.l + plotW - 90);
        var ly = Math.max(p.y - 10, M.t + 14);
        chLabel.setAttribute("x", lx + 6);
        chLabel.setAttribute("y", ly);
        chLabelBg.setAttribute("x", lx);
        chLabelBg.setAttribute("y", ly - 13);
        chLabelBg.setAttribute("width", text.length * 6.4 + 10);
        chLabelBg.setAttribute("height", 18);
      };
      svg.onmouseleave = function () { ch.style.display = "none"; };
    }

    function niceStep(span) {
      var raw = span / 6;
      var mag = Math.pow(10, Math.floor(Math.log10(raw)));
      var norm = raw / mag;
      var step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
      return step * mag;
    }
    function round1(v) { return Math.round(v * 10) / 10; }

    function clampAxis(domain, base) {
      var minSpan = (base[1] - base[0]) * 0.03;
      var maxSpan = base[1] - base[0];
      var span = domain[1] - domain[0];
      var center = (domain[0] + domain[1]) / 2;
      if (span < minSpan) span = minSpan;
      if (span > maxSpan) span = maxSpan; // never zoom out past the full data range
      var lo = center - span / 2, hi = center + span / 2;
      // keep the visible window inside the base range
      if (lo < base[0]) { hi += base[0] - lo; lo = base[0]; }
      if (hi > base[1]) { lo -= hi - base[1]; hi = base[1]; }
      lo = Math.max(lo, base[0]);
      hi = Math.min(hi, base[1]);
      return [lo, hi];
    }

    function clampDomain() {
      xDomain = clampAxis(xDomain, baseXDomain);
      yDomain = clampAxis(yDomain, baseYDomain);
    }

    svg.addEventListener("wheel", function (evt) {
      evt.preventDefault();
      var rect = svg.getBoundingClientRect();
      var sx = (evt.clientX - rect.left) / rect.width * W;
      var sy = (evt.clientY - rect.top) / rect.height * H;
      var factor = evt.deltaY < 0 ? 0.85 : 1 / 0.85;
      var fx = xInv(sx), fy = yInv(sy);
      xDomain = [fx - (fx - xDomain[0]) * factor, fx + (xDomain[1] - fx) * factor];
      yDomain = [fy - (fy - yDomain[0]) * factor, fy + (yDomain[1] - fy) * factor];
      clampDomain();
      draw();
    }, { passive: false });

    // Click-and-drag draws a selection box; releasing zooms to that box.
    // Double-click resets to the full data range.
    var isSelecting = false, selStartPx = null, selBox = null;

    function toSvgPoint(evt) {
      var rect = svg.getBoundingClientRect();
      var sx = (evt.clientX - rect.left) / rect.width * W;
      var sy = (evt.clientY - rect.top) / rect.height * H;
      return { x: sx, y: sy };
    }
    function clampToPlot(p) {
      return {
        x: Math.min(Math.max(p.x, M.l), M.l + plotW),
        y: Math.min(Math.max(p.y, M.t), M.t + plotH)
      };
    }

    svg.addEventListener("mousedown", function (evt) {
      var p = clampToPlot(toSvgPoint(evt));
      isSelecting = true;
      selStartPx = p;
      if (selBox) { svg.removeChild(selBox); selBox = null; }
      selBox = el("rect", { class: "zoom-select-box", x: p.x, y: p.y, width: 0, height: 0 });
      svg.appendChild(selBox);
    });
    window.addEventListener("mousemove", function (evt) {
      if (!isSelecting || !selBox) return;
      var p = clampToPlot(toSvgPoint(evt));
      var x = Math.min(p.x, selStartPx.x), y = Math.min(p.y, selStartPx.y);
      var w = Math.abs(p.x - selStartPx.x), h = Math.abs(p.y - selStartPx.y);
      selBox.setAttribute("x", x);
      selBox.setAttribute("y", y);
      selBox.setAttribute("width", w);
      selBox.setAttribute("height", h);
    });
    window.addEventListener("mouseup", function (evt) {
      if (!isSelecting) return;
      isSelecting = false;
      var p = clampToPlot(toSvgPoint(evt));
      var wPx = Math.abs(p.x - selStartPx.x), hPx = Math.abs(p.y - selStartPx.y);
      if (selBox) { svg.removeChild(selBox); selBox = null; }
      if (wPx < 8 || hPx < 8) return; // too small to count as a drag-select
      var x0 = Math.min(p.x, selStartPx.x), x1 = Math.max(p.x, selStartPx.x);
      var y0 = Math.min(p.y, selStartPx.y), y1 = Math.max(p.y, selStartPx.y);
      var dataX0 = xInv(x0), dataX1 = xInv(x1);
      var dataY0 = yInv(y1), dataY1 = yInv(y0); // y is inverted (screen down = data down)
      xDomain = [dataX0, dataX1];
      yDomain = [dataY0, dataY1];
      clampDomain();
      draw();
    });
    svg.addEventListener("dblclick", function () {
      xDomain = baseXDomain.slice();
      yDomain = baseYDomain.slice();
      draw();
    });

    svg.style.cursor = "crosshair";
    draw();
  }

  render();
})();
