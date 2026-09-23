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
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

(function () {
  "use strict";

  var STORAGE_KEY = "rc44-sail-shots-v2"; // local-only fallback cache
  var COLLECTION = "rc44-sail-shots";

  var scans = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
  var liveMode = false;
  var db = null, storage = null;
  // Any number of scans, regardless of boat — feeds the data table, charts and (for the first two
  // filled slots) the overlay. Each entry is a scanId or null for an empty box. Starts with two
  // boxes by default; "+ Add another scan" pushes more slots on demand.
  var compare = { slots: [null, null] };
  var SLOT_COLORS = ["var(--artemis)", "var(--gemera)", "var(--stiff)", "var(--soft)", "var(--accent)", "var(--accent-2)"];
  function slotColor(i) { return SLOT_COLORS[i % SLOT_COLORS.length]; }
  var sailFilter = ""; // "" = all sails; else "Main" | "G1" | "J2" | "J3"
  var teamFilter = ""; // "" = both teams; else "artemis" | "gemera"

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
    populateDropdown("fSailCode", distinctValues(function (s) { return s.sailCode; }));
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
    renderTwsHistogram(twsMin, twsMax);
  }

  // How many scans fall in each TWS bin (ignoring the TWS range itself, so the histogram
  // shows the full spread available under the other active filters — team, sail, date, etc.
  // — as context for picking a range, the same idea as the reference wind-app screenshot).
  function renderTwsHistogram(min, max) {
    var wrap = document.getElementById("twsHistogram");
    if (!wrap) return;
    var binCount = Math.max(1, Math.min(60, Math.round(max - min)));
    var binWidth = (max - min) / binCount;
    var counts = new Array(binCount).fill(0);
    scans.forEach(function (s) {
      if (!passesFilter(s, { skipTws: true })) return;
      var tws = s.wind && s.wind.tws;
      if (tws === null || tws === undefined) return;
      var idx = Math.floor((tws - min) / binWidth);
      if (idx < 0) idx = 0;
      if (idx >= binCount) idx = binCount - 1;
      counts[idx]++;
    });
    var maxCount = Math.max.apply(null, counts.concat([1]));
    wrap.innerHTML = counts.map(function (c) {
      var h = c ? Math.max(6, Math.round((c / maxCount) * 100)) : 0;
      var title = c + " scan" + (c === 1 ? "" : "s");
      return "<div class='tws-histogram__bar' style='height:" + h + "%;' title='" + title + "'></div>";
    }).join("");
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

  function passesFilter(scan, opts) {
    var event = document.getElementById("fEvent").value;
    var sailCode = document.getElementById("fSailCode").value;
    var bsp = document.getElementById("fBsp").value;
    var chock = document.getElementById("fChock").value;
    var mastSetup = document.getElementById("fMastSetup").value;
    var trimtab = document.getElementById("fTrimtab").value;
    var rake = document.getElementById("fRake").value;
    var twsLo = Number(document.getElementById("fTwsLo").value);
    var twsHi = Number(document.getElementById("fTwsHi").value);

    if (event && scan.event !== event) return false;
    if (sailCode && (scan.sailCode || "") !== sailCode) return false;
    if (selectedDates !== null && !selectedDates.has(dateOf(scan))) return false;
    if (bsp && String(scan.boat_ && scan.boat_.bsp) !== bsp) return false;
    if (chock && String(scan.mechanic && scan.mechanic.chockSize) !== chock) return false;
    if (mastSetup && String(scan.mechanic && scan.mechanic.mastSetup) !== mastSetup) return false;
    if (trimtab && String(scan.mechanic && scan.mechanic.trimtab) !== trimtab) return false;
    if (rake && String(scan.mechanic && scan.mechanic.rake) !== rake) return false;
    if (sailFilter && (scan.sail || "Main") !== sailFilter) return false;
    if (teamFilter && scan.boat !== teamFilter) return false;

    if (!(opts && opts.skipTws)) {
      var tws = scan.wind ? scan.wind.tws : null;
      if (tws !== null && tws !== undefined && (tws < twsLo || tws > twsHi)) return false;
    }

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

  document.querySelectorAll("#teamToggle .view-toggle__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      teamFilter = btn.dataset.team;
      document.querySelectorAll("#teamToggle .view-toggle__btn").forEach(function (b) {
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
    teamFilter = "";
    datesInitialized = false; // re-defaults to "most recent day only" on next render
    document.querySelectorAll("#sailToggle .view-toggle__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.sail === "");
    });
    document.querySelectorAll("#teamToggle .view-toggle__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.team === "");
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
    if (scan.sail) bits.push(scan.sail + (scan.sailCode ? " (" + scan.sailCode + ")" : ""));
    if (scan.wind && scan.wind.tws !== undefined && scan.wind.tws !== null) bits.push(scan.wind.tws + "kn TWS");
    if (scan.battenLabel) bits.push(scan.battenLabel);
    return bits.join(" · ");
  }

  function renderCatalogAll() {
    var grid = document.getElementById("catalog-all");
    grid.innerHTML = "";
    var matches = scans.filter(passesFilter);
    matches.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });

    if (!matches.length) {
      grid.innerHTML = "<div class='scan-stage__empty' style='padding:24px;'>No scans match the current filters.</div>";
      return;
    }

    matches.forEach(function (s) {
      var card = document.createElement("button");
      card.type = "button";
      var isActive = compare.slots.indexOf(s.id) !== -1;
      card.className = "thumb" + (isActive ? " thumb--active" : "");
      card.draggable = true;
      var dotClass = s.boat === "gemera" ? "boat-dot--gemera" : "boat-dot--artemis";
      card.innerHTML =
        "<span class='boat-dot " + dotClass + "' style='position:absolute; top:6px; left:6px; z-index:2;'></span>" +
        "<img src='" + s.file + "' alt=''><span>" + scanCaption(s) + "</span>" +
        "<button type='button' class='thumb__edit' title='Edit this scan'>&#9998;</button>";
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
      // Click pops the scan open in a quick-look dialog (photo, data, graphs) that closes fast
      // (Close button, backdrop click, or Esc). Dragging still fills the Compare boxes below.
      card.addEventListener("click", function () {
        openScanPreview(s.id);
      });
      grid.appendChild(card);
    });
  }

  // ---------- Compare (drag-and-drop, any number of scans regardless of boat) ----------
  // The grid is rebuilt from compare.slots each time a box changes — the slot count is dynamic
  // ("+ Add another scan"), so the boxes can't be static HTML the way a fixed left/right pair was.

  var MIN_COMPARE_SLOTS = 2;
  var MAX_COMPARE_SLOTS = 8;

  function wireCompareDropBox(box, index) {
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
      compare.slots[index] = id;
      updateCompareSlots();
    });
  }

  function renderCompareBoxes() {
    var grid = document.getElementById("compareDropGrid");
    grid.innerHTML = "";
    compare.slots.forEach(function (scanId, index) {
      var scan = scanId ? findScan(scanId) : null;
      var box = document.createElement("div");
      box.className = "compare-drop compare-drop--sm";
      box.dataset.slot = index;
      var canRemoveBox = compare.slots.length > MIN_COMPARE_SLOTS;

      if (!scan) {
        box.innerHTML = (canRemoveBox ? "<button type='button' class='compare-drop__clear' title='Remove this box'>&times;</button>" : "") +
          "<div class='compare-drop__empty'>Drag a photo here</div>";
        if (canRemoveBox) {
          box.querySelector(".compare-drop__clear").addEventListener("click", function () {
            compare.slots.splice(index, 1);
            updateCompareSlots();
          });
        }
      } else {
        box.style.borderColor = slotColor(index);
        box.innerHTML =
          "<button type='button' class='compare-drop__clear' title='" + (canRemoveBox ? "Remove this box" : "Clear") + "'>&times;</button>" +
          "<div class='compare-drop__filled'><img src='" + scan.file + "' alt=''>" +
          "<div class='compare-drop__caption'>" + BOAT_LABEL[scan.boat] + " · " + scanCaption(scan) + "</div></div>";
        box.querySelector(".compare-drop__clear").addEventListener("click", function () {
          if (canRemoveBox) compare.slots.splice(index, 1);
          else compare.slots[index] = null;
          updateCompareSlots();
        });
      }
      wireCompareDropBox(box, index);
      grid.appendChild(box);
    });

    document.getElementById("compareAddSlotBtn").classList.toggle("is-hidden", compare.slots.length >= MAX_COMPARE_SLOTS);
  }

  function updateCompareSlots() {
    renderCompareBoxes();
    renderCompareData();
    renderOverlay();
    renderMetricCharts();
    renderCatalogAll(); // refresh thumb--active highlighting on whichever scan(s) are in Compare
  }

  document.getElementById("compareAddSlotBtn").addEventListener("click", function () {
    if (compare.slots.length >= MAX_COMPARE_SLOTS) return;
    compare.slots.push(null);
    updateCompareSlots();
  });

  // ---------- Stage (compare data — both slots' fields aligned side by side) ----------

  // One row per field, one column per filled Compare slot — so the same field for both
  // scans sits on the same line and is easy to read across, instead of two separate blocks
  // you have to match up by eye.
  var FIELD_DEFS = [
    { label: "Event", get: function (s) { return s.event || "—"; } },
    { label: "Sail", get: function (s) { return s.sail || "—"; } },
    { label: "Sail code", get: function (s) { return s.sailCode || "—"; } },
    { label: "Time", get: function (s) { return s.time ? s.time.replace("T", " ") : "—"; } },
    { label: "Batten", get: function (s) { return s.battenLabel || "—"; } },
    { label: "Tack", get: function (s) { return s.tack || "—"; } },
    { label: "TWS", get: function (s) { return (s.wind && s.wind.tws !== undefined && s.wind.tws !== null) ? s.wind.tws + " kn" : "—"; } },
    { label: "TWA", get: function (s) { return (s.wind && s.wind.twa !== undefined && s.wind.twa !== null) ? s.wind.twa + "°" : "—"; } },
    { label: "BSP", get: function (s) { return (s.boat_ && s.boat_.bsp !== undefined && s.boat_.bsp !== null) ? s.boat_.bsp + " kn" : "—"; } },
    { label: "Forestay", get: function (s) { var m = s.mechanic || {}; return (m.forestay !== undefined && m.forestay !== null) ? m.forestay : "—"; } },
    { label: "Rake", get: function (s) { var m = s.mechanic || {}; return (m.rake !== undefined && m.rake !== null) ? m.rake : "—"; } },
    { label: "Trim tab", get: function (s) { var m = s.mechanic || {}; return (m.trimtab !== undefined && m.trimtab !== null) ? m.trimtab : "—"; } },
    { label: "Mast setup", get: function (s) { var m = s.mechanic || {}; return (m.mastSetup !== undefined && m.mastSetup !== null) ? m.mastSetup : "—"; } },
    { label: "Main sheet mark", get: function (s) { var m = s.mechanic || {}; return (m.mainSheetMark !== undefined && m.mainSheetMark !== null) ? m.mainSheetMark : "—"; } },
    { label: "Chock size", get: function (s) { var m = s.mechanic || {}; return m.chockSize || "—"; } },
    { label: "Mast aligned", get: function (s) { return s.mast ? (s.mast2 ? "Yes (2-axis)" : "Yes") : "Not set"; } }
  ];
  var CAMBER_HEIGHTS = [25, 50, 75, 87];
  var CAMBER_METRICS = [
    ["camber", "Camber"], ["draft", "Draft"], ["twist", "Twist"], ["entry", "Entry"],
    ["exit", "Exit"], ["foreCam", "Fore cam"], ["backCam", "Back cam"]
  ];

  // ---------- Flying shape targets (Aug-25) ----------
  // From the team's target tables: one set for the jib (applies to G1/J2/J3), one for the
  // mainsail, each given at 25/50/75% height and in 2kn TWS bins from 6 to 20kn. Same one-design
  // targets apply to both boats. Only camber/draft/foreCam/backCam have target data — twist/entry/
  // exit have no target to compare against.
  var TARGET_BINS = [6, 8, 10, 12, 14, 16, 18, 20];
  var TARGET_HEIGHTS = [25, 50, 75];
  var FLYING_SHAPE_TARGETS = {
    jib: {
      6: { 25: { camber: 10.6, draft: 38.0, foreCam: 83.1, backCam: 72.0 }, 50: { camber: 13.6, draft: 36.6, foreCam: 80.0, backCam: 68.0 }, 75: { camber: 13.2, draft: 38.9, foreCam: 76.0, backCam: 68.0 } },
      8: { 25: { camber: 10.4, draft: 37.2, foreCam: 82.7, backCam: 71.3 }, 50: { camber: 13.1, draft: 36.1, foreCam: 79.9, backCam: 68.0 }, 75: { camber: 12.4, draft: 38.6, foreCam: 76.0, backCam: 67.9 } },
      10: { 25: { camber: 10.1, draft: 36.4, foreCam: 82.3, backCam: 70.7 }, 50: { camber: 12.5, draft: 35.6, foreCam: 79.8, backCam: 68.1 }, 75: { camber: 11.6, draft: 38.3, foreCam: 76.1, backCam: 67.8 } },
      12: { 25: { camber: 9.9, draft: 35.6, foreCam: 81.9, backCam: 70.0 }, 50: { camber: 12.0, draft: 35.2, foreCam: 79.7, backCam: 68.1 }, 75: { camber: 10.8, draft: 38.0, foreCam: 76.1, backCam: 67.7 } },
      14: { 25: { camber: 9.6, draft: 34.7, foreCam: 81.5, backCam: 69.3 }, 50: { camber: 11.5, draft: 34.7, foreCam: 79.5, backCam: 68.1 }, 75: { camber: 10.0, draft: 37.6, foreCam: 76.1, backCam: 67.5 } },
      16: { 25: { camber: 9.4, draft: 33.9, foreCam: 81.1, backCam: 68.7 }, 50: { camber: 10.9, draft: 34.2, foreCam: 79.4, backCam: 68.2 }, 75: { camber: 9.2, draft: 37.3, foreCam: 76.2, backCam: 67.4 } },
      18: { 25: { camber: 9.1, draft: 33.1, foreCam: 80.7, backCam: 68.0 }, 50: { camber: 10.4, draft: 33.7, foreCam: 79.3, backCam: 68.2 }, 75: { camber: 8.4, draft: 37.0, foreCam: 76.2, backCam: 67.3 } },
      20: { 25: { camber: 8.9, draft: 32.3, foreCam: 80.3, backCam: 67.3 }, 50: { camber: 9.9, draft: 33.2, foreCam: 79.2, backCam: 68.2 }, 75: { camber: 7.6, draft: 36.7, foreCam: 76.2, backCam: 67.2 } }
    },
    main: {
      6: { 25: { camber: 8.3, draft: 45.5, foreCam: 71.8, backCam: 68.5 }, 50: { camber: 9.4, draft: 43.5, foreCam: 72.8, backCam: 68.8 }, 75: { camber: 8.3, draft: 41.4, foreCam: 75.6, backCam: 69.5 } },
      8: { 25: { camber: 8.0, draft: 46.5, foreCam: 71.7, backCam: 68.5 }, 50: { camber: 8.9, draft: 45.3, foreCam: 71.8, backCam: 69.3 }, 75: { camber: 7.6, draft: 43.5, foreCam: 73.2, backCam: 70.1 } },
      10: { 25: { camber: 7.6, draft: 47.5, foreCam: 71.5, backCam: 68.6 }, 50: { camber: 8.3, draft: 47.0, foreCam: 70.8, backCam: 69.8 }, 75: { camber: 6.8, draft: 45.6, foreCam: 70.8, backCam: 70.6 } },
      12: { 25: { camber: 7.3, draft: 48.5, foreCam: 71.4, backCam: 68.6 }, 50: { camber: 7.8, draft: 48.8, foreCam: 69.8, backCam: 70.4 }, 75: { camber: 6.1, draft: 47.7, foreCam: 68.5, backCam: 71.2 } },
      14: { 25: { camber: 7.0, draft: 49.5, foreCam: 71.3, backCam: 68.6 }, 50: { camber: 7.3, draft: 50.5, foreCam: 68.8, backCam: 70.9 }, 75: { camber: 5.3, draft: 49.8, foreCam: 66.1, backCam: 71.7 } },
      16: { 25: { camber: 6.6, draft: 50.5, foreCam: 71.1, backCam: 68.7 }, 50: { camber: 6.7, draft: 52.3, foreCam: 67.8, backCam: 71.4 }, 75: { camber: 4.6, draft: 51.9, foreCam: 63.7, backCam: 72.3 } },
      18: { 25: { camber: 6.3, draft: 51.5, foreCam: 71.0, backCam: 68.7 }, 50: { camber: 6.2, draft: 54.0, foreCam: 66.8, backCam: 71.9 }, 75: { camber: 3.8, draft: 54.0, foreCam: 61.3, backCam: 72.8 } },
      20: { 25: { camber: 6.0, draft: 52.5, foreCam: 70.9, backCam: 68.7 }, 50: { camber: 5.7, draft: 55.8, foreCam: 65.8, backCam: 72.4 }, 75: { camber: 3.1, draft: 56.1, foreCam: 58.9, backCam: 73.4 } }
    }
  };

  function targetGroupFor(sail) {
    return sail === "Main" ? "main" : "jib";
  }

  // Interpolates a target value for a scan's actual TWS between the two nearest 2kn bins
  // (6..20kn). Returns null when there's nothing to compare against (no TWS, a metric/height
  // with no target data, or TWS entirely outside the 6-20kn target range). Same targets apply
  // to both boats.
  function getTarget(scan, height, metricKey) {
    if (!scan) return null;
    if (!scan.wind || scan.wind.tws === undefined || scan.wind.tws === null) return null;
    var table = FLYING_SHAPE_TARGETS[targetGroupFor(scan.sail || "Main")];
    if (!table) return null;
    var tws = scan.wind.tws;
    if (tws < TARGET_BINS[0] || tws > TARGET_BINS[TARGET_BINS.length - 1]) return null;
    var lo = TARGET_BINS[0], hi = TARGET_BINS[TARGET_BINS.length - 1];
    for (var i = 0; i < TARGET_BINS.length - 1; i++) {
      if (tws >= TARGET_BINS[i] && tws <= TARGET_BINS[i + 1]) { lo = TARGET_BINS[i]; hi = TARGET_BINS[i + 1]; break; }
    }
    var loRow = table[lo] && table[lo][height];
    var hiRow = table[hi] && table[hi][height];
    if (!loRow || !hiRow) return null;
    var loV = loRow[metricKey], hiV = hiRow[metricKey];
    if (loV === undefined || loV === null || hiV === undefined || hiV === null) return null;
    var frac = hi === lo ? 0 : (tws - lo) / (hi - lo);
    return Math.round((loV + (hiV - loV) * frac) * 10) / 10;
  }

  // Builds the dotted-line target series (25/50/75% only) for a metric chart, or null if the
  // metric/scan has no target data.
  function targetSeriesForScan(scan, metricKey) {
    var pts = TARGET_HEIGHTS.map(function (h) {
      var v = getTarget(scan, h, metricKey);
      return v === null ? null : { h: h, v: v };
    }).filter(function (p) { return p; });
    if (!pts.length) return null;
    return { color: "var(--stiff)", points: pts };
  }

  // Renders a camber-table metric as two aligned columns: the OCR'd value, then its own
  // "Tgt" column with the interpolated target (or — when there's nothing to compare against).
  function camberCellsHtml(scan, height, metricKey, value) {
    var valText = (value === null || value === undefined) ? "—" : value;
    var t = (value === null || value === undefined) ? null : getTarget(scan, height, metricKey);
    var tText = t === null ? "—" : t;
    return "<td>" + valText + "</td><td class='target-col'>" + tText + "</td>";
  }

  // Two-row sub-header for a metric's value + Tgt columns.
  function camberMetricHeadHtml(label) {
    return "<th colspan='2'>" + label + "</th>";
  }
  function camberMetricSubheadHtml() {
    return "<th></th><th class='target-col'>Tgt</th>";
  }

  // A short label for a compare column header — boat name, plus the time when more than one
  // filled slot shares a boat (comparing several scans off the same boat is now possible with
  // more than two slots, so the boat name alone can be ambiguous).
  function slotHeaderLabel(b, allSlots) {
    var boatLabel = BOAT_LABEL[b.scan.boat] || b.scan.boat;
    var sameBoatCount = allSlots.filter(function (o) { return o.scan.boat === b.scan.boat; }).length;
    if (sameBoatCount < 2) return boatLabel;
    var time = b.scan.time ? b.scan.time.slice(0, 16).replace("T", " ") : "";
    return boatLabel + (time ? " · " + time : "");
  }

  function renderCompareData() {
    var container = document.getElementById("compareData");
    var slots = compare.slots
      .map(function (scanId, index) { return { index: index, scan: scanId ? findScan(scanId) : null }; })
      .filter(function (b) { return b.scan; });

    if (!slots.length) {
      container.innerHTML = "<div class='scan-stage__empty'>Drag a scan into a Compare box above to see its details here.</div>";
      return;
    }

    var photosHtml = "<div class='compare-detail-grid'>" + slots.map(function (b) {
      var dotClass = b.scan.boat === "gemera" ? "boat-dot--gemera" : "boat-dot--artemis";
      return "<div>" +
        "<div class='split-col__head'><span class='boat-dot " + dotClass + "' style='background:" + slotColor(b.index) + ";'></span><h2>" + slotHeaderLabel(b, slots) + "</h2></div>" +
        "<div class='scan-stage'><img src='" + b.scan.file + "' alt='" + (BOAT_LABEL[b.scan.boat] || b.scan.boat) + " sail scan'></div>" +
        "<button type='button' class='text-link compare-detail__calbtn' data-index='" + b.index + "' style='margin-top:10px;'>Set / edit mast alignment</button>" +
        "</div>";
    }).join("") + "</div>";

    var dataHtml = "<table class='compare-table' style='margin-top:20px;'><thead><tr><th>Field</th>" +
      slots.map(function (b) { return "<th>" + slotHeaderLabel(b, slots) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      FIELD_DEFS.map(function (f) {
        return "<tr><td>" + f.label + "</td>" + slots.map(function (b) { return "<td>" + f.get(b.scan) + "</td>"; }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";

    var camberHtml = "";
    if (slots.some(function (b) { return b.scan.camber && b.scan.camber.length; })) {
      var headRow1 = "<th rowspan='3'>Height</th>" + slots.map(function (b) {
        return "<th colspan='" + (CAMBER_METRICS.length * 2) + "'>" + slotHeaderLabel(b, slots) + "</th>";
      }).join("");
      var headRow2 = slots.map(function () {
        return CAMBER_METRICS.map(function (m) { return camberMetricHeadHtml(m[1]); }).join("");
      }).join("");
      var headRow3 = slots.map(function () {
        return CAMBER_METRICS.map(function () { return camberMetricSubheadHtml(); }).join("");
      }).join("");
      var bodyRows = CAMBER_HEIGHTS.map(function (h) {
        var rowCells = slots.map(function (b) {
          var row = (b.scan.camber || []).filter(function (r) { return r.height === h; })[0];
          return CAMBER_METRICS.map(function (m) {
            var v = row ? row[m[0]] : null;
            return camberCellsHtml(b.scan, h, m[0], v);
          }).join("");
        }).join("");
        return "<tr><td>" + h + "%</td>" + rowCells + "</tr>";
      }).join("");
      camberHtml = "<table class='compare-table compare-table--tgt' style='margin-top:20px;'><thead><tr>" + headRow1 + "</tr><tr>" + headRow2 + "</tr><tr>" + headRow3 + "</tr></thead><tbody>" + bodyRows + "</tbody></table>";
    }

    container.innerHTML = photosHtml + dataHtml + camberHtml;
    container.querySelectorAll(".compare-detail__calbtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var scanId = compare.slots[Number(btn.dataset.index)];
        var scan = scanId ? findScan(scanId) : null;
        if (scan) openMastCalibrator(scan.id);
      });
    });
  }

  // ---------- Scan preview (pop-out) — click a thumbnail for a quick look, closes fast ----------

  var scanPreviewId = null;

  function buildSingleScanCharts(scan) {
    if (!scan.camber || !scan.camber.length) return "";
    var html = "<div class='metric-chart-grid' style='margin-top:20px;'>";
    METRIC_CHARTS.forEach(function (mc) {
      var points = scan.camber
        .filter(function (row) { return row[mc.key] !== null && row[mc.key] !== undefined; })
        .map(function (row) { return { h: row.height, v: row[mc.key] }; });
      var targetSeries = targetSeriesForScan(scan, mc.key);
      var svg = points.length ? buildMetricChartSvg([{ color: "var(--accent)", points: points }], targetSeries ? [targetSeries] : []) : null;
      html += "<div class='metric-chart'><div class='metric-chart__title'>" + mc.title + "</div>" +
        (svg || "<div class='mchart-empty'>No data.</div>") + "</div>";
    });
    html += "</div>";
    return html;
  }

  function openScanPreview(scanId) {
    var scan = findScan(scanId);
    if (!scan) return;
    scanPreviewId = scanId;

    var dotClass = scan.boat === "gemera" ? "boat-dot--gemera" : "boat-dot--artemis";
    document.getElementById("scanPreviewTitle").innerHTML =
      "<span class='boat-dot " + dotClass + "' style='display:inline-block; vertical-align:middle; margin-right:8px;'></span>" +
      (BOAT_LABEL[scan.boat] || scan.boat);

    var html = "<div class='scan-stage' style='margin-top:4px;'><img src='" + scan.file + "' alt='" + (BOAT_LABEL[scan.boat] || scan.boat) + " sail scan'></div>";
    html += "<div style='display:flex; gap:14px; flex-wrap:wrap;'>";
    html += "<button type='button' id='scanPreviewCalBtn' class='text-link' style='margin-top:10px;'>Set / edit mast alignment</button>";
    html += "<button type='button' id='scanPreviewLeechBtn' class='text-link' style='margin-top:10px;'>Set / edit leech line</button>";
    html += "<button type='button' id='scanPreviewOverlayBtn' class='text-link' style='margin-top:10px;'>Show camber overlay</button>";
    html += "</div>";

    html += "<table class='compare-table' style='margin-top:16px;'><tbody>" +
      FIELD_DEFS.map(function (f) { return "<tr><td>" + f.label + "</td><td>" + f.get(scan) + "</td></tr>"; }).join("") +
      "</tbody></table>";

    if (scan.camber && scan.camber.length) {
      html += "<table class='compare-table compare-table--tgt' style='margin-top:16px;'><thead><tr><th rowspan='2'>Height</th>" +
        CAMBER_METRICS.map(function (m) { return camberMetricHeadHtml(m[1]); }).join("") + "</tr><tr>" +
        CAMBER_METRICS.map(function () { return camberMetricSubheadHtml(); }).join("") + "</tr></thead><tbody>" +
        CAMBER_HEIGHTS.map(function (h) {
          var row = scan.camber.filter(function (r) { return r.height === h; })[0];
          return "<tr><td>" + h + "%</td>" + CAMBER_METRICS.map(function (m) {
            var v = row ? row[m[0]] : null;
            return camberCellsHtml(scan, h, m[0], v);
          }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }

    html += buildSingleScanCharts(scan);

    document.getElementById("scanPreviewBody").innerHTML = html;
    document.getElementById("scanPreviewCalBtn").addEventListener("click", function () {
      // Hide the preview while calibrating — both dialogs share a z-index, so leaving it up
      // would sit on top of (and block) the mast-alignment dialog. Restored on close/save.
      document.getElementById("scanPreviewDialog").classList.add("is-hidden");
      openMastCalibrator(scan.id);
    });
    document.getElementById("scanPreviewLeechBtn").addEventListener("click", function () {
      document.getElementById("scanPreviewDialog").classList.add("is-hidden");
      openLeechDialog(scan.id);
    });
    var overlayOn = false;
    document.getElementById("scanPreviewOverlayBtn").addEventListener("click", function () {
      overlayOn = !overlayOn;
      this.textContent = overlayOn ? "Hide camber overlay" : "Show camber overlay";
      if (overlayOn) {
        if (!scan.mast || !scan.leech) {
          alert("Set both mast alignment and the leech line first — the overlay needs both to know where each height's chord runs.");
          overlayOn = false;
          this.textContent = "Show camber overlay";
          return;
        }
        renderCamberOverlay(scan);
      } else {
        removeCamberOverlay();
      }
    });
    document.getElementById("scanPreviewDialog").classList.remove("is-hidden");
  }

  // ---------- Camber-table overlay ----------
  // Draws the chord + camber curve implied by the numbers already sitting in the camber table
  // back onto the scan photo, as a visual sanity check — the inverse of stripe detection: here
  // the numbers are known and we're drawing where they say the draft should be.
  function hermite(p0, m0, p1, m1, u) {
    var u2 = u * u, u3 = u2 * u;
    var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  }

  function heightPointNat(axis, heightPct, natW, natH) {
    // axis = { x1,y1 (top/head, 100%), x2,y2 (base/clew, 0%) } in xf/yf fractions.
    var f = heightPct / 100;
    return { x: (axis.x2 + (axis.x1 - axis.x2) * f) * natW, y: (axis.y2 + (axis.y1 - axis.y2) * f) * natH };
  }

  function buildCamberCurveNat(luffNat, leechNat, camberPct, draftPct, entryDeg, exitDeg) {
    var cvx = leechNat.x - luffNat.x, cvy = leechNat.y - luffNat.y;
    var chordLen = Math.sqrt(cvx * cvx + cvy * cvy);
    if (chordLen < 1e-6) return null;
    var px = -(cvy / chordLen), py = (cvx / chordLen); // perpendicular unit vector
    var devFrac = Math.min(0.95, Math.max(0.05, (draftPct || 0) / 100));
    var maxDevFrac = (camberPct || 0) / 100;
    var slopeEntry = Math.tan((entryDeg || 0) * Math.PI / 180);
    var slopeExit = Math.tan((exitDeg || 0) * Math.PI / 180);
    var steps = 16, pts = [];
    for (var i = 0; i <= steps; i++) {
      var u = i / steps;
      pts.push({ t: u * devFrac, d: hermite(0, slopeEntry * devFrac, maxDevFrac, 0, u) });
    }
    var l2 = 1 - devFrac;
    for (var j = 1; j <= steps; j++) {
      var u2 = j / steps;
      pts.push({ t: devFrac + u2 * l2, d: hermite(maxDevFrac, 0, 0, slopeExit * l2, u2) });
    }
    return pts.map(function (p) {
      return { x: luffNat.x + p.t * cvx + p.d * chordLen * px, y: luffNat.y + p.t * cvy + p.d * chordLen * py };
    });
  }

  function removeCamberOverlay() {
    var existing = document.querySelector("#scanPreviewBody .camber-overlay-svg");
    if (existing) existing.remove();
  }

  function renderCamberOverlay(scan) {
    removeCamberOverlay();
    var stage = document.querySelector("#scanPreviewBody .scan-stage");
    if (!stage) return;
    var img = stage.querySelector("img");
    if (!img || !scan.camber || !scan.camber.length) return;

    function draw() {
      var w = img.clientWidth, h = img.clientHeight, natW = img.naturalWidth, natH = img.naturalHeight;
      if (!w || !h || !natW || !natH) return;
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cal-svg camber-overlay-svg");
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      stage.appendChild(svg);
      scan.camber.forEach(function (row) {
        if (row.camber === null || row.camber === undefined || row.draft === null || row.draft === undefined) return;
        var luffNat = heightPointNat(scan.mast, row.height, natW, natH);
        var leechNat = heightPointNat(scan.leech, row.height, natW, natH);
        var curveNat = buildCamberCurveNat(luffNat, leechNat, row.camber, row.draft, row.entry || 0, row.exit || 0);
        if (!curveNat) return;
        function toDisp(p) { return (p.x / natW * w) + "," + (p.y / natH * h); }
        var chord = document.createElementNS(svg.namespaceURI, "line");
        chord.setAttribute("x1", luffNat.x / natW * w); chord.setAttribute("y1", luffNat.y / natH * h);
        chord.setAttribute("x2", leechNat.x / natW * w); chord.setAttribute("y2", leechNat.y / natH * h);
        chord.setAttribute("class", "camber-overlay-chord");
        svg.appendChild(chord);
        var poly = document.createElementNS(svg.namespaceURI, "polyline");
        poly.setAttribute("points", curveNat.map(toDisp).join(" "));
        poly.setAttribute("class", "camber-overlay-curve");
        svg.appendChild(poly);
        var t = document.createElementNS(svg.namespaceURI, "text");
        t.setAttribute("x", luffNat.x / natW * w - 6); t.setAttribute("y", luffNat.y / natH * h + 4);
        t.setAttribute("class", "camber-overlay-label");
        t.setAttribute("text-anchor", "end");
        t.textContent = row.height + "%";
        svg.appendChild(t);
      });
    }
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener("load", draw, { once: true });
  }

  function closeScanPreview() {
    scanPreviewId = null;
    document.getElementById("scanPreviewDialog").classList.add("is-hidden");
  }

  document.getElementById("scanPreviewClose").addEventListener("click", closeScanPreview);
  document.querySelector("#scanPreviewDialog .dialog__backdrop").addEventListener("click", closeScanPreview);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !document.getElementById("scanPreviewDialog").classList.contains("is-hidden")) {
      closeScanPreview();
    }
  });

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

  // The "on top" <img> currently in the overlay stage, kept around so the opacity slider can
  // update it directly (see updateOverlayOpacity) instead of triggering a full rebuild on every
  // drag tick — rebuilding cleared and reloaded both images each time, which flashed.
  var overlayImgEl = null;

  function updateOverlayOpacity() {
    if (!overlayImgEl) return;
    overlayImgEl.style.opacity = document.getElementById("overlayOpacity").value / 100;
  }

  function renderOverlay() {
    // The overlay is inherently a two-image comparison (base underneath, one overlay on top with
    // an opacity slider), so with more than two Compare boxes filled it just uses the first two,
    // in box order — the rest still drive the data table and charts above.
    var filledIds = compare.slots.filter(function (id) { return id; });
    var g = filledIds[0] ? findScan(filledIds[0]) : null; // base, underneath
    var a = filledIds[1] ? findScan(filledIds[1]) : null; // overlay, on top
    var wrap = document.getElementById("overlayStage");
    var note = document.getElementById("overlayNote");
    overlayImgEl = null;

    if (!a || !g) {
      wrap.innerHTML = "<div class='scan-stage__empty'>Drag a scan into two Compare boxes above to overlay them.</div>";
      note.textContent = "";
      return;
    }

    wrap.innerHTML = "";
    var stageW = wrap.clientWidth || 640;
    var stageH = 480;
    wrap.style.height = stageH + "px";
    var extraNote = filledIds.length > 2 ? " Showing the first two of " + filledIds.length + " selected scans." : "";

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
      overlayImgEl = overlayEl;

      if (g.mast && a.mast) {
        // Base mast points, in stage pixel space.
        var q1 = { x: offsetX + g.mast.x1 * renderedW, y: offsetY + g.mast.y1 * renderedH };
        var q2 = { x: offsetX + g.mast.x2 * renderedW, y: offsetY + g.mast.y2 * renderedH };
        // Overlay mast points, in the overlay image's own natural pixel space.
        var p1 = { x: a.mast.x1 * aImg.naturalWidth, y: a.mast.y1 * aImg.naturalHeight };
        var p2 = { x: a.mast.x2 * aImg.naturalWidth, y: a.mast.y2 * aImg.naturalHeight };

        // A single mast line only pins down a similarity transform (one uniform scale + one
        // rotation) — it can't tell a true uniform zoom apart from the photos simply being shot
        // from different distances/angles along the sail's other axis. That's exactly what shows
        // up as "one photo looks more zoomed in" even though the mast itself lines up fine —
        // most often on jib shots, where the two boats/cameras are rarely framed the same way.
        // When a second reference axis is set on both scans (e.g. the boom, or a batten), use it
        // together with the mast to solve a full affine transform — independent scale on each
        // axis plus shear — instead of assuming the same scale applies in every direction.
        if (g.mast2 && a.mast2) {
          var q3 = { x: offsetX + g.mast2.x1 * renderedW, y: offsetY + g.mast2.y1 * renderedH };
          var q4 = { x: offsetX + g.mast2.x2 * renderedW, y: offsetY + g.mast2.y2 * renderedH };
          var p3 = { x: a.mast2.x1 * aImg.naturalWidth, y: a.mast2.y1 * aImg.naturalHeight };
          var p4 = { x: a.mast2.x2 * aImg.naturalWidth, y: a.mast2.y2 * aImg.naturalHeight };

          var v1x = p2.x - p1.x, v1y = p2.y - p1.y; // mast vector, overlay space
          var v2x = p4.x - p3.x, v2y = p4.y - p3.y; // second-axis vector, overlay space
          var w1x = q2.x - q1.x, w1y = q2.y - q1.y; // mast vector, base space
          var w2x = q4.x - q3.x, w2y = q4.y - q3.y; // second-axis vector, base space
          var det = v1x * v2y - v2x * v1y;

          // det collapses to ~0 when the second axis is nearly parallel to the mast — the two
          // points don't add any independent information, so solving for M would blow up the
          // scale in that direction. Fall back to the mast-only similarity transform instead.
          if (Math.abs(det) > 1e-6) {
            var m00 = (w1x * v2y - w2x * v1y) / det;
            var m01 = (w2x * v1x - w1x * v2x) / det;
            var m10 = (w1y * v2y - w2y * v1y) / det;
            var m11 = (w2y * v1x - w1y * v2x) / det;
            var atx = q1.x - (m00 * p1.x + m01 * p1.y);
            var aty = q1.y - (m10 * p1.x + m11 * p1.y);

            overlayEl.style.transform = "matrix(" + m00 + "," + m10 + "," + m01 + "," + m11 + "," + atx + "," + aty + ")";
            note.textContent = "Aligned on the mast + second axis — both scans are 2-axis calibrated." + extraNote;
            note.classList.remove("pill--warn");
            return;
          }
        }

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
        note.textContent = ((g.mast2 || a.mast2)
          ? "Aligned on the mast — add a second axis on both scans for a truer fit on tricky angles."
          : "Aligned on the mast — both scans are mast-calibrated.") + extraNote;
        note.classList.remove("pill--warn");
      } else {
        // No calibration on one or both — best-effort contain-fit, uncorrected.
        var oScale = Math.min(stageW / aImg.naturalWidth, stageH / aImg.naturalHeight);
        overlayEl.style.transform = "translate(" + ((stageW - aImg.naturalWidth * oScale) / 2) + "px," +
          ((stageH - aImg.naturalHeight * oScale) / 2) + "px) scale(" + oScale + ")";
        note.textContent = "Not aligned — set mast alignment on " +
          (!g.mast && !a.mast ? "both scans" : (!g.mast ? "the first scan" : "the second scan")) +
          " for an accurate overlay." + extraNote;
        note.classList.add("pill--warn");
      }
    });
  }

  document.getElementById("overlayOpacity").addEventListener("input", updateOverlayOpacity);
  window.addEventListener("resize", renderOverlay);

  // ---------- Camber / draft / twist mini charts ----------
  // Small hand-rolled SVG line+area charts (no charting library) — one per metric, each boat's
  // selected scan plotted as its own coloured line/fill, on the shared 25/50/75/87% height axis.

  var METRIC_CHARTS = [
    { id: "chart-camber", key: "camber", title: "Camber" },
    { id: "chart-draft", key: "draft", title: "Draft" },
    { id: "chart-twist", key: "twist", title: "Twist" }
  ];
  var BOAT_LABEL = { artemis: "Artemis", gemera: "Gemera" };

  // Picks a "nice" round step (1/2/5 × a power of ten) so y-axis labels read as sensible
  // numbers (0, 5, 10…) rather than raw fractions of the data range.
  function niceTicks(min, max, targetCount) {
    var range = max - min || 1;
    var rawStep = range / Math.max(1, targetCount - 1);
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var norm = rawStep / mag;
    var niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    var step = niceNorm * mag;
    var niceMin = Math.floor(min / step) * step;
    var niceMax = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = niceMin; v <= niceMax + step / 2; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6); // trim float noise
    }
    return ticks;
  }

  function formatTick(v) {
    return Math.abs(v) < 1e-9 ? "0" : String(v);
  }

  function buildMetricChartSvg(seriesList, targetSeriesList) {
    targetSeriesList = targetSeriesList || [];
    var W = 320, H = 160, padL = 40, padR = 10, padT = 10, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var heights = [];
    var values = [];
    seriesList.forEach(function (s) {
      s.points.forEach(function (p) {
        if (heights.indexOf(p.h) === -1) heights.push(p.h);
        values.push(p.v);
      });
    });
    targetSeriesList.forEach(function (s) {
      s.points.forEach(function (p) {
        if (heights.indexOf(p.h) === -1) heights.push(p.h);
        values.push(p.v);
      });
    });
    heights.sort(function (a, b) { return a - b; });
    if (!heights.length || !values.length) return null;

    var hMin = heights[0], hMax = heights[heights.length - 1];
    if (hMax === hMin) hMax = hMin + 1;
    var vMinRaw = Math.min.apply(null, values), vMaxRaw = Math.max.apply(null, values);
    var vPad = (vMaxRaw - vMinRaw) * 0.15 || Math.abs(vMaxRaw || 1) * 0.15 || 1;
    var yTicks = niceTicks(vMinRaw - vPad, vMaxRaw + vPad, 5);
    var vMin = yTicks[0], vMax = yTicks[yTicks.length - 1];

    function x(h) { return padL + (h - hMin) / (hMax - hMin) * plotW; }
    function y(v) { return padT + (1 - (v - vMin) / (vMax - vMin)) * plotH; }

    var svg = "<svg width='" + W + "' height='" + H + "' viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet'>";

    // Y-axis gridlines + numeric scale.
    yTicks.forEach(function (t) {
      var gy = y(t);
      svg += "<line class='mchart-axis' x1='" + padL + "' y1='" + gy + "' x2='" + (padL + plotW) + "' y2='" + gy + "'/>";
      svg += "<text class='mchart-axis-label' x='" + (padL - 6) + "' y='" + (gy + 3) + "' text-anchor='end'>" + formatTick(t) + "</text>";
    });

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

    // Target line(s) — dashed, drawn on top so they're never hidden behind the actual-value fill.
    targetSeriesList.forEach(function (s) {
      var pts = s.points.slice().sort(function (a, b) { return a.h - b.h; });
      if (!pts.length) return;
      var linePath = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + x(p.h) + "," + y(p.v); }).join(" ");
      svg += "<path d='" + linePath + "' fill='none' stroke='" + (s.color || "var(--stiff)") + "' stroke-width='2' stroke-dasharray='5 4'/>";
      pts.forEach(function (p) {
        svg += "<circle cx='" + x(p.h) + "' cy='" + y(p.v) + "' r='2.5' fill='none' stroke='" + (s.color || "var(--stiff)") + "' stroke-width='1.5'/>";
      });
    });

    svg += "</svg>";
    return svg;
  }

  function renderMetricCharts() {
    var slotsWithScan = compare.slots.map(function (scanId, index) {
      var scan = scanId ? findScan(scanId) : null;
      return { index: index, scan: scan };
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
          color: slotColor(b.index),
          points: b.scan.camber
            .filter(function (row) { return row[mc.key] !== null && row[mc.key] !== undefined; })
            .map(function (row) { return { h: row.height, v: row[mc.key] }; })
        };
      });

      var targetSeriesList = slotsWithScan
        .map(function (b) { return targetSeriesForScan(b.scan, mc.key); })
        .filter(function (s) { return s; });

      var legend = "<div class='metric-chart__legend'>" + seriesList.map(function (s) {
        return "<span><i style='background:" + s.color + ";'></i>" + s.label + "</span>";
      }).join("") + (targetSeriesList.length ? "<span><i class='metric-chart__legend-dash'></i>Target</span>" : "") + "</div>";

      var svg = buildMetricChartSvg(seriesList, targetSeriesList);
      container.innerHTML = "<div class='metric-chart__title'>" + mc.title + "</div>" + legend +
        (svg || "<div class='mchart-empty'>No camber-table data on the selected scan(s).</div>");
    });
  }

  function renderAll() {
    refreshFilterOptions();
    renderCatalogAll();
    renderCompareBoxes();
    renderCompareData();
    renderOverlay();
    renderMetricCharts();
  }

  // ---------- Mast calibration dialog ----------

  // cal.points is the primary axis (the mast — top/base). cal.points2 is an optional second,
  // ideally roughly-perpendicular reference line (e.g. the boom, or a batten across the sail).
  // With only the mast set, alignment is a similarity transform (uniform scale + rotate) — fine
  // when both photos are shot from about the same angle. Some pairs (jib shots especially, where
  // the two boats/cameras are rarely lined up the same way) get visibly wrong scale on one axis
  // even with a perfect mast line, because a single line can't tell the transform apart from a
  // non-uniform, two-axis distortion. Adding a second axis gives two independent direction vectors,
  // enough to solve a full affine transform (independent scale + shear per axis) instead.
  var cal = { points: [], points2: [], imgEl: null, scanId: null, onSave: null, dragIndex: -1, dragAxis: 1, activeAxis: 1, suppressNextClick: false };

  function autoDetectMast(imgEl) {
    try {
      var iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
      if (!iw || !ih) return null;
      var cw = 240;
      var ch = Math.round(ih * (cw / iw));
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(imgEl, 0, 0, cw, ch);
      var data;
      try {
        data = ctx.getImageData(0, 0, cw, ch).data;
      } catch (secErr) {
        return null; // cross-origin image; can't inspect pixels
      }

      function luma(x, y) {
        var i = (y * cw + x) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      var minW = Math.max(1, Math.round(cw * 0.006));
      var maxW = Math.max(minW + 1, Math.round(cw * 0.05));
      var candidates = [];
      var prevX = null;

      for (var y = 0; y < ch; y++) {
        // Row brightness stats to pick an adaptive dark threshold.
        var rowVals = [];
        for (var x = 0; x < cw; x++) rowVals.push(luma(x, y));
        var mean = rowVals.reduce(function (a, b) { return a + b; }, 0) / rowVals.length;
        var threshold = mean - 18; // mast reads darker than its surroundings

        // Find dark runs of plausible mast width.
        var runs = [];
        var runStart = -1;
        for (var xi = 0; xi <= cw; xi++) {
          var isDark = xi < cw && rowVals[xi] < threshold;
          if (isDark && runStart === -1) {
            runStart = xi;
          } else if (!isDark && runStart !== -1) {
            var runLen = xi - runStart;
            if (runLen >= minW && runLen <= maxW) {
              runs.push({ x: runStart + runLen / 2, w: runLen });
            }
            runStart = -1;
          }
        }
        if (!runs.length) continue;

        var chosen;
        if (prevX === null) {
          chosen = runs[0];
          for (var ri = 1; ri < runs.length; ri++) {
            if (Math.abs(runs[ri].x - cw / 2) < Math.abs(chosen.x - cw / 2)) chosen = runs[ri];
          }
        } else {
          chosen = runs[0];
          var bestDist = Math.abs(runs[0].x - prevX);
          for (var rj = 1; rj < runs.length; rj++) {
            var d = Math.abs(runs[rj].x - prevX);
            if (d < bestDist) { bestDist = d; chosen = runs[rj]; }
          }
          if (bestDist > cw * 0.08) continue; // too big a jump row-to-row; skip
        }
        candidates.push({ x: chosen.x, y: y });
        prevX = chosen.x;
      }

      if (candidates.length < 20) return null;
      var ySpan = candidates[candidates.length - 1].y - candidates[0].y;
      if (ySpan < ch * 0.4) return null;

      function fitLine(pts) {
        var n = pts.length, sy = 0, sx = 0, syy = 0, sxy = 0;
        pts.forEach(function (p) { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.x * p.y; });
        var denom = n * syy - sy * sy;
        if (Math.abs(denom) < 1e-6) return null;
        var b = (n * sxy - sy * sx) / denom; // x = a + b*y
        var a = (sx - b * sy) / n;
        return { a: a, b: b };
      }

      var fit = fitLine(candidates);
      if (!fit) return null;

      var residuals = candidates.map(function (p) { return Math.abs(p.x - (fit.a + fit.b * p.y)); });
      var sorted = residuals.slice().sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)] || 1;
      var cutoff = Math.max(median * 2.2, 2);
      var inliers = candidates.filter(function (p, i) { return residuals[i] <= cutoff; });
      if (inliers.length >= 12) fit = fitLine(inliers) || fit;
      if (inliers.length < 12) return null;

      var yTop = ch * 0.06, yBase = ch * 0.94;
      var xTop = fit.a + fit.b * yTop;
      var xBase = fit.a + fit.b * yBase;
      return {
        x1: xTop / cw, y1: yTop / ch,
        x2: xBase / cw, y2: yBase / ch
      };
    } catch (err) {
      console.error("Auto-detect mast failed", err);
      return null;
    }
  }

  function runAutoDetect(silentIfFailed) {
    var img = cal.imgEl;
    if (!img) return;
    var guess = autoDetectMast(img);
    if (guess) {
      cal.points = [
        { xf: guess.x1, yf: guess.y1 },
        { xf: guess.x2, yf: guess.y2 }
      ];
      drawCalPoints();
      document.getElementById("calSaveBtn").disabled = false;
      document.getElementById("calAxis2Btn").disabled = false;
      document.getElementById("calHint").textContent = "Auto-detected — drag either point to fine-tune, or Save.";
    } else if (!silentIfFailed) {
      document.getElementById("calHint").textContent = "Couldn't auto-detect the mast — click the top, then the base, to set it by hand.";
    }
  }

  function openMastCalibrator(scanId, imageSrcOverride, onSaveOverride, existingOverride, existing2Override) {
    var scan = scanId ? findScan(scanId) : null;
    var src = imageSrcOverride || (scan ? scan.file : null);
    if (!src) return;

    cal.points = [];
    cal.points2 = [];
    cal.scanId = scanId;
    cal.onSave = onSaveOverride || null;
    cal.dragIndex = -1;
    cal.dragAxis = 1;
    cal.activeAxis = 1;
    cal.suppressNextClick = false;
    document.getElementById("calAxis2Btn").classList.remove("is-active");
    document.getElementById("calAxis2Btn").textContent = "Add second axis";

    var existing = scan ? scan.mast : (existingOverride || null);
    var existing2 = scan ? scan.mast2 : (existing2Override || null);

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

    var loupe = document.createElement("canvas");
    loupe.className = "cal-loupe";
    loupe.width = 150; loupe.height = 150;
    stage.appendChild(loupe);
    cal.loupe = loupe;

    document.getElementById("calHint").textContent = "Click the top of the mast, then click the base (gooseneck).";
    document.getElementById("calSaveBtn").disabled = true;
    document.getElementById("calAxis2Btn").disabled = true;

    function ready() {
      if (existing2) {
        cal.points2 = [
          { xf: existing2.x1, yf: existing2.y1 },
          { xf: existing2.x2, yf: existing2.y2 }
        ];
      }
      if (existing) {
        cal.points = [
          { xf: existing.x1, yf: existing.y1 },
          { xf: existing.x2, yf: existing.y2 }
        ];
        drawCalPoints();
        document.getElementById("calSaveBtn").disabled = false;
        document.getElementById("calAxis2Btn").disabled = false;
        document.getElementById("calHint").textContent = existing2
          ? "Existing alignment shown, including a second axis — drag a point to adjust, or Save."
          : "Existing alignment shown — drag a point to adjust, Auto-detect to re-guess, add a second axis for tricky angles, or Save.";
      } else {
        runAutoDetect(true);
        if (!cal.points.length) {
          document.getElementById("calHint").textContent = "Click the top of the mast, then click the base (gooseneck).";
        }
      }
    }
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });

    function pointFromEvent(e) {
      var rect = img.getBoundingClientRect();
      var xf = (e.clientX - rect.left) / rect.width;
      var yf = (e.clientY - rect.top) / rect.height;
      xf = Math.min(1, Math.max(0, xf));
      yf = Math.min(1, Math.max(0, yf));
      return { xf: xf, yf: yf };
    }

    function positionLoupe(clientX, clientY, xf, yf) {
      var stageRect = stage.getBoundingClientRect();
      var lx = clientX - stageRect.left + 20;
      var ly = clientY - stageRect.top - 170;
      if (ly < 0) ly = clientY - stageRect.top + 20;
      if (lx + 150 > stageRect.width) lx = clientX - stageRect.left - 170;
      loupe.style.left = lx + "px";
      loupe.style.top = ly + "px";
      loupe.classList.add("is-visible");

      var lctx = loupe.getContext("2d");
      lctx.clearRect(0, 0, 150, 150);
      var zoom = 4;
      var srcW = 150 / zoom, srcH = 150 / zoom;
      var sx = xf * img.naturalWidth - srcW / 2;
      var sy = yf * img.naturalHeight - srcH / 2;
      lctx.imageSmoothingEnabled = false;
      lctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, 150, 150);
      lctx.strokeStyle = "rgba(255,255,255,.85)";
      lctx.lineWidth = 1;
      lctx.beginPath();
      lctx.moveTo(75, 0); lctx.lineTo(75, 150);
      lctx.moveTo(0, 75); lctx.lineTo(150, 75);
      lctx.stroke();
    }

    function hideLoupe() {
      loupe.classList.remove("is-visible");
    }

    function activePts() { return cal.activeAxis === 2 ? cal.points2 : cal.points; }

    function updateCalHint() {
      if (cal.activeAxis === 2) {
        document.getElementById("calHint").textContent = cal.points2.length === 0
          ? "Click one end of a second reference line (e.g. the boom, or a batten across the sail), then the other end."
          : (cal.points2.length === 1
            ? "Now click the other end of that reference line."
            : "Second axis set. Drag either point to fine-tune, click again to redo, click “Add second axis” to switch back, or Save.");
      } else {
        document.getElementById("calHint").textContent = cal.points.length === 0
          ? "Click the top of the mast, then click the base (gooseneck)."
          : (cal.points.length === 1
            ? "Now click the base of the mast (gooseneck)."
            : "Two points set. Drag either to fine-tune, click again to redo, or Save." +
              (cal.points2.length === 2 ? "" : " For tricky angles (like a jib shot), add a second axis for a truer fit."));
      }
    }

    stage.onclick = function (e) {
      if (cal.suppressNextClick) { cal.suppressNextClick = false; return; }
      var pts = activePts();
      if (pts.length >= 2) pts.length = 0;
      var p = pointFromEvent(e);
      pts.push(p);
      drawCalPoints();
      updateCalHint();
      document.getElementById("calSaveBtn").disabled = cal.points.length < 2;
      document.getElementById("calAxis2Btn").disabled = cal.points.length < 2;
    };

    stage.onmousemove = function (e) {
      if (cal.dragIndex === -1 && activePts().length < 2) {
        var p = pointFromEvent(e);
        positionLoupe(e.clientX, e.clientY, p.xf, p.yf);
      }
    };
    stage.onmouseleave = function () {
      if (cal.dragIndex === -1) hideLoupe();
    };

    svg.addEventListener("mousedown", function (e) {
      var target = e.target;
      if (!target || target.tagName !== "circle") return;
      var axis = target.getAttribute("data-axis") === "2" ? 2 : 1;
      var idx = parseInt(target.getAttribute("data-idx"), 10);
      if (idx !== 0 && idx !== 1) return;
      cal.dragAxis = axis;
      cal.dragIndex = idx;
      e.preventDefault();
    });

    document.addEventListener("mousemove", cal._onDocMove = function (e) {
      if (cal.dragIndex === -1 || !cal.imgEl || cal.imgEl !== img) return;
      var p = pointFromEvent(e);
      (cal.dragAxis === 2 ? cal.points2 : cal.points)[cal.dragIndex] = p;
      drawCalPoints();
      positionLoupe(e.clientX, e.clientY, p.xf, p.yf);
    });
    document.addEventListener("mouseup", cal._onDocUp = function () {
      if (cal.dragIndex !== -1) {
        cal.dragIndex = -1;
        cal.suppressNextClick = true;
        hideLoupe();
        document.getElementById("calSaveBtn").disabled = cal.points.length < 2;
        document.getElementById("calAxis2Btn").disabled = cal.points.length < 2;
      }
    });
  }

  function drawCalPoints() {
    var svg = cal.svg, img = cal.imgEl;
    var w = img.clientWidth, h = img.clientHeight;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";

    function drawAxis(pts, axisNum, labels) {
      if (pts.length === 2) {
        var p1 = pts[0], p2 = pts[1];
        var line = document.createElementNS(svg.namespaceURI, "line");
        line.setAttribute("x1", p1.xf * w); line.setAttribute("y1", p1.yf * h);
        line.setAttribute("x2", p2.xf * w); line.setAttribute("y2", p2.yf * h);
        line.setAttribute("class", axisNum === 2 ? "cal-line cal-line--axis2" : "cal-line");
        svg.appendChild(line);
      }
      pts.forEach(function (p, i) {
        var c = document.createElementNS(svg.namespaceURI, "circle");
        c.setAttribute("cx", p.xf * w); c.setAttribute("cy", p.yf * h);
        c.setAttribute("r", 8);
        c.setAttribute("class", axisNum === 2 ? "cal-point cal-point--axis2" : "cal-point");
        c.setAttribute("data-axis", axisNum);
        c.setAttribute("data-idx", i);
        svg.appendChild(c);
        var t = document.createElementNS(svg.namespaceURI, "text");
        t.setAttribute("x", p.xf * w + 12); t.setAttribute("y", p.yf * h - 10);
        t.setAttribute("class", axisNum === 2 ? "cal-label cal-label--axis2" : "cal-label");
        t.textContent = labels[i];
        svg.appendChild(t);
      });
    }

    drawAxis(cal.points, 1, ["Top", "Base"]);
    drawAxis(cal.points2, 2, ["A", "B"]);
  }

  document.getElementById("calClose").addEventListener("click", function () {
    document.getElementById("calDialog").classList.add("is-hidden");
    if (cal.loupe) cal.loupe.classList.remove("is-visible");
    if (cal._onDocMove) document.removeEventListener("mousemove", cal._onDocMove);
    if (cal._onDocUp) document.removeEventListener("mouseup", cal._onDocUp);
    cal.dragIndex = -1;
    if (scanPreviewId) document.getElementById("scanPreviewDialog").classList.remove("is-hidden");
  });
  document.getElementById("calClearBtn").addEventListener("click", function () {
    cal.points = [];
    cal.points2 = [];
    cal.activeAxis = 1;
    var axis2Btn = document.getElementById("calAxis2Btn");
    axis2Btn.classList.remove("is-active");
    axis2Btn.textContent = "Add second axis";
    axis2Btn.disabled = true;
    drawCalPoints();
    document.getElementById("calSaveBtn").disabled = true;
    document.getElementById("calHint").textContent = "Click the top of the mast, then click the base (gooseneck).";
  });
  document.getElementById("calAutoBtn").addEventListener("click", function () {
    cal.activeAxis = 1;
    var axis2Btn = document.getElementById("calAxis2Btn");
    axis2Btn.classList.remove("is-active");
    axis2Btn.textContent = "Add second axis";
    runAutoDetect(false);
  });
  document.getElementById("calAxis2Btn").addEventListener("click", function (e) {
    var btn = e.currentTarget;
    if (btn.disabled) return;
    cal.activeAxis = cal.activeAxis === 2 ? 1 : 2;
    btn.classList.toggle("is-active", cal.activeAxis === 2);
    btn.textContent = cal.activeAxis === 2 ? "Editing second axis — click to go back" : "Add second axis";
    // Re-run the same hint logic the dialog's click handler uses, without needing a click event.
    var hintEl = document.getElementById("calHint");
    if (cal.activeAxis === 2) {
      hintEl.textContent = cal.points2.length === 0
        ? "Click one end of a second reference line (e.g. the boom, or a batten across the sail), then the other end."
        : (cal.points2.length === 1 ? "Now click the other end of that reference line." : "Second axis set. Drag either point to fine-tune, click again to redo, click “Add second axis” to switch back, or Save.");
    } else {
      hintEl.textContent = "Editing the mast line — drag either point to fine-tune, click again to redo, or Save.";
    }
  });
  document.getElementById("calSaveBtn").addEventListener("click", function () {
    if (cal.points.length !== 2) return;
    var mast = { x1: cal.points[0].xf, y1: cal.points[0].yf, x2: cal.points[1].xf, y2: cal.points[1].yf };
    var mast2 = cal.points2.length === 2
      ? { x1: cal.points2[0].xf, y1: cal.points2[0].yf, x2: cal.points2[1].xf, y2: cal.points2[1].yf }
      : null;
    if (cal.onSave) {
      cal.onSave(mast, mast2);
    } else if (cal.scanId) {
      var scan = findScan(cal.scanId);
      if (scan) {
        scan.mast = mast; // optimistic local update so the overlay/detail react immediately
        scan.mast2 = mast2;
        renderCompareData();
        renderOverlay();
        if (scanPreviewId === scan.id) openScanPreview(scan.id);
        if (liveMode) {
          updateDoc(doc(db, COLLECTION, scan.id), { mast: mast, mast2: mast2 }).catch(function (e) {
            console.error("Mast save failed", e);
            alert("Couldn't save mast alignment — check your connection. (" + e.message + ")");
          });
        } else {
          persistLocal();
        }
      }
    }
    document.getElementById("calDialog").classList.add("is-hidden");
    if (cal.loupe) cal.loupe.classList.remove("is-visible");
    if (cal._onDocMove) document.removeEventListener("mousemove", cal._onDocMove);
    if (cal._onDocUp) document.removeEventListener("mouseup", cal._onDocUp);
    cal.dragIndex = -1;
  });

  // ---------- Add scan ----------

  var addForm = document.getElementById("addScanForm");
  var photoDataUrl = null;
  var photoFile = null;
  var pendingMast = null;
  var pendingMast2 = null;
  var pendingLeech = null;
  var editingScanId = null; // set when the dialog is open in "edit an existing scan" mode

  function resetAddDialogChrome() {
    editingScanId = null;
    document.getElementById("addScanDialogTitle").textContent = "Add scan";
    document.getElementById("addScanSubmitBtn").textContent = "Save scan";
    document.getElementById("addPhotoInput").required = true;
    document.getElementById("addPhotoDrop").classList.remove("is-hidden");
    document.getElementById("editPhotoNote").classList.add("is-hidden");
    document.getElementById("uploadProgressTrack").classList.add("is-hidden");
    document.getElementById("uploadProgressBar").style.width = "0%";
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
    pendingMast2 = scan.mast2 || null;
    pendingLeech = scan.leech || null;

    document.getElementById("addScanDialogTitle").textContent = "Edit scan";
    document.getElementById("addScanSubmitBtn").textContent = "Save changes";
    document.getElementById("addPhotoInput").required = false;
    document.getElementById("addPhotoDrop").classList.add("is-hidden");
    document.getElementById("editPhotoNote").classList.remove("is-hidden");

    document.getElementById("addBoat").value = scan.boat || "artemis";
    document.getElementById("addSail").value = scan.sail || "Main";
    document.getElementById("addSailCode").value = scan.sailCode || "";
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
    document.getElementById("addLeechStatus").textContent = scan.leech ? "Set" : "Not set";
    document.getElementById("addLeechBtn").disabled = false;
    document.getElementById("addDraftBtn").disabled = false;
    setOcrStatus("");
    document.getElementById("addScanDialog").classList.remove("is-hidden");
  }

  document.getElementById("addPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    photoFile = file;
    pendingMast = null;
    pendingMast2 = null;
    document.getElementById("addMastStatus").textContent = "Not set";
    var reader = new FileReader();
    reader.onload = function () {
      photoDataUrl = reader.result;
      document.getElementById("addMastBtn").disabled = false;
      document.getElementById("addLeechBtn").disabled = false;
      document.getElementById("addDraftBtn").disabled = false;
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
    openMastCalibrator(null, photoDataUrl, function (mast, mast2) {
      pendingMast = mast;
      pendingMast2 = mast2;
      document.getElementById("addMastStatus").textContent = "Set";
    }, pendingMast, pendingMast2);
  });

  // ---------- Leech-line calibration (head-to-clew reference for the camber overlay) ----------
  // Simple two-tap placement, no drag/loupe — same touch-safe pattern as the draft-stripe
  // manual fallback, since this only needs to work once per photo, not be pixel-perfect.
  var leech = { points: [], imgEl: null, svg: null, onSave: null, scanId: null };

  function drawLeechPoints() {
    var svg = leech.svg, img = leech.imgEl;
    if (!svg || !img) return;
    var w = img.clientWidth, h = img.clientHeight;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    if (leech.points.length === 2) {
      var line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", leech.points[0].xf * w); line.setAttribute("y1", leech.points[0].yf * h);
      line.setAttribute("x2", leech.points[1].xf * w); line.setAttribute("y2", leech.points[1].yf * h);
      line.setAttribute("class", "cal-line");
      svg.appendChild(line);
    }
    var labels = ["Head", "Clew"];
    leech.points.forEach(function (p, i) {
      var c = document.createElementNS(svg.namespaceURI, "circle");
      c.setAttribute("cx", p.xf * w); c.setAttribute("cy", p.yf * h);
      c.setAttribute("r", 8);
      c.setAttribute("class", "cal-point");
      svg.appendChild(c);
      var t = document.createElementNS(svg.namespaceURI, "text");
      t.setAttribute("x", p.xf * w + 12); t.setAttribute("y", p.yf * h - 10);
      t.setAttribute("class", "cal-label");
      t.textContent = labels[i];
      svg.appendChild(t);
    });
  }

  function openLeechDialog(scanId, imageSrcOverride, onSaveOverride, existingOverride) {
    var scan = scanId ? findScan(scanId) : null;
    var src = imageSrcOverride || (scan ? scan.file : null);
    if (!src) return;
    leech.points = [];
    leech.scanId = scanId;
    leech.onSave = onSaveOverride || null;
    var existing = scan ? scan.leech : (existingOverride || null);

    var dlg = document.getElementById("leechDialog");
    dlg.classList.remove("is-hidden");
    var stage = document.getElementById("leechStage");
    stage.innerHTML = "";
    var img = document.createElement("img");
    img.src = src;
    img.className = "cal-image";
    stage.appendChild(img);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "cal-svg");
    stage.appendChild(svg);
    leech.imgEl = img;
    leech.svg = svg;

    document.getElementById("leechHint").textContent = "Tap the head of the sail, then tap the clew.";
    document.getElementById("leechSaveBtn").disabled = true;

    function ready() {
      if (existing) {
        leech.points = [{ xf: existing.x1, yf: existing.y1 }, { xf: existing.x2, yf: existing.y2 }];
        drawLeechPoints();
        document.getElementById("leechSaveBtn").disabled = false;
        document.getElementById("leechHint").textContent = "Existing leech line shown — tap to redo (head, then clew), or Save.";
      }
    }
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });

    stage.onclick = function (e) {
      var rect = img.getBoundingClientRect();
      var xf = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      var yf = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      if (leech.points.length >= 2) leech.points = [];
      leech.points.push({ xf: xf, yf: yf });
      drawLeechPoints();
      if (leech.points.length === 2) {
        document.getElementById("leechHint").textContent = "Leech line set — tap again to redo, or Save.";
        document.getElementById("leechSaveBtn").disabled = false;
      } else {
        document.getElementById("leechHint").textContent = "Now tap the clew (bottom aft corner).";
        document.getElementById("leechSaveBtn").disabled = true;
      }
    };
  }

  document.getElementById("addLeechBtn").addEventListener("click", function () {
    if (!photoDataUrl) return;
    openLeechDialog(null, photoDataUrl, function (l) {
      pendingLeech = l;
      document.getElementById("addLeechStatus").textContent = "Set";
    }, pendingLeech);
  });
  document.getElementById("leechClose").addEventListener("click", function () {
    document.getElementById("leechDialog").classList.add("is-hidden");
    document.getElementById("leechStage").onclick = null;
    if (scanPreviewId) document.getElementById("scanPreviewDialog").classList.remove("is-hidden");
  });
  document.getElementById("leechClearBtn").addEventListener("click", function () {
    leech.points = [];
    drawLeechPoints();
    document.getElementById("leechHint").textContent = "Tap the head of the sail, then tap the clew.";
    document.getElementById("leechSaveBtn").disabled = true;
  });
  document.getElementById("leechSaveBtn").addEventListener("click", function () {
    if (leech.points.length !== 2) return;
    var l = { x1: leech.points[0].xf, y1: leech.points[0].yf, x2: leech.points[1].xf, y2: leech.points[1].yf };
    if (leech.onSave) {
      leech.onSave(l);
    } else if (leech.scanId) {
      var scan = findScan(leech.scanId);
      if (scan) {
        scan.leech = l;
        if (scanPreviewId === scan.id) openScanPreview(scan.id);
        if (liveMode) {
          updateDoc(doc(db, COLLECTION, scan.id), { leech: l }).catch(function (e) {
            console.error("Leech line save failed", e);
            alert("Couldn't save the leech line — check your connection. (" + e.message + ")");
          });
        } else {
          persistLocal();
        }
      }
    }
    document.getElementById("leechDialog").classList.add("is-hidden");
    document.getElementById("leechStage").onclick = null;
    if (scanPreviewId) document.getElementById("scanPreviewDialog").classList.remove("is-hidden");
  });

  // ---------- Draft-stripe scan dialog ----------
  // Auto-detects a draft stripe (draftstripe.js) and derives camber/draft/entry/exit from its
  // own endpoints. If that's flagged unreliable (or nothing was found), the sailor can tap the
  // two chord ends by hand instead — the detected curve shape (when there is one) is kept and
  // just re-measured against the new chord, so a bad photo edge doesn't need a full re-detect.
  var draft = { curveNat: null, chordANat: null, chordBNat: null, natW: 0, natH: 0, manualMode: false, manualPts: [], imgEl: null, svg: null, result: null };

  function draftToXf(p) { return { xf: p.x / draft.natW, yf: p.y / draft.natH }; }

  function draftPopulateRowSelect() {
    var sel = document.getElementById("draftRowSelect");
    var rows = document.querySelectorAll("#camberRows tr");
    sel.innerHTML = "";
    var emptyIdx = -1;
    rows.forEach(function (tr, i) {
      var h = tr.querySelectorAll("input")[0].value;
      if (emptyIdx === -1 && h === "") emptyIdx = i;
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "Row " + (i + 1) + (h !== "" ? " (height " + h + ")" : " (empty)");
      sel.appendChild(opt);
    });
    sel.value = String(emptyIdx === -1 ? 0 : emptyIdx);
  }

  function draftDrawOverlay() {
    var svg = draft.svg, img = draft.imgEl;
    if (!svg || !img) return;
    var w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) return;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    if (draft.curveNat && draft.curveNat.length > 1) {
      var pts = draft.curveNat.map(function (p) {
        var f = draftToXf(p);
        return (f.xf * w) + "," + (f.yf * h);
      }).join(" ");
      var poly = document.createElementNS(svg.namespaceURI, "polyline");
      poly.setAttribute("points", pts);
      poly.setAttribute("class", "draft-curve");
      svg.appendChild(poly);
    }
    if (draft.chordANat && draft.chordBNat) {
      var a = draftToXf(draft.chordANat), b = draftToXf(draft.chordBNat);
      var line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", a.xf * w); line.setAttribute("y1", a.yf * h);
      line.setAttribute("x2", b.xf * w); line.setAttribute("y2", b.yf * h);
      line.setAttribute("class", "draft-chord");
      svg.appendChild(line);
      [a, b].forEach(function (p) {
        var c = document.createElementNS(svg.namespaceURI, "circle");
        c.setAttribute("cx", p.xf * w); c.setAttribute("cy", p.yf * h);
        c.setAttribute("r", 8);
        c.setAttribute("class", "draft-endpoint" + (draft.manualMode ? " draft-endpoint--manual" : ""));
        svg.appendChild(c);
      });
    }
  }

  function draftShowResult() {
    var res = (draft.chordANat && draft.chordBNat && draft.curveNat && draft.curveNat.length > 1)
      ? DraftStripe.recomputeWithChord(draft.curveNat, draft.chordANat, draft.chordBNat)
      : null;
    draft.result = res;
    var box = document.getElementById("draftResults");
    if (!res) {
      box.classList.add("is-hidden");
      document.getElementById("draftFillBtn").disabled = true;
      return;
    }
    box.classList.remove("is-hidden");
    document.getElementById("draftCamber").textContent = res.camberPct.toFixed(1) + "%";
    document.getElementById("draftDraft").textContent = res.draftPct.toFixed(0) + "%";
    document.getElementById("draftEntry").textContent = res.entryDeg.toFixed(1) + "°";
    document.getElementById("draftExit").textContent = res.exitDeg.toFixed(1) + "°";
    var twistEl = document.getElementById("draftTwist");
    if (pendingMast) {
      var mvx = (pendingMast.x2 - pendingMast.x1) * draft.natW;
      var mvy = (pendingMast.y2 - pendingMast.y1) * draft.natH;
      var cvx = draft.chordBNat.x - draft.chordANat.x, cvy = draft.chordBNat.y - draft.chordANat.y;
      var mLen = Math.sqrt(mvx * mvx + mvy * mvy), cLen = Math.sqrt(cvx * cvx + cvy * cvy);
      if (mLen > 0 && cLen > 0) {
        var cross = (cvx * mvy - cvy * mvx) / (mLen * cLen);
        var dot = (cvx * mvx + cvy * mvy) / (mLen * cLen);
        var ang = Math.atan2(cross, dot) * 180 / Math.PI;
        twistEl.textContent = (Math.abs(ang) - 90).toFixed(1) + "°";
      } else {
        twistEl.textContent = "—";
      }
    } else {
      twistEl.textContent = "—";
    }
    document.getElementById("draftFillBtn").disabled = false;
  }

  function draftRunDetection() {
    if (!draft.imgEl) return;
    draft.manualMode = false;
    draft.manualPts = [];
    draft.natW = draft.imgEl.naturalWidth;
    draft.natH = draft.imgEl.naturalHeight;
    var out = DraftStripe.analyze(draft.imgEl);
    var hintEl = document.getElementById("draftHint");
    if (out.status === "none") {
      draft.curveNat = null; draft.chordANat = null; draft.chordBNat = null;
      hintEl.textContent = out.reason + " Tap “Place chord points by hand” to mark the stripe yourself.";
      draftDrawOverlay();
      draftShowResult();
      return;
    }
    draft.curveNat = out.curve;
    draft.chordANat = out.chordA;
    draft.chordBNat = out.chordB;
    hintEl.textContent = out.status === "flagged"
      ? out.reason
      : "Auto-detected — check it lines up with the stripe, or place points by hand to override the ends.";
    draftDrawOverlay();
    draftShowResult();
  }

  function openDraftDialog(src) {
    var dlg = document.getElementById("draftDialog");
    dlg.classList.remove("is-hidden");
    var stage = document.getElementById("draftStage");
    stage.innerHTML = "";
    var img = document.createElement("img");
    img.src = src;
    img.className = "cal-image";
    stage.appendChild(img);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "cal-svg");
    stage.appendChild(svg);
    draft.imgEl = img;
    draft.svg = svg;
    draft.manualMode = false;
    draft.manualPts = [];
    draft.curveNat = null;
    draft.chordANat = null;
    draft.chordBNat = null;
    draftPopulateRowSelect();
    document.getElementById("draftHint").textContent = "Scanning the photo for a draft stripe…";
    document.getElementById("draftResults").classList.add("is-hidden");
    document.getElementById("draftFillBtn").disabled = true;

    function ready() { draftRunDetection(); }
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });

    // Tap-to-place, mirroring the mast-calibration stage's click handling (which already works
    // reliably on iPhone Safari via its synthesized click-from-tap) — no dragging needed here.
    stage.onclick = function (e) {
      if (!draft.manualMode) return;
      var rect = img.getBoundingClientRect();
      var xf = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      var yf = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      var p = { x: xf * draft.natW, y: yf * draft.natH };
      if (draft.manualPts.length >= 2) draft.manualPts = [];
      draft.manualPts.push(p);
      if (draft.manualPts.length === 2) {
        draft.chordANat = draft.manualPts[0];
        draft.chordBNat = draft.manualPts[1];
        document.getElementById("draftHint").textContent = "Chord points set by hand. Tap again to redo, or Fill row.";
        draftShowResult();
      } else {
        draft.chordANat = p;
        draft.chordBNat = null;
        document.getElementById("draftHint").textContent = "Now tap the other end of the stripe.";
        document.getElementById("draftResults").classList.add("is-hidden");
        document.getElementById("draftFillBtn").disabled = true;
      }
      draftDrawOverlay();
    };
  }

  document.getElementById("addDraftBtn").addEventListener("click", function () {
    if (!photoDataUrl) return;
    openDraftDialog(photoDataUrl);
  });
  document.getElementById("draftClose").addEventListener("click", function () {
    document.getElementById("draftDialog").classList.add("is-hidden");
    document.getElementById("draftStage").onclick = null;
    if (scanPreviewId) document.getElementById("scanPreviewDialog").classList.remove("is-hidden");
  });
  document.getElementById("draftRedetectBtn").addEventListener("click", draftRunDetection);
  document.getElementById("draftManualBtn").addEventListener("click", function () {
    draft.manualMode = true;
    draft.manualPts = [];
    draft.chordANat = null;
    draft.chordBNat = null;
    document.getElementById("draftResults").classList.add("is-hidden");
    document.getElementById("draftFillBtn").disabled = true;
    document.getElementById("draftHint").textContent = "Tap one end of the draft stripe, then the other.";
    draftDrawOverlay();
  });
  document.getElementById("draftFillBtn").addEventListener("click", function () {
    if (!draft.result) return;
    var idx = Number(document.getElementById("draftRowSelect").value);
    var rows = document.querySelectorAll("#camberRows tr");
    var tr = rows[idx];
    if (!tr) return;
    var inputs = tr.querySelectorAll("input");
    // [height, camber, draft, twist, entry, exit, foreCam, backCam]
    inputs[1].value = draft.result.camberPct.toFixed(1);
    inputs[2].value = draft.result.draftPct.toFixed(0);
    var twistText = document.getElementById("draftTwist").textContent;
    if (twistText !== "—") inputs[3].value = parseFloat(twistText);
    inputs[4].value = draft.result.entryDeg.toFixed(1);
    inputs[5].value = draft.result.exitDeg.toFixed(1);
    document.getElementById("draftHint").textContent = "Filled row " + (idx + 1) + " — check the numbers, then close this and review the table before saving.";
    draftPopulateRowSelect();
    document.getElementById("draftRowSelect").value = String(idx);
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
      sailCode: document.getElementById("addSailCode").value.trim() || null,
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
      leech: pendingLeech,
      mast2: pendingMast2,
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
      pendingMast2 = null;
      document.getElementById("addMastStatus").textContent = "Not set";
      document.getElementById("addMastBtn").disabled = true;
      document.getElementById("addLeechStatus").textContent = "Not set";
      document.getElementById("addLeechBtn").disabled = true;
      pendingLeech = null;
      document.getElementById("addDraftBtn").disabled = true;
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
      var progressTrack = document.getElementById("uploadProgressTrack");
      var progressBar = document.getElementById("uploadProgressBar");
      progressTrack.classList.remove("is-hidden");
      progressBar.style.width = "0%";
      submitBtn.textContent = "Uploading photo… 0%";

      var extMatch = photoFile.name && photoFile.name.match(/\.[a-zA-Z0-9]+$/);
      var ext = extMatch ? extMatch[0] : ".jpg";
      var sref = storageRef(storage, "sail-shots/" + id + ext);
      var uploadTask = uploadBytesResumable(sref, photoFile);

      // Uploads can silently hang on a flaky connection (no error, no progress, forever).
      // Watch for that: if bytesTransferred hasn't moved in 25s, cancel so the sailor gets
      // a clear failure instead of a button stuck on "Uploading..." indefinitely.
      var lastBytes = -1;
      var stallTimer = null;
      function armStallTimer() {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(function () { uploadTask.cancel(); }, 25000);
      }
      armStallTimer();

      function uploadFailed(err) {
        clearTimeout(stallTimer);
        progressTrack.classList.add("is-hidden");
        submitBtn.disabled = false;
        submitBtn.textContent = "Save scan";
        var stalled = err && err.code === "storage/canceled";
        console.error("Photo upload failed", err);
        alert(
          (stalled
            ? "The photo upload stalled — no progress for 25s, so it was cancelled."
            : "Couldn't upload this photo (" + ((err && err.message) || err) + ").") +
          " Check your connection and hit Save scan again — your details and photo are still filled in."
        );
      }

      uploadTask.on("state_changed", function (snapshot) {
        if (snapshot.bytesTransferred !== lastBytes) {
          lastBytes = snapshot.bytesTransferred;
          armStallTimer();
        }
        var pct = snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0;
        submitBtn.textContent = "Uploading photo… " + pct + "%";
        progressBar.style.width = pct + "%";
      }, uploadFailed, function () {
        clearTimeout(stallTimer);
        getDownloadURL(sref).then(function (url) {
          scan.file = url;
          submitBtn.textContent = "Saving…";
          progressTrack.classList.add("is-hidden");
          return setDoc(doc(db, COLLECTION, id), scan);
        }).then(function () {
          finishSave(scan);
        }).catch(function (e) {
          console.error("Save scan failed", e);
          submitBtn.disabled = false;
          submitBtn.textContent = "Save scan";
          progressTrack.classList.add("is-hidden");
          alert("Couldn't save this scan — check your connection. (" + e.message + ")");
        });
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
    pendingMast2 = null;
    document.getElementById("addMastStatus").textContent = "Not set";
    document.getElementById("addMastBtn").disabled = true;
    document.getElementById("addLeechStatus").textContent = "Not set";
    document.getElementById("addLeechBtn").disabled = true;
    pendingLeech = null;
    document.getElementById("addDraftBtn").disabled = true;
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
