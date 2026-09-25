(function () {
  "use strict";

  var DATA = window.TARGETS_DATA || { downwind: null, upwind: null };
  var body = document.getElementById("targetsBody");
  var tabs = document.querySelectorAll("#modeTabs .boat-tab");
  var currentMode = "downwind";

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
      '<b>' + label + ' targets aren’t built yet.</b> This tool currently covers downwind ' +
      'legs only — upwind needs the same pass over Njord’s raw telemetry (matching to ' +
      'upwind race legs, the same BSP% and TWA-stability filters, both boats, every event) ' +
      'which hasn’t been run yet.' +
      '</div>';
  }

  function renderTargets(mode, data) {
    var stats = data.stats;
    var targets = data.targets;
    var points = data.points;

    var html = "";

    html += '<div class="stat-grid">';
    html += statCard(stats.total, "Total phases", "");
    html += statCard(stats.gemera, "Gemera phases", "stat-card--gemera");
    html += statCard(stats.artemis, "Artemis phases", "stat-card--artemis");
    html += statCard(stats.n_bins, "TWS bins covered", "");
    html += statCard(stats.tws_min + "–" + stats.tws_max, "TWS range (kt)", "");
    html += "</div>";

    html += '<div class="note-box">';
    html += '<b>Methodology:</b> each point is a true <b>10-second segment</b> from Njord’s ' +
      'raw ~10Hz telemetry, matched to downwind race legs via Njord’s own per-race ' +
      'classification. Every segment must average <b>≥70% of target boat speed</b> ' +
      '(Njord’s own BSP% column — only slow outliers are excluded, fast segments are ' +
      'kept) and hold <b>TWA within a ±6° band</b> across the window. Gybes, tacks and ' +
      'maneuvers are excluded by construction.<br><br>';
    html += '<b>Coverage:</b> Lanzarote 2026-1 (all race days, both boats) and Sardinia RC44 ' +
      '2026-2 (all days for Gemera; Artemis recovered for Apr 26 only) are complete at this ' +
      'resolution — <b>' + stats.total + ' phases</b> total. Marstrand, Cowes, and the ' +
      'remaining Sardinia/Artemis days (Apr 21–25) are pending a sustained outage on ' +
      'Njord’s raw-telemetry CDN (index files succeed; the metric data itself 503s) — ' +
      'this tool will pick them up once that clears and it’s re-run.<br><br>';
    html += '<i>The scatter charts below plot a 1-in-4 sample of segments for display; the ' +
      'target table and phase counts reflect the complete filtered dataset.</i>';
    html += "</div>";

    html += '<h2 style="margin:26px 0 12px; font-size:1.1rem;">Target table — optimum by TWS bin</h2>';
    html += '<table class="compare-table compare-table--tgt">';
    html += "<thead><tr><th>TWS bin (kt)</th><th>n</th><th>Avg TWS</th><th>Target BSP</th>" +
      "<th>Target TWA</th><th>Target heel</th><th>Target AWA</th><th>Best boat</th></tr></thead><tbody>";
    targets.forEach(function (t) {
      html += "<tr><td>" + t.bin + "</td><td>" + t.n + "</td><td>" + t.avgTWS + "</td>" +
        "<td>" + t.bsp + "</td><td>" + t.twa + "</td><td>" + t.heel + "</td><td>" + t.awa + "</td>" +
        '<td><span class="boat-dot boat-dot--' + t.boat.toLowerCase() + '" style="vertical-align:middle; margin-right:6px;"></span>' + t.boat + "</td></tr>";
    });
    html += "</tbody></table>";

    html += '<div class="legend-row" style="margin-top:16px;">' +
      '<span class="legend-item"><span class="boat-dot boat-dot--gemera"></span> Gemera</span>' +
      '<span class="legend-item"><span class="boat-dot boat-dot--artemis"></span> Artemis</span>' +
      '<span class="legend-item"><span class="legend-dot legend-dot--target"></span> Target (best BSP per TWS bin)</span>' +
      "</div>";

    html += '<div class="chart-grid" style="margin-top:18px;">';
    html += chartBox("bsp-" + mode, "Boat speed vs true wind speed");
    html += chartBox("twa-" + mode, "True wind angle vs true wind speed");
    html += chartBox("heel-" + mode, "Heel vs true wind speed");
    html += chartBox("awa-" + mode, "Apparent wind angle vs true wind speed");
    html += "</div>";

    body.innerHTML = html;

    var bspVals = points.map(function (p) { return p[2]; }).concat(targets.map(function (t) { return t.bsp; }));
    var twaVals = points.map(function (p) { return p[3]; }).concat(targets.map(function (t) { return t.twa; }));
    var heelVals = points.map(function (p) { return p[4]; }).concat(targets.map(function (t) { return t.heel; }));
    var awaVals = points.map(function (p) { return p[5]; }).concat(targets.map(function (t) { return t.awa; }));

    drawChart("bsp-" + mode, points, targets, 2, "bsp", niceDomain(bspVals));
    drawChart("twa-" + mode, points, targets, 3, "twa", niceDomain(twaVals));
    drawChart("heel-" + mode, points, targets, 4, "heel", niceDomain(heelVals));
    drawChart("awa-" + mode, points, targets, 5, "awa", niceDomain(awaVals));
  }

  function statCard(n, label, extraClass) {
    return '<div class="stat-card ' + extraClass + '">' +
      '<div class="stat-n">' + n + "</div>" +
      '<div class="stat-l">' + label + "</div></div>";
  }

  function chartBox(id, title) {
    return '<div class="panel chart-box"><h3>' + title + '</h3>' +
      '<svg id="chart-' + id + '" viewBox="0 0 900 380"></svg></div>';
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

  function drawChart(id, points, targets, yIndex, targetKey, yDomain) {
    var svg = document.getElementById("chart-" + id);
    if (!svg) return;
    var W = 900, H = 380, M = { l: 46, r: 16, t: 14, b: 34 };
    var plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    var xMin = 3, xMax = 24;
    var yMin = yDomain[0], yMax = yDomain[1];

    function xPos(tws) { return M.l + (tws - xMin) / (xMax - xMin) * plotW; }
    function yPos(v) { return M.t + plotH - (v - yMin) / (yMax - yMin) * plotH; }

    var xStep = 2, yStep = (yMax - yMin) / 6;
    for (var x = xMin; x <= xMax; x += xStep) {
      svg.appendChild(el("line", { x1: xPos(x), y1: M.t, x2: xPos(x), y2: M.t + plotH, class: "chart-grid-line" }));
      var tx = el("text", { x: xPos(x), y: H - 10, class: "chart-axis-label", "text-anchor": "middle" });
      tx.textContent = x;
      svg.appendChild(tx);
    }
    for (var i = 0; i <= 6; i++) {
      var v = yMin + i * yStep;
      svg.appendChild(el("line", { x1: M.l, y1: yPos(v), x2: M.l + plotW, y2: yPos(v), class: "chart-grid-line" }));
      var ty = el("text", { x: M.l - 8, y: yPos(v) + 3, class: "chart-axis-label", "text-anchor": "end" });
      ty.textContent = Math.round(v * 10) / 10;
      svg.appendChild(ty);
    }
    var xt = el("text", { x: M.l + plotW / 2, y: H - 2, class: "chart-axis-label", "text-anchor": "middle" });
    xt.textContent = "True Wind Speed (kt)";
    svg.appendChild(xt);

    points.forEach(function (p) {
      var boat = p[0];
      var tws = p[1];
      var val = p[yIndex];
      svg.appendChild(el("circle", {
        cx: xPos(tws), cy: yPos(val), r: 2.1,
        fill: boat === 0 ? "var(--gemera)" : "var(--artemis)",
        "fill-opacity": 0.55
      }));
    });

    targets.forEach(function (t) {
      svg.appendChild(el("circle", {
        cx: xPos(t.avgTWS), cy: yPos(t[targetKey]), r: 4.2,
        fill: "var(--accent)", stroke: "#00000066", "stroke-width": 1
      }));
    });
  }

  render();
})();
