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

    html += '<h2 class="targets-h2">Targets by wind speed</h2>';
    html += '<div class="table-scroll">';
    html += '<table class="compare-table compare-table--tgt compare-table--condensed">';
    html += "<thead><tr><th>Wind</th><th>n</th><th>BSP</th>" +
      "<th>TWA</th><th>Heel</th><th>AWA</th><th>Rudder</th><th>Trim Tab</th><th>Forestay</th><th>Best</th></tr></thead><tbody>";
    targets.forEach(function (t) {
      html += "<tr><td>" + binLabel(t) + "</td><td>" + t.n + "</td>" +
        "<td>" + fmt(t.bsp) + "</td><td>" + fmt(t.twa, "°") + "</td><td>" + fmt(t.heel, "°") + "</td><td>" + fmt(t.awa, "°") + "</td>" +
        "<td>" + fmt(t.rudder, "°") + "</td><td>" + fmt(t.trimtab, "°") + "</td><td>" + fmt(t.forestay) + "</td>" +
        '<td><span class="boat-dot boat-dot--' + t.boat.toLowerCase() + '" style="vertical-align:middle; margin-right:5px;"></span>' + t.boat + "</td></tr>";
    });
    html += "</tbody></table></div>";

    html += '<div class="legend-row" style="margin:14px 0 8px;">' +
      '<span class="legend-item"><span class="boat-dot boat-dot--gemera"></span> Gemera</span>' +
      '<span class="legend-item"><span class="boat-dot boat-dot--artemis"></span> Artemis</span>' +
      '<span class="legend-item"><span class="legend-dot legend-dot--target"></span> Target (avg of top phases per bin)</span>' +
      "</div>";

    html += '<p class="import-step__hint" style="margin:2px 0 18px;">Scroll to zoom (capped to the full data range), drag to pan, double-click to reset. TWA, AWA, Heel, Rudder and Trim Tab are normalised (absolute value, port/starboard folded together).</p>';

    html += '<div class="chart-grid chart-grid--big">';
    html += chartBox("bsp-" + mode, "Boat speed vs true wind speed", "BSP (kt)");
    html += chartBox("twa-" + mode, "True wind angle vs true wind speed (normalised)", "|TWA| (°)");
    html += chartBox("heel-" + mode, "Heel vs true wind speed (normalised)", "|Heel| (°)");
    html += chartBox("awa-" + mode, "Apparent wind angle vs true wind speed (normalised)", "|AWA| (°)");
    html += chartBox("rudder-" + mode, "Rudder angle vs true wind speed (normalised)", "|Rudder| (°)");
    html += chartBox("trimtab-" + mode, "Trim tab angle vs true wind speed (normalised)", "|Trim Tab| (°)");
    html += chartBox("forestay-" + mode, "Inner forestay load vs true wind speed", "Forestay");
    html += "</div>";

    html += '<h2 class="targets-h2" style="margin-top:36px;">Methodology</h2>';
    html += '<div class="note-box">';
    html += '<b>Building a phase:</b> each point is a true <b>10-second segment</b>, built by ' +
      'downsampling the boat’s own B&amp;G H5000 CSV telemetry export logs to 1Hz and grouping ' +
      'into 10-second tumbling windows (minimum 8 valid 1Hz samples). Point of sail is classified ' +
      'per-second from true wind angle: <b>|TWA| &gt; 100°</b> is downwind, <b>|TWA| &lt; 75°</b> ' +
      'is upwind, and the 75–100° reaching/transition band is excluded, since the local logs carry ' +
      'no race-leg boundary metadata. Every segment must average <b>≥70% of target boat speed</b> ' +
      '(the H5000’s own Polar Performance % column) and hold <b>TWA within a ±6° band</b> across ' +
      'the window, so gybes, tacks and maneuvers are excluded by construction.<br><br>';
    html += '<b>Targets:</b> the target line for each wind-speed bin is the <b>average of the ' +
      'fastest ~20% of phases</b> in that bin (minimum 3), not a single best phase — a lone ' +
      'outlier segment (a moment where TWS is over-reading, say) would otherwise set the whole ' +
      'target. TWA, AWA, Heel, Rudder and Trim Tab are averaged as absolute values so port and ' +
      'starboard tacks don’t cancel out; Inner Forestay Load is already unsigned. Forestay load ' +
      'readings aren’t present on every boat-day, so that column/chart reflects whichever phases ' +
      'have it.<br><br>';
    html += '<b>Coverage:</b> both boats, all four events this season — Lanzarote, Sardinia, ' +
      'Marstrand and Cowes — processed entirely from local telemetry logs rather than Njord’s ' +
      'CDN (which has been affected by a sustained outage on the raw metric data). <b>' +
      stats.total + ' ' + mode + ' phases</b> total across the season.<br><br>';
    html += '<i>The scatter charts above plot a representative sample of segments for display; the ' +
      'target table and phase counts reflect the complete filtered dataset.</i>';
    html += "</div>";

    body.innerHTML = html;

    var xPad = (stats.tws_max - stats.tws_min) * 0.05 || 1;
    var baseX = [Math.max(0, stats.tws_min - xPad), stats.tws_max + xPad];

    var twaVals = collect(points, targets, 3, "twa", true);
    var awaVals = collect(points, targets, 5, "awa", true);
    var bspVals = collect(points, targets, 2, "bsp", false);
    var heelVals = collect(points, targets, 4, "heel", true);
    var rudderVals = collect(points, targets, 6, "rudder", true);
    var trimtabVals = collect(points, targets, 7, "trimtab", true);
    var forestayVals = collect(points, targets, 8, "forestay", false);

    initChart("bsp-" + mode, points, targets, 2, "bsp", niceDomain(bspVals), false, baseX);
    initChart("twa-" + mode, points, targets, 3, "twa", niceDomain(twaVals), true, baseX);
    initChart("heel-" + mode, points, targets, 4, "heel", niceDomain(heelVals), true, baseX);
    initChart("awa-" + mode, points, targets, 5, "awa", niceDomain(awaVals), true, baseX);
    initChart("rudder-" + mode, points, targets, 6, "rudder", niceDomain(rudderVals), true, baseX);
    initChart("trimtab-" + mode, points, targets, 7, "trimtab", niceDomain(trimtabVals), true, baseX);
    initChart("forestay-" + mode, points, targets, 8, "forestay", niceDomain(forestayVals), false, baseX);
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

  // Zoomable/pannable chart with crosshairs. yIndex/targetKey pick the metric;
  // normalise=true takes abs() of that metric (used for TWA/AWA/Heel/Rudder/TrimTab).
  // Null/undefined values (e.g. missing forestay readings) are skipped.
  function initChart(id, points, targets, yIndex, targetKey, baseYDomain, normalise, baseXDomain) {
    var svg = document.getElementById("chart-" + id);
    if (!svg) return;
    var W = 960, H = 480, M = { l: 56, r: 16, t: 14, b: 40 };
    var plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    var xDomain = baseXDomain.slice();
    var yDomain = baseYDomain.slice();

    function val(v) { return normalise ? Math.abs(v) : v; }

    function xPos(tws) { return M.l + (tws - xDomain[0]) / (xDomain[1] - xDomain[0]) * plotW; }
    function yPos(v) { return M.t + plotH - (v - yDomain[0]) / (yDomain[1] - yDomain[0]) * plotH; }
    function xInv(px) { return xDomain[0] + (px - M.l) / plotW * (xDomain[1] - xDomain[0]); }
    function yInv(py) { return yDomain[0] + (M.t + plotH - py) / plotH * (yDomain[1] - yDomain[0]); }

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
      xt.textContent = "True Wind Speed (kt)";
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
        if (raw === null || raw === undefined) return;
        var boat = p[0];
        var tws = p[1];
        var v = val(raw);
        dataLayer.appendChild(el("circle", {
          cx: xPos(tws), cy: yPos(v), r: 2.6,
          fill: boat === 0 ? "var(--gemera)" : "var(--artemis)",
          "fill-opacity": 0.55
        }));
      });
      targets.forEach(function (t) {
        var raw = t[targetKey];
        if (raw === null || raw === undefined) return;
        dataLayer.appendChild(el("circle", {
          cx: xPos(t.avgTWS), cy: yPos(val(raw)), r: 5,
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

      function toSvgPoint(evt) {
        var rect = svg.getBoundingClientRect();
        var sx = (evt.clientX - rect.left) / rect.width * W;
        var sy = (evt.clientY - rect.top) / rect.height * H;
        return { x: sx, y: sy };
      }

      svg.onmousemove = function (evt) {
        var p = toSvgPoint(evt);
        if (p.x < M.l || p.x > M.l + plotW || p.y < M.t || p.y > M.t + plotH) {
          ch.style.display = "none";
          return;
        }
        ch.style.display = "";
        var lines = ch.querySelectorAll(".crosshair-line");
        lines[0].setAttribute("x1", p.x); lines[0].setAttribute("x2", p.x);
        lines[1].setAttribute("y1", p.y); lines[1].setAttribute("y2", p.y);
        var dataX = xInv(p.x), dataY = yInv(p.y);
        var text = dataX.toFixed(1) + " kt, " + dataY.toFixed(1);
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

    var isDragging = false, dragStart = null, domainStart = null;
    svg.addEventListener("mousedown", function (evt) {
      isDragging = true;
      dragStart = { x: evt.clientX, y: evt.clientY };
      domainStart = { x: xDomain.slice(), y: yDomain.slice() };
      svg.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", function (evt) {
      if (!isDragging) return;
      var rect = svg.getBoundingClientRect();
      var dxPx = (evt.clientX - dragStart.x) / rect.width * W;
      var dyPx = (evt.clientY - dragStart.y) / rect.height * H;
      var dxData = dxPx / plotW * (domainStart.x[1] - domainStart.x[0]);
      var dyData = dyPx / plotH * (domainStart.y[1] - domainStart.y[0]);
      xDomain = [domainStart.x[0] - dxData, domainStart.x[1] - dxData];
      yDomain = [domainStart.y[0] + dyData, domainStart.y[1] + dyData];
      clampDomain();
      draw();
    });
    window.addEventListener("mouseup", function () {
      if (isDragging) { isDragging = false; svg.style.cursor = ""; }
    });
    svg.addEventListener("dblclick", function () {
      xDomain = baseXDomain.slice();
      yDomain = baseYDomain.slice();
      draw();
    });

    svg.style.cursor = "grab";
    draw();
  }

  render();
})();
