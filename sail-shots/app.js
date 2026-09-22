// RC44 Sail Shots — live cross-device sync via Firebase Firestore + Storage.
// Falls back to local-only (this browser only) mode if firebase-config.js hasn't been filled in yet.
// Each scan is its own Firestore document (collection "rc44-sail-shots"), so two people can add
// scans or set mast alignment at the same time without clobbering each other. Photos go to
// Firebase Storage; the Firestore doc just holds the resulting download URL.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore, collection, doc, setDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

(function () {
  "use strict";

  var STORAGE_KEY = "rc44-sail-shots-v2"; // local-only fallback cache
  var COLLECTION = "rc44-sail-shots";

  var scans = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
  var liveMode = false;
  var db = null, storage = null;
  var selected = { artemis: null, gemera: null };
  var compare = { left: null, right: null }; // any two scans, regardless of boat — feeds the charts + overlay
  var sailFilter = ""; // "" = all sails; else "Main" | "G1" | "J2" | "J3"

  // Existing scans predate the Main/G1/J2/J3 split — they're all mainsail battens, so tag
  // anything without a sail code as "Main" rather than losing them from the filter.
  function tagDefaultSail(list) { list.forEach(function (s) { if (!s.sail) s.sail = "Main"; }); }
  tagDefaultSail(scans);

  function findScan(id) { return scans.filter(function (s) { return s.id === id; })[0] || null; }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function persistLocal() { safeSet(STORAGE_KEY, JSON.stringify(scans)); }

  // ---------- Firebase init (falls back to local-only if not configured) ----------

  var cfg = window.RC44_FIREBASE_CONFIG || {};
  var configured = cfg.apiKey && cfg.apiKey.indexOf("REPLACE_ME") === -1;

  if (configured) {
    try {
      var app = initializeApp(cfg);
      // ignoreUndefinedProperties: an optional field left blank must not silently kill the save.
      db = initializeFirestore(app, { ignoreUndefinedProperties: true });
      storage = getStorage(app);
      var auth = getAuth(app);
      onAuthStateChanged(auth, function (user) {
        if (user) {
          liveMode = true;
          document.getElementById("configWarning").classList.add("is-hidden");
          subscribeScans();
        }
      });
      signInAnonymously(auth).catch(function (e) {
        console.error("Anonymous sign-in failed, falling back to local-only mode:", e);
        fallbackLocal();
      });
    } catch (e) {
      console.error("Firebase init failed, falling back to local-only mode:", e);
      fallbackLocal();
    }
  } else {
    fallbackLocal();
  }

  function fallbackLocal() {
    liveMode = false;
    document.getElementById("configWarning").classList.remove("is-hidden");
    var raw = safeGet(STORAGE_KEY);
    if (raw) { try { scans = JSON.parse(raw); } catch (e) { /* ignore */ } }
    tagDefaultSail(scans);
    renderAll();
  }

  var seededCheck = false;
  function subscribeScans() {
    onSnapshot(collection(db, COLLECTION), function (snap) {
      if (snap.empty) {
        // First run — seed Firestore from the bundled data.js, once.
        if (!seededCheck) { seededCheck = true; seedFromLocalData(); }
        return;
      }
      seededCheck = true;
      var list = [];
      snap.forEach(function (d) { list.push(d.data()); });
      tagDefaultSail(list);
      scans = list;
      renderAll();
    }, function (err) {
      console.error("Sail Shots sync error", err);
    });
  }

  function seedFromLocalData() {
    var seed = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
    tagDefaultSail(seed);
    seed.forEach(function (s) {
      setDoc(doc(db, COLLECTION, s.id), s).catch(function (e) { console.error("Seed failed for " + s.id, e); });
    });
  }

  function dateOf(scan) {
    // scan.time is a plain "YYYY-MM-DDTHH:MM:SS" wall-clock string with no timezone —
    // read the date digits directly rather than going through Date/toISOString, which
    // would reinterpret it in the viewing browser's own timezone and can shift the date.
    var t = scan.time || "";
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
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
    renderDateChips();
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

  // ---------- Date filter: multi-select chips, defaulting to the most recent day only ----------

  var selectedDates = null; // null = no date filter (all dates shown); Set = only these dates
  var datesInitialized = false;
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function formatDateChip(d) {
    var parts = d.split("-");
    var day = parseInt(parts[2], 10);
    var mon = MONTH_ABBR[parseInt(parts[1], 10) - 1] || parts[1];
    return day + " " + mon;
  }

  function renderDateChips() {
    var dates = distinctValues(dateOf); // ascending
    if (!datesInitialized) {
      selectedDates = dates.length ? new Set([dates[dates.length - 1]]) : null;
      datesInitialized = true;
    }
    var wrap = document.getElementById("dateToggle");
    var allActive = selectedDates === null;
    var html = "<button type='button' class='view-toggle__btn" + (allActive ? " is-active" : "") + "' data-date=''>All dates</button>";
    dates.slice().reverse().forEach(function (d) {
      var active = selectedDates !== null && selectedDates.has(d);
      html += "<button type='button' class='view-toggle__btn" + (active ? " is-active" : "") + "' data-date='" + d + "'>" + formatDateChip(d) + "</button>";
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll(".view-toggle__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = btn.dataset.date;
        if (!d) {
          selectedDates = null;
        } else {
          if (selectedDates === null) selectedDates = new Set();
          if (selectedDates.has(d)) selectedDates.delete(d); else selectedDates.add(d);
          if (selectedDates.size === 0) selectedDates = null;
        }
        renderAll();
      });
    });
  }

  function passesFilter(scan) {
    var event = document.getElementById("fEvent").value;
    var bsp = document.getElementById("fBsp").value;
    var chock = document.getElementById("fChock").value;
    var mastSetup = document.getElementById("fMastSetup").value;
    var trimtab = document.getElementById("fTrimtab").value;
    var rake = document.getElementById("fRake").value;
    var twsLo = Number(document.getElementById("fTwsLo").value);
    var twsHi = Number(document.getElementById("fTwsHi").value);

    if (event && scan.event !== event) return false;
    if (selectedDates !== null && !selectedDates.has(dateOf(scan))) return false;
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

  ["fEvent", "fBsp", "fChock", "fMastSetup", "fTrimtab", "fRake"].forEach(function (id) {
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
    ["fEvent", "fBsp", "fChock", "fMastSetup", "fTrimtab", "fRake"].forEach(function (id) {
      document.getElementById(id).value = "";
    });
    sailFilter = "";
    datesInitialized = false; // re-defaults to "most recent day only" on next render
    document.querySelectorAll("#sailToggle .view-toggle__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.sail === "");
    });
    refreshFilterOptions();
    renderAll();
  });

  // ---------- Catalog (thumbnail picker) ----------

  function scanCaption(scan) {
    // Same reasoning as dateOf(): keep the stored wall-clock string as-is instead of
    // reinterpreting it through Date/toISOString (which shifts it by the viewer's timezone).
    var t = scan.time || "";
    var when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) ? t.slice(0, 16).replace("T", " ") : t;
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
      card.draggable = true;
      card.innerHTML = "<img src='" + s.file + "' alt=''><span>" + scanCaption(s) + "</span>" +
        "<button type='button' class='thumb__edit' title='Edit this scan'>&#9998;</button>";
      card.addEventListener("click", function () {
        selected[boat] = s.id;
        renderCatalog(boat);
        renderStage(boat);
        renderOverlay();
        renderMetricCharts();
      });
      card.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", s.id);
        e.dataTransfer.effectAllowed = "copy";
        card.classList.add("thumb--dragging");
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("thumb--dragging");
      });
      card.querySelector(".thumb__edit").addEventListener("click", function (e) {
        e.stopPropagation();
        openEditDialog(s.id);
      });
      grid.appendChild(card);
    });
  }

  // ---------- Compare (drag-and-drop, any two scans regardless of boat) ----------

  function renderCompareBox(slot) {
    var box = document.getElementById("compare" + (slot === "left" ? "Left" : "Right") + "Box");
    var scan = compare[slot] ? findScan(compare[slot]) : null;
    if (!scan) {
      box.innerHTML = "<div class='compare-drop__empty'>Drag a photo here</div>";
      return;
    }
    box.innerHTML =
      "<button type='button' class='compare-drop__clear' title='Clear'>&times;</button>" +
      "<div class='compare-drop__filled'><img src='" + scan.file + "' alt=''>" +
      "<div class='compare-drop__caption'>" + BOAT_LABEL[scan.boat] + " · " + scanCaption(scan) + "</div></div>";
    box.querySelector(".compare-drop__clear").addEventListener("click", function () {
      compare[slot] = null;
      renderCompareBox(slot);
      renderOverlay();
      renderMetricCharts();
    });
  }

  function renderCompareBoxes() {
    renderCompareBox("left");
    renderCompareBox("right");
  }

  ["left", "right"].forEach(function (slot) {
    var box = document.getElementById("compare" + (slot === "left" ? "Left" : "Right") + "Box");
    box.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      box.classList.add("is-dragover");
    });
    box.addEventListener("dragleave", function () { box.classList.remove("is-dragover"); });
    box.addEventListener("drop", function (e) {
      e.preventDefault();
      box.classList.remove("is-dragover");
      var id = e.dataTransfer.getData("text/plain");
      if (!id || !findScan(id)) return;
      compare[slot] = id;
      renderCompareBox(slot);
      renderOverlay();
      renderMetricCharts();
    });
  });

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
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function renderOverlay() {
    var g = compare.left ? findScan(compare.left) : null; // base, underneath
    var a = compare.right ? findScan(compare.right) : null; // overlay, on top
    var wrap = document.getElementById("overlayStage");
    var note = document.getElementById("overlayNote");

    if (!a || !g) {
      wrap.innerHTML = "<div class='scan-stage__empty'>Drag a scan into both Compare boxes above to overlay them.</div>";
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
          (!g.mast && !a.mast ? "both scans" : (!g.mast ? "the left scan" : "the right scan")) +
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

  function buildMetricChartSvg(seriesList) {
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

  var SLOT_COLOR = { left: "var(--artemis)", right: "var(--gemera)" };

  function renderMetricCharts() {
    var slotsWithScan = ["left", "right"].map(function (slot) {
      var scan = compare[slot] ? findScan(compare[slot]) : null;
      return { slot: slot, scan: scan };
    }).filter(function (b) { return b.scan && b.scan.camber && b.scan.camber.length; });

    METRIC_CHARTS.forEach(function (mc) {
      var container = document.getElementById(mc.id);
      container.innerHTML = "";

      if (!slotsWithScan.length) {
        container.innerHTML = "<div class='metric-chart__title'>" + mc.title + "</div>" +
          "<div class='mchart-empty'>Drag a scan into a Compare box to see " + mc.title.toLowerCase() + ".</div>";
        return;
      }

      var seriesList = slotsWithScan.map(function (b) {
        return {
          label: BOAT_LABEL[b.scan.boat] + " · " + (b.scan.time ? b.scan.time.slice(0, 16).replace("T", " ") : b.scan.id),
          color: SLOT_COLOR[b.slot],
          points: b.scan.camber
            .filter(function (row) { return row[mc.key] !== null && row[mc.key] !== undefined; })
            .map(function (row) { return { h: row.height, v: row[mc.key] }; })
        };
      });

      var legend = "<div class='metric-chart__legend'>" + seriesList.map(function (s) {
        return "<span><i style='background:" + s.color + ";'></i>" + s.label + "</span>";
      }).join("") + "</div>";

      var svg = buildMetricChartSvg(seriesList);
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
    renderCompareBoxes();
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
      if (scan) {
        scan.mast = mast; // optimistic local update so the overlay/stage react immediately
        renderStage(scan.boat);
        renderOverlay();
        if (liveMode) {
          updateDoc(doc(db, COLLECTION, scan.id), { mast: mast }).catch(function (e) {
            console.error("Mast save failed", e);
            alert("Couldn't save mast alignment — check your connection. (" + e.message + ")");
          });
        } else {
          persistLocal();
        }
      }
    }
    document.getElementById("calDialog").classList.add("is-hidden");
  });

  // ---------- Add scan ----------

  var addForm = document.getElementById("addScanForm");
  var photoDataUrl = null;
  var photoFile = null;
  var pendingMast = null;
  var editingScanId = null; // set when the dialog is open in "edit an existing scan" mode

  function resetAddDialogChrome() {
    editingScanId = null;
    document.getElementById("addScanDialogTitle").textContent = "Add scan";
    document.getElementById("addScanSubmitBtn").textContent = "Save scan";
    document.getElementById("addPhotoInput").required = true;
    document.getElementById("addPhotoDrop").classList.remove("is-hidden");
    document.getElementById("editPhotoNote").classList.add("is-hidden");
  }

  function fillCamberRows(camber) {
    var rows = document.querySelectorAll("#camberRows tr");
    rows.forEach(function (tr) {
      tr.querySelectorAll("input").forEach(function (inp) { inp.value = ""; });
    });
    (camber || []).slice(0, rows.length).forEach(function (row, i) {
      var inputs = rows[i].querySelectorAll("input");
      var vals = [row.height, row.camber, row.draft, row.twist, row.entry, row.exit, row.foreCam, row.backCam];
      vals.forEach(function (v, j) { if (inputs[j]) inputs[j].value = (v === null || v === undefined) ? "" : v; });
    });
  }

  function openEditDialog(scanId) {
    var scan = findScan(scanId);
    if (!scan) return;
    addForm.reset();
    editingScanId = scanId;
    photoDataUrl = scan.file;
    photoFile = null;
    pendingMast = scan.mast || null;

    document.getElementById("addScanDialogTitle").textContent = "Edit scan";
    document.getElementById("addScanSubmitBtn").textContent = "Save changes";
    document.getElementById("addPhotoInput").required = false;
    document.getElementById("addPhotoDrop").classList.add("is-hidden");
    document.getElementById("editPhotoNote").classList.remove("is-hidden");

    document.getElementById("addBoat").value = scan.boat || "artemis";
    document.getElementById("addSail").value = scan.sail || "Main";
    document.getElementById("addEvent").value = scan.event || "";
    document.getElementById("addTime").value = scan.time || "";
    document.getElementById("addTack").value = scan.tack || "";
    document.getElementById("addBatten").value = scan.battenLabel || "";
    document.getElementById("addChock").value = (scan.mechanic && scan.mechanic.chockSize) || "";
    document.getElementById("addTws").value = (scan.wind && scan.wind.tws !== undefined && scan.wind.tws !== null) ? scan.wind.tws : "";
    document.getElementById("addTwa").value = (scan.wind && scan.wind.twa !== undefined && scan.wind.twa !== null) ? scan.wind.twa : "";
    document.getElementById("addBsp").value = (scan.boat_ && scan.boat_.bsp !== undefined && scan.boat_.bsp !== null) ? scan.boat_.bsp : "";
    var m = scan.mechanic || {};
    document.getElementById("addForestay").value = (m.forestay !== undefined && m.forestay !== null) ? m.forestay : "";
    document.getElementById("addRake").value = (m.rake !== undefined && m.rake !== null) ? m.rake : "";
    document.getElementById("addTrimtab").value = (m.trimtab !== undefined && m.trimtab !== null) ? m.trimtab : "";
    document.getElementById("addMastSetup").value = (m.mastSetup !== undefined && m.mastSetup !== null) ? m.mastSetup : "";
    document.getElementById("addMainSheetMark").value = (m.mainSheetMark !== undefined && m.mainSheetMark !== null) ? m.mainSheetMark : "";
    fillCamberRows(scan.camber);

    document.getElementById("addMastStatus").textContent = scan.mast ? "Set" : "Not set";
    document.getElementById("addMastBtn").disabled = false;
    setOcrStatus("");
    document.getElementById("addScanDialog").classList.remove("is-hidden");
  }

  document.getElementById("addPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    photoFile = file;
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

  function numOrNull(id) {
    var v = document.getElementById(id).value;
    return v === "" ? null : Number(v);
  }

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var isEdit = !!editingScanId;
    if (!isEdit && !photoFile) { alert("Choose a photo first."); return; }

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

    var id = isEdit ? editingScanId : (document.getElementById("addBoat").value + "-" + Date.now().toString(36));
    var scan = {
      id: id,
      boat: document.getElementById("addBoat").value,
      sail: document.getElementById("addSail").value,
      event: document.getElementById("addEvent").value.trim(),
      file: isEdit ? findScan(editingScanId).file : photoDataUrl, // edit keeps the existing photo; replaced with the Storage URL below when adding live
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

    var submitBtn = document.getElementById("addScanSubmitBtn");
    submitBtn.disabled = true;

    function finishSave(finalScan) {
      submitBtn.disabled = false;
      addForm.reset();
      photoDataUrl = null;
      photoFile = null;
      pendingMast = null;
      document.getElementById("addMastStatus").textContent = "Not set";
      document.getElementById("addMastBtn").disabled = true;
      setOcrStatus("");
      resetAddDialogChrome();
      document.getElementById("addScanDialog").classList.add("is-hidden");
      if (!liveMode) {
        var idx = scans.findIndex(function (s) { return s.id === finalScan.id; });
        if (idx === -1) scans.push(finalScan); else scans[idx] = finalScan;
        persistLocal();
        renderAll();
      }
      // in live mode, the onSnapshot listener delivers the change and re-renders itself
    }

    if (isEdit) {
      submitBtn.textContent = "Saving…";
      if (liveMode) {
        setDoc(doc(db, COLLECTION, id), scan).then(function () {
          finishSave(scan);
        }).catch(function (e) {
          console.error("Save changes failed", e);
          submitBtn.disabled = false;
          submitBtn.textContent = "Save changes";
          alert("Couldn't save these changes — check your connection. (" + e.message + ")");
        });
      } else {
        finishSave(scan);
      }
      return;
    }

    if (liveMode) {
      submitBtn.textContent = "Uploading photo…";
      var extMatch = photoFile.name && photoFile.name.match(/\.[a-zA-Z0-9]+$/);
      var ext = extMatch ? extMatch[0] : ".jpg";
      var sref = storageRef(storage, "sail-shots/" + id + ext);
      uploadBytes(sref, photoFile).then(function () {
        return getDownloadURL(sref);
      }).then(function (url) {
        scan.file = url;
        submitBtn.textContent = "Saving…";
        return setDoc(doc(db, COLLECTION, id), scan);
      }).then(function () {
        finishSave(scan);
      }).catch(function (e) {
        console.error("Save scan failed", e);
        submitBtn.disabled = false;
        submitBtn.textContent = "Save scan";
        alert("Couldn't save this scan — check your connection. (" + e.message + ")");
      });
    } else {
      finishSave(scan);
    }
  });

  document.getElementById("addScanBtn").addEventListener("click", function () {
    addForm.reset();
    photoDataUrl = null;
    photoFile = null;
    pendingMast = null;
    document.getElementById("addMastStatus").textContent = "Not set";
    document.getElementById("addMastBtn").disabled = true;
    setOcrStatus("");
    resetAddDialogChrome();
    document.getElementById("addScanDialog").classList.remove("is-hidden");
  });
  document.getElementById("addScanClose").addEventListener("click", function () {
    resetAddDialogChrome();
    document.getElementById("addScanDialog").classList.add("is-hidden");
  });

  // ---------- Backup export ----------

  document.getElementById("downloadDataBtn").addEventListener("click", function () {
    var text = "/* RC44 Sail Shots — snapshot exported " + new Date().toISOString() + ". */\n" +
      "window.SAIL_SHOTS = " + JSON.stringify(scans, null, 2) + ";\n";
    var blob = new Blob([text], { type: "text/javascript" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "data.js";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  if (!configured) renderAll();
})();
