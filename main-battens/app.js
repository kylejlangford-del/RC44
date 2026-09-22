// RC44 Main Battens — live cross-device sync via Firebase Firestore.
// Falls back to local-only (this browser only) mode if firebase-config.js hasn't been filled in yet.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

(function () {
  "use strict";

  var STORAGE_KEY = "rc44-batten-data-v1"; // local-only fallback cache
  var XOVER_STORAGE_KEY = "rc44-crossover-data-v1"; // local-only fallback cache for Crossover
  var NAME_KEY = "rc44-battens-editor-name";
  var SAIL_KEY_PREFIX = "rc44-battens-sail-"; // per-boat, per-browser mainsail choice
  var SUGGEST_BOAT_KEY = "rc44-suggest-boat"; // per-browser choice of which boat's suggested set to show (never synced)
  var POSITIONS = [1, 2, 3, 4, 5, 6];
  var BOATS = ["artemis", "gemera"];
  var TWS_MIN = 4, TWS_MAX = 25;

  function toPercent(kts) {
    return (Math.min(TWS_MAX, Math.max(TWS_MIN, kts)) - TWS_MIN) / (TWS_MAX - TWS_MIN) * 100;
  }

  var data = JSON.parse(JSON.stringify(window.BATTEN_DATA));
  var lastUpdated = { artemis: null, gemera: null }; // {date: Date|null, by: string}
  var liveMode = false;
  var db = null;
  var currentView = "comparison";

  // Which mainsail's inventory each boat is currently showing (Artemis: M12/M13, Gemera: M1/M2).
  // This is a per-device UI choice (not synced) — each boat defaults to its first listed mainsail.
  var currentSail = {};
  BOATS.forEach(function (boat) {
    var saved = safeGet(SAIL_KEY_PREFIX + boat);
    var sails = data[boat].mainsails || [];
    currentSail[boat] = (saved && sails.indexOf(saved) !== -1) ? saved : sails[0];
  });

  // The active position→slot map for a boat, under its currently selected mainsail.
  function slotsFor(boat) {
    return data[boat].bySail[currentSail[boat]];
  }

  // Which boat's suggested set is shown — per-browser only, never synced to other viewers.
  var suggestBoat = (function () {
    var saved = safeGet(SUGGEST_BOAT_KEY);
    return BOATS.indexOf(saved) !== -1 ? saved : "artemis";
  })();

  // ---------- Crossover (wind-range charts): battens & chocks vs TWS, per boat/mainsail/position ----------

  var crossoverData = { artemis: { bySail: {} }, gemera: { bySail: {} } };
  var currentXoverPos = { artemis: 1, gemera: 1 };
  var xoverKind = { artemis: "battens", gemera: "battens" };

  // Crossover sub-tabs other than "battens": each is a free-form named list (like chocks) with
  // its own TWS range per item, per position.
  var CUSTOM_KINDS = {
    chocks: { label: "Chocks", placeholder: "Chock name, e.g. 1x thin port", addLabel: "+ Add chock", noun: "chocks" },
    rake: { label: "Rake", placeholder: "Rake setting, e.g. 3200mm", addLabel: "+ Add rake setting", noun: "rake settings" },
    rigsetup: { label: "Rig set up", placeholder: "Rig set up, e.g. 22 on the gauge", addLabel: "+ Add rig set up", noun: "rig set-ups" },
    liftoff: { label: "Lift off (bar)", placeholder: "Lift off, e.g. 24 bar", addLabel: "+ Add lift off", noun: "lift-off settings" }
  };

  function ensureXoverPos(boat, sail, pos) {
    var bySail = crossoverData[boat].bySail;
    if (!bySail[sail]) bySail[sail] = {};
    if (!bySail[sail][pos]) bySail[sail][pos] = { battens: {} };
    var slot = bySail[sail][pos];
    if (!slot.battens) slot.battens = {};
    Object.keys(CUSTOM_KINDS).forEach(function (k) {
      if (!slot[k]) slot[k] = { defs: [], ranges: {} };
    });
    return slot;
  }

  // ---------- Editor name ----------

  var nameInput = document.getElementById("editorName");
  nameInput.value = safeGet(NAME_KEY) || "";
  nameInput.addEventListener("change", function () { safeSet(NAME_KEY, nameInput.value.trim()); });
  function currentName() { return (nameInput.value || "").trim() || "Someone"; }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---------- Firebase init (falls back to local-only if not configured) ----------

  var cfg = window.RC44_FIREBASE_CONFIG || {};
  var configured = cfg.apiKey && cfg.apiKey.indexOf("REPLACE_ME") === -1;

  if (configured) {
    try {
      var app = initializeApp(cfg);
      db = getFirestore(app);
      var auth = getAuth(app);
      // Firestore rules require request.auth != null (locked to this app, not open to the
      // internet) — sign in anonymously first, invisibly, then start syncing.
      onAuthStateChanged(auth, function (user) {
        if (user) {
          liveMode = true;
          document.getElementById("configWarning").classList.add("is-hidden");
          BOATS.forEach(function (boat) { subscribeBoat(boat); subscribeCrossover(boat); });
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
    if (raw) { try { data = JSON.parse(raw); } catch (e) { /* ignore */ } }
    var xraw = safeGet(XOVER_STORAGE_KEY);
    if (xraw) { try { crossoverData = JSON.parse(xraw); } catch (e) { /* ignore */ } }
    renderAll();
  }

  function subscribeBoat(boat) {
    var ref = doc(db, "rc44-battens", boat);
    getDoc(ref).then(function (snap) {
      if (!snap.exists()) {
        // First run for this boat — seed Firestore from the bundled data.js.
        return setDoc(ref, {
          boatLabel: data[boat].boatLabel,
          bySail: data[boat].bySail,
          updatedAt: serverTimestamp(),
          updatedBy: "Seed data"
        });
      }
    }).catch(function (e) { console.error("Seed failed for " + boat, e); }).finally(function () {
      onSnapshot(ref, function (snap) {
        if (!snap.exists()) return;
        var d = snap.data();
        data[boat].boatLabel = d.boatLabel || data[boat].boatLabel;
        data[boat].bySail = d.bySail || data[boat].bySail;
        lastUpdated[boat] = {
          date: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate() : null,
          by: d.updatedBy || null
        };
        renderAll();
        renderSyncStatus(boat);
      }, function (err) {
        console.error("Sync error for " + boat, err);
        var el = document.querySelector("#sync-" + boat + " .sync-status__text");
        if (el) el.innerHTML = "<strong style='color:#ffcaa0;'>Sync error</strong> — check console / Firestore rules";
      });
    });
  }

  function saveBoat(boat) {
    if (!liveMode) { persistLocal(); renderAll(); return; }
    var ref = doc(db, "rc44-battens", boat);
    setDoc(ref, {
      boatLabel: data[boat].boatLabel,
      bySail: data[boat].bySail,
      updatedAt: serverTimestamp(),
      updatedBy: currentName()
    }).catch(function (e) {
      console.error("Save failed for " + boat, e);
      alert("Couldn't save — check your connection. (" + e.message + ")");
    });
  }

  function persistLocal() {
    safeSet(STORAGE_KEY, JSON.stringify(data));
  }

  function subscribeCrossover(boat) {
    var ref = doc(db, "rc44-crossover", boat);
    onSnapshot(ref, function (snap) {
      if (snap.exists()) {
        var d = snap.data();
        crossoverData[boat].bySail = d.bySail || crossoverData[boat].bySail;
      }
      if (currentView === "crossover") renderXoverChart(boat);
    }, function (err) {
      console.error("Crossover sync error for " + boat, err);
    });
  }

  function saveCrossover(boat) {
    if (!liveMode) { persistCrossoverLocal(); return; }
    var ref = doc(db, "rc44-crossover", boat);
    setDoc(ref, {
      bySail: crossoverData[boat].bySail,
      updatedAt: serverTimestamp(),
      updatedBy: currentName()
    }).catch(function (e) { console.error("Crossover save failed for " + boat, e); });
  }

  function persistCrossoverLocal() {
    safeSet(XOVER_STORAGE_KEY, JSON.stringify(crossoverData));
  }

  // ---------- Relative time / sync status ----------

  function relativeTime(date) {
    if (!date) return "just now";
    var s = Math.round((Date.now() - date.getTime()) / 1000);
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var days = Math.round(h / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return days + "d ago";
    return date.toLocaleDateString();
  }

  function renderSyncStatus(boat) {
    var wrap = document.getElementById("sync-" + boat);
    if (!wrap) return;
    var dot = wrap.querySelector(".sync-status__dot");
    var text = wrap.querySelector(".sync-status__text");
    var info = lastUpdated[boat];
    if (!liveMode) {
      dot.classList.add("sync-status__dot--stale");
      text.textContent = "Local only — not syncing between devices";
      return;
    }
    if (!info || !info.date) {
      dot.classList.remove("sync-status__dot--stale");
      text.innerHTML = "<strong>Saving…</strong>";
      return;
    }
    var stale = (Date.now() - info.date.getTime()) > (1000 * 60 * 60 * 24); // >24h old
    dot.classList.toggle("sync-status__dot--stale", stale);
    text.innerHTML = "Updated <strong>" + relativeTime(info.date) + "</strong>" + (info.by ? " by " + escapeHtml(info.by) : "") +
      (stale ? " <span class='pill pill--warn' style='margin-left:4px;'>over a day old</span>" : "");
  }

  document.querySelectorAll("[data-mark]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var boat = btn.dataset.mark;
      btn.disabled = true;
      btn.textContent = "Marking…";
      Promise.resolve(saveBoat(boat)).finally(function () {
        btn.disabled = false;
        btn.textContent = "Mark reviewed";
      });
    });
  });

  // Keep the "Xm ago" labels fresh without waiting for the next snapshot.
  setInterval(function () { BOATS.forEach(renderSyncStatus); }, 30000);

  // ---------- View toggle ----------

  document.querySelectorAll(".view-toggle__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".view-toggle__btn").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      currentView = btn.dataset.view;
      document.getElementById("viewComparison").classList.toggle("is-hidden", currentView !== "comparison");
      document.getElementById("viewInventory").classList.toggle("is-hidden", currentView !== "inventory");
      document.getElementById("viewCrossover").classList.toggle("is-hidden", currentView !== "crossover");
      if (currentView === "inventory") renderFullInventory();
      if (currentView === "crossover") renderCrossoverAll();
    });
  });

  document.querySelectorAll("[data-add-batten]").forEach(function (btn) {
    btn.addEventListener("click", function () { openManage(btn.dataset.addBatten, 1); });
  });

  var suggestTwsInput = document.getElementById("suggestTws");
  if (suggestTwsInput) suggestTwsInput.addEventListener("input", function () { renderCompare(); });

  // ---------- Mainsail toggle (per boat: Artemis M12/M13, Gemera M1/M2) ----------

  function renderSailToggles() {
    BOATS.forEach(function (boat) {
      document.querySelectorAll('[data-sail-toggle="' + boat + '"]').forEach(function (wrap) {
        wrap.innerHTML = "";
        (data[boat].mainsails || []).forEach(function (sail) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "sail-toggle__btn" + (currentSail[boat] === sail ? " is-active" : "");
          btn.textContent = sail;
          btn.addEventListener("click", function () {
            if (currentSail[boat] === sail) return;
            currentSail[boat] = sail;
            safeSet(SAIL_KEY_PREFIX + boat, sail);
            renderSailToggles();
            renderAll();
          });
          wrap.appendChild(btn);
        });
      });
    });
    var note = document.getElementById("compareSailNote");
    if (note) {
      note.textContent = "Comparing Artemis " + currentSail.artemis + " vs Gemera " + currentSail.gemera +
        ". Green = softer, red = stiffer. Colour intensity is relative to the biggest EI gap among the 6 positions right now.";
    }
  }

  // ---------- Core helpers ----------

  function findBatten(boat, pos, id) {
    var list = slotsFor(boat)[pos].battens;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function eiLabel(ei) {
    return (ei === null || ei === undefined || ei === "") ? "EI —" : "EI " + ei;
  }

  function sortByEi(list) {
    return list.slice().sort(function (a, b) {
      var ae = (a.ei === null || a.ei === undefined || a.ei === "") ? null : Number(a.ei);
      var be = (b.ei === null || b.ei === undefined || b.ei === "") ? null : Number(b.ei);
      if (ae === null && be === null) return 0;
      if (ae === null) return 1;
      if (be === null) return -1;
      return ae - be;
    });
  }

  function battenOptionLabel(b) {
    var parts = [b.name, eiLabel(b.ei)];
    if (b.serial) parts.push("#" + b.serial);
    return parts.join(" · ");
  }

  function battenMetaLine(b) {
    var parts = [eiLabel(b.ei)];
    if (b.colour) parts.push(b.colour);
    if (b.length) parts.push(b.length);
    if (b.manufacturer) parts.push(b.manufacturer);
    if (b.serial) parts.push("#" + b.serial);
    return parts.join(" · ");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderAll() {
    renderSailToggles();
    render();
    renderCompare();
    renderSuggestedSet();
    if (currentView === "inventory") renderFullInventory();
    if (currentView === "crossover") renderCrossoverAll();
  }

  // ---------- Comparison view (slot pickers) ----------

  function render() {
    BOATS.forEach(function (boat) {
      var col = document.getElementById("col-" + boat);
      col.innerHTML = "";
      POSITIONS.forEach(function (pos) {
        var slot = slotsFor(boat)[pos];
        var wrap = document.createElement("div");
        wrap.className = "batten-slot";

        var num = document.createElement("div");
        num.className = "batten-slot__num";
        num.textContent = "B" + pos;
        wrap.appendChild(num);

        var select = document.createElement("select");
        select.setAttribute("aria-label", "Batten " + pos + " installed on " + data[boat].boatLabel);
        var noneOpt = document.createElement("option");
        noneOpt.value = "";
        noneOpt.textContent = "— none selected —";
        select.appendChild(noneOpt);

        sortByEi(slot.battens).forEach(function (b) {
          if (b.decommissioned) return;
          var opt = document.createElement("option");
          opt.value = b.id;
          opt.textContent = battenOptionLabel(b);
          select.appendChild(opt);
        });
        select.value = slot.installed || "";
        select.addEventListener("change", function () {
          slot.installed = select.value || null;
          saveBoat(boat);
        });
        wrap.appendChild(select);

        var ei = document.createElement("div");
        ei.className = "batten-slot__ei";
        ei.id = "ei-" + boat + "-" + pos;
        wrap.appendChild(ei);

        col.appendChild(wrap);

        var manageRow = document.createElement("button");
        manageRow.type = "button";
        manageRow.className = "text-link batten-slot__manage";
        manageRow.textContent = "Manage B" + pos + " inventory (" + slot.battens.length + ")";
        manageRow.addEventListener("click", function () { openManage(boat, pos); });
        col.appendChild(manageRow);

        renderEi(boat, pos);
      });
      renderSyncStatus(boat);
    });
  }

  function renderEi(boat, pos) {
    var slot = slotsFor(boat)[pos];
    var el = document.getElementById("ei-" + boat + "-" + pos);
    var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;
    el.textContent = b ? eiLabel(b.ei) : "—";
  }

  // ---------- Comparison list (flex rows — never needs horizontal scroll) + EI colour scale ----------

  function renderCompare() {
    var list = document.getElementById("compareList");
    list.innerHTML = "";

    // Auto-scale colour intensity to the biggest EI gap among the 6 positions right now.
    var deltas = {};
    var maxAbs = 0;
    POSITIONS.forEach(function (pos) {
      var artSlot = slotsFor("artemis")[pos], gemSlot = slotsFor("gemera")[pos];
      var a = artSlot.installed ? findBatten("artemis", pos, artSlot.installed) : null;
      var g = gemSlot.installed ? findBatten("gemera", pos, gemSlot.installed) : null;
      if (a && g && typeof a.ei === "number" && typeof g.ei === "number") {
        var d = a.ei - g.ei;
        deltas[pos] = d;
        if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
      } else {
        deltas[pos] = null;
      }
    });

    POSITIONS.forEach(function (pos) {
      var d = deltas[pos];
      var alpha = (d !== null && maxAbs > 0) ? (0.14 + 0.5 * Math.min(1, Math.abs(d) / maxAbs)) : 0;

      var row = document.createElement("div");
      row.className = "compare-row";

      var head = document.createElement("div");
      head.className = "compare-row__head";
      head.textContent = "B" + pos;
      row.appendChild(head);

      var boatsWrap = document.createElement("div");
      boatsWrap.className = "compare-row__boats";
      row.appendChild(boatsWrap);

      BOATS.forEach(function (boat) {
        var slot = slotsFor(boat)[pos];
        var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;

        var boatWrap = document.createElement("div");
        boatWrap.className = "compare-row__boat";

        var label = document.createElement("span");
        label.className = "compare-row__boat-label";
        label.textContent = boat === "artemis" ? "Artemis" : "Gemera";
        boatWrap.appendChild(label);

        var name = document.createElement("span");
        name.className = "compare-row__name";
        name.textContent = b ? b.name : "—";
        boatWrap.appendChild(name);

        if (b) {
          var eiPill = document.createElement("span");
          eiPill.className = "compare-row__ei";
          eiPill.textContent = eiLabel(b.ei);
          if (d !== null && d !== 0) {
            var thisIsStiffer = (boat === "artemis" && d > 0) || (boat === "gemera" && d < 0);
            eiPill.style.backgroundColor = thisIsStiffer ? "rgba(255,90,90," + alpha + ")" : "rgba(75,224,138," + alpha + ")";
            eiPill.style.color = thisIsStiffer ? "#ffcfcf" : "#c8ffe0";
          } else {
            eiPill.style.color = "var(--muted-2)";
          }
          boatWrap.appendChild(eiPill);
        }

        boatsWrap.appendChild(boatWrap);
      });

      var result = document.createElement("div");
      result.className = "compare-row__result";
      if (d === null) {
        result.innerHTML = "<span class='ei-chip ei-chip--even'>—</span>";
      } else if (d === 0) {
        result.innerHTML = "<span class='ei-chip ei-chip--even'>Same stiffness</span>";
      } else {
        var stifferBoat = d > 0 ? "Artemis" : "Gemera";
        var chipAlpha = 0.18 + 0.5 * Math.min(1, Math.abs(d) / maxAbs);
        result.innerHTML =
          "<span class='ei-chip ei-chip--stiff' style='background: rgba(255,90,90," + chipAlpha + ")'>" +
          stifferBoat + " stiffer</span> " +
          "<span style='color: var(--muted-2); font-size:.78rem;'>(" + (d > 0 ? "+" : "") + d + " EI)</span>";
      }
      row.appendChild(result);

      list.appendChild(row);
    });
  }

  // ---------- Suggested set up (TWS-based, below the comparison) ----------
  // For a given boat/position/kind, returns EVERY item whose Crossover wind range covers the
  // TWS entered — there can be more than one (e.g. two battens with overlapping ranges).

  function findSuggestions(boat, pos, tws, kind) {
    var sail = currentSail[boat];
    var posX = crossoverData[boat].bySail[sail] && crossoverData[boat].bySail[sail][pos];
    if (!posX) return [];
    var results = [];
    if (kind === "battens") {
      var battenRanges = posX.battens || {};
      Object.keys(battenRanges).forEach(function (id) {
        var r = battenRanges[id];
        if (tws >= r.min && tws <= r.max) {
          var cand = findBatten(boat, pos, id);
          if (cand && !cand.decommissioned) results.push({ id: id, label: cand.name, sub: eiLabel(cand.ei), ei: cand.ei });
        }
      });
      results = sortByEi(results.map(function (r) { return { ei: r.ei, id: r.id, label: r.label, sub: r.sub }; }));
    } else {
      var kindData = posX[kind];
      if (!kindData) return [];
      var ranges = kindData.ranges || {};
      (kindData.defs || []).forEach(function (d) {
        var r = ranges[d.id];
        if (r && tws >= r.min && tws <= r.max) results.push({ id: d.id, label: d.name, sub: "" });
      });
    }
    return results;
  }

  // Builds one labelled row of suggestion chips (e.g. "Battens: X, Y"). actionFor(match) returns
  // {already, onUse} to make a chip clickable (battens only — other kinds have nowhere to "install" to).
  function buildSuggestGroup(label, matches, actionFor) {
    var group = document.createElement("div");
    group.className = "suggested-set-group";

    var lbl = document.createElement("span");
    lbl.className = "suggested-set-group__label";
    lbl.textContent = label;
    group.appendChild(lbl);

    if (!matches.length) {
      var none = document.createElement("span");
      none.className = "suggested-set-group__none";
      none.textContent = "No suggestion for this TWS";
      group.appendChild(none);
      return group;
    }

    matches.forEach(function (m) {
      var text = m.label + (m.sub ? " · " + m.sub : "");
      if (actionFor) {
        var action = actionFor(m);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "suggested-set-chip is-button";
        btn.textContent = text + (action.already ? " ✓" : "");
        btn.addEventListener("click", action.onUse);
        group.appendChild(btn);
      } else {
        var chip = document.createElement("span");
        chip.className = "suggested-set-chip";
        chip.textContent = text;
        group.appendChild(chip);
      }
    });
    return group;
  }

  function renderSuggestBoatToggle() {
    var wrap = document.getElementById("suggestBoatToggle");
    if (!wrap) return;
    wrap.innerHTML = "";
    BOATS.forEach(function (boat) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sail-toggle__btn" + (suggestBoat === boat ? " is-active" : "");
      btn.textContent = boat === "artemis" ? "Artemis" : "Gemera";
      btn.addEventListener("click", function () {
        if (suggestBoat === boat) return;
        suggestBoat = boat;
        safeSet(SUGGEST_BOAT_KEY, boat); // per-browser only — never written to Firestore/other viewers
        renderSuggestBoatToggle();
        renderSuggestedSet();
      });
      wrap.appendChild(btn);
    });
  }

  function renderSuggestedSet() {
    var wrap = document.getElementById("suggestedSetList");
    var suggestHint = document.getElementById("suggestHint");
    if (!wrap) return;
    wrap.innerHTML = "";

    var boat = suggestBoat;

    var suggestInput = document.getElementById("suggestTws");
    var tws = suggestInput ? parseFloat(suggestInput.value) : NaN;
    var hasTws = !isNaN(tws);

    if (!hasTws) {
      if (suggestHint) suggestHint.classList.add("is-hidden");
      return;
    }

    var sail = currentSail[boat];
    var anyRanges = POSITIONS.some(function (pos) {
      var posX = crossoverData[boat].bySail[sail] && crossoverData[boat].bySail[sail][pos];
      if (!posX) return false;
      if (posX.battens && Object.keys(posX.battens).length) return true;
      return Object.keys(CUSTOM_KINDS).some(function (k) {
        return posX[k] && posX[k].defs && posX[k].defs.length;
      });
    });
    if (suggestHint) suggestHint.classList.toggle("is-hidden", anyRanges);

    var anyRowShown = false;

    POSITIONS.forEach(function (pos) {
      var posX = crossoverData[boat].bySail[sail] && crossoverData[boat].bySail[sail][pos];
      var hasBattenRanges = posX && posX.battens && Object.keys(posX.battens).length;
      var customKindsWithData = Object.keys(CUSTOM_KINDS).filter(function (k) {
        return posX && posX[k] && posX[k].defs && posX[k].defs.length;
      });

      if (!hasBattenRanges && !customKindsWithData.length) return; // nothing configured for this position at all
      anyRowShown = true;

      var row = document.createElement("div");
      row.className = "suggested-set-row";

      var head = document.createElement("div");
      head.className = "compare-row__head";
      head.textContent = "B" + pos;
      row.appendChild(head);

      var groupsWrap = document.createElement("div");
      groupsWrap.className = "suggested-set-groups";

      if (hasBattenRanges) {
        var battenMatches = findSuggestions(boat, pos, tws, "battens");
        groupsWrap.appendChild(buildSuggestGroup("Battens", battenMatches, function (m) {
          var already = slotsFor(boat)[pos].installed === m.id;
          return {
            already: already,
            onUse: function () {
              slotsFor(boat)[pos].installed = m.id;
              saveBoat(boat);
              render();
              renderCompare();
              renderSuggestedSet();
            }
          };
        }));
      }

      customKindsWithData.forEach(function (k) {
        var matches = findSuggestions(boat, pos, tws, k);
        groupsWrap.appendChild(buildSuggestGroup(CUSTOM_KINDS[k].label, matches, null));
      });

      row.appendChild(groupsWrap);
      wrap.appendChild(row);
    });

    if (!anyRowShown) {
      var empty = document.createElement("p");
      empty.className = "import-step__hint";
      empty.textContent = "Nothing set up yet on the Crossover tab for " +
        (boat === "artemis" ? "Artemis" : "Gemera") + "'s " + sail + ".";
      wrap.appendChild(empty);
    }
  }

  renderSuggestBoatToggle();

  var suggestTwsInput = document.getElementById("suggestTws");
  if (suggestTwsInput) suggestTwsInput.addEventListener("input", renderSuggestedSet);

  // ---------- Full inventory view ----------

  function renderFullInventory() {
    BOATS.forEach(function (boat) {
      var container = document.getElementById("inv-" + boat);
      container.innerHTML = "";
      POSITIONS.forEach(function (pos) {
        var slot = slotsFor(boat)[pos];
        var block = document.createElement("div");
        block.className = "inv-position";

        var head = document.createElement("div");
        head.className = "inv-position__head";
        head.innerHTML = "<h3>B" + pos + "</h3>";
        var addLink = document.createElement("button");
        addLink.type = "button";
        addLink.className = "text-link";
        addLink.textContent = "+ Add to B" + pos;
        addLink.addEventListener("click", function () { openManage(boat, pos); });
        head.appendChild(addLink);
        block.appendChild(head);

        if (!slot.battens.length) {
          var empty = document.createElement("p");
          empty.className = "import-step__hint";
          empty.textContent = "No battens recorded for this slot yet.";
          block.appendChild(empty);
        }

        sortByEi(slot.battens).forEach(function (b) {
          block.appendChild(buildBattenRow(boat, pos, b));
        });

        container.appendChild(block);
      });
    });
  }

  // Builds one batten row (view mode with Edit/Decommission, toggles to an inline edit form).
  // Shared by the Full inventory view and the per-slot Manage dialog.
  function buildBattenRow(boat, pos, b) {
    var slot = slotsFor(boat)[pos];
    var row = document.createElement("div");
    row.className = "inv-row" + (slot.installed === b.id ? " inv-row--installed" : "") + (b.decommissioned ? " inv-row--decommissioned" : "");

    function renderView() {
      row.innerHTML = "";
      row.className = "inv-row" + (slot.installed === b.id ? " inv-row--installed" : "") + (b.decommissioned ? " inv-row--decommissioned" : "");

      var name = document.createElement("span");
      name.className = "inv-row__name";
      name.textContent = b.name + (slot.installed === b.id ? " (installed)" : "");
      row.appendChild(name);

      var meta = document.createElement("span");
      meta.className = "inv-row__meta";
      meta.textContent = battenMetaLine(b) + (b.notes ? " · " + b.notes : "");
      row.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "inv-row__actions";

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "text-link";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", renderEdit);
      actions.appendChild(editBtn);

      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "text-link";
      toggleBtn.textContent = b.decommissioned ? "Restore" : "Decommission";
      toggleBtn.addEventListener("click", function () {
        b.decommissioned = !b.decommissioned;
        if (b.decommissioned && slot.installed === b.id) slot.installed = null;
        saveBoat(boat);
        afterBattenChange();
      });
      actions.appendChild(toggleBtn);

      row.appendChild(actions);
    }

    function renderEdit() {
      row.innerHTML = "";
      row.className = "inv-row";

      var grid = document.createElement("div");
      grid.className = "inv-edit-grid";
      grid.innerHTML =
        "<label><span>Batten label</span><input data-f='name' type='text' value='" + escapeHtml(b.name) + "'></label>" +
        "<label><span>EI (stiffness)</span><input data-f='ei' type='number' step='any' value='" + (b.ei === null || b.ei === undefined ? "" : b.ei) + "'></label>" +
        "<label><span>Colour</span><input data-f='colour' type='text' value='" + escapeHtml(b.colour || "") + "'></label>" +
        "<label><span>Length</span><input data-f='length' type='text' value='" + escapeHtml(b.length || "") + "'></label>" +
        "<label><span>Serial number</span><input data-f='serial' type='text' value='" + escapeHtml(b.serial || "") + "'></label>" +
        "<label><span>Manufacturer</span><input data-f='manufacturer' type='text' value='" + escapeHtml(b.manufacturer || "") + "'></label>" +
        "<label style='grid-column: 1 / -1;'><span>Notes</span><input data-f='notes' type='text' value='" + escapeHtml(b.notes || "") + "'></label>";
      row.appendChild(grid);

      var actions = document.createElement("div");
      actions.className = "inv-edit-actions";
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "ghost-button";
      saveBtn.style.cssText = "font-size:.78rem; padding:7px 14px;";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", function () {
        grid.querySelectorAll("[data-f]").forEach(function (inp) {
          var f = inp.dataset.f;
          var v = inp.value.trim();
          if (f === "ei") { b.ei = v === "" ? null : Number(v); return; }
          if (f === "name") { b.name = v; return; }
          b[f] = v || undefined;
        });
        saveBoat(boat);
        afterBattenChange();
      });
      actions.appendChild(saveBtn);

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "text-link";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", renderView);
      actions.appendChild(cancelBtn);

      row.appendChild(actions);
    }

    renderView();
    return row;
  }

  // Called after any batten field / decommission change — refreshes every view that's
  // showing this data (dropdowns, EI labels, comparison list, full inventory, manage dialog).
  function afterBattenChange() {
    render();
    renderCompare();
    if (currentView === "inventory") renderFullInventory();
    if (!document.getElementById("manageDialog").classList.contains("is-hidden")) renderManageList();
  }

  // ---------- Crossover view: draggable TWS-range bars per batten/chock ----------

  document.querySelectorAll("[data-xover-subtabs]").forEach(function (wrap) {
    var boat = wrap.dataset.xoverSubtabs;
    wrap.querySelectorAll(".xover-subtab__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        wrap.querySelectorAll(".xover-subtab__btn").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        xoverKind[boat] = btn.dataset.xoverKind;
        renderXoverChart(boat);
      });
    });
  });

  function renderXoverPosToggles() {
    BOATS.forEach(function (boat) {
      var wrap = document.querySelector('[data-xover-pos="' + boat + '"]');
      if (!wrap) return;
      wrap.innerHTML = "";
      POSITIONS.forEach(function (pos) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pos-toggle__btn" + (currentXoverPos[boat] === pos ? " is-active" : "");
        btn.textContent = "B" + pos;
        btn.addEventListener("click", function () {
          if (currentXoverPos[boat] === pos) return;
          currentXoverPos[boat] = pos;
          renderXoverPosToggles();
          renderXoverChart(boat);
        });
        wrap.appendChild(btn);
      });
    });
  }

  function renderCrossoverAll() {
    renderXoverPosToggles();
    BOATS.forEach(function (boat) { renderXoverChart(boat); });
  }

  // Builds one draggable TWS-range bar inside trackEl. `range` is {min,max} or null (not set yet).
  // onCommit(min, max) fires once, on pointerup (or on the initial tap that creates a range) — not
  // on every intermediate drag frame, so callers can save straight to Firestore from it.
  function renderRangeTrack(trackEl, range, onCommit, onClear) {
    trackEl.innerHTML = "";

    var grid = document.createElement("div");
    grid.className = "xover-track__grid";
    [4, 8, 12, 16, 20, 25].forEach(function (t) {
      var gl = document.createElement("div");
      gl.className = "xover-track__gridline";
      gl.style.left = toPercent(t) + "%";
      grid.appendChild(gl);
    });
    trackEl.appendChild(grid);

    if (!range) {
      var hint = document.createElement("div");
      hint.className = "xover-empty-hint";
      hint.textContent = "Tap to set range";
      trackEl.appendChild(hint);
      trackEl.addEventListener("pointerdown", function handler(e) {
        trackEl.removeEventListener("pointerdown", handler);
        var rect = trackEl.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        var center = TWS_MIN + pct * (TWS_MAX - TWS_MIN);
        var min = Math.max(TWS_MIN, Math.round((center - 2) * 2) / 2);
        var max = Math.min(TWS_MAX, Math.round((center + 2) * 2) / 2);
        if (max <= min) max = Math.min(TWS_MAX, min + 1);
        onCommit(min, max);
      });
      return;
    }

    var rangeEl = document.createElement("div");
    rangeEl.className = "xover-range";
    trackEl.appendChild(rangeEl);
    var leftHandle = document.createElement("div");
    leftHandle.className = "xover-handle xover-handle--left";
    var rightHandle = document.createElement("div");
    rightHandle.className = "xover-handle xover-handle--right";
    trackEl.appendChild(leftHandle);
    trackEl.appendChild(rightHandle);

    var clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "xover-range__clear";
    clearBtn.setAttribute("aria-label", "Clear this wind range");
    clearBtn.textContent = "×";
    clearBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (onClear) onClear();
    });
    trackEl.appendChild(clearBtn);

    var cur = { min: range.min, max: range.max };

    function clamp(v) { return Math.min(TWS_MAX, Math.max(TWS_MIN, v)); }
    function snap(v) { return Math.round(v * 2) / 2; }

    function paint() {
      var l = toPercent(cur.min), r = toPercent(cur.max);
      rangeEl.style.left = l + "%";
      rangeEl.style.width = Math.max(0.5, r - l) + "%";
      rangeEl.textContent = cur.min + "–" + cur.max + "kt";
      leftHandle.style.left = l + "%";
      rightHandle.style.left = r + "%";
    }
    paint();

    function xToKts(clientX) {
      var rect = trackEl.getBoundingClientRect();
      var pct = (clientX - rect.left) / rect.width;
      return clamp(TWS_MIN + pct * (TWS_MAX - TWS_MIN));
    }

    function bindDrag(el, mode) {
      el.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        var startX = e.clientX;
        var startMin = cur.min, startMax = cur.max;

        function onMove(ev) {
          if (mode === "left") {
            cur.min = clamp(Math.min(snap(xToKts(ev.clientX)), cur.max - 0.5));
          } else if (mode === "right") {
            cur.max = clamp(Math.max(snap(xToKts(ev.clientX)), cur.min + 0.5));
          } else {
            var deltaKts = snap(xToKts(ev.clientX) - xToKts(startX));
            var width = startMax - startMin;
            var newMin = clamp(startMin + deltaKts);
            var newMax = newMin + width;
            if (newMax > TWS_MAX) { newMax = TWS_MAX; newMin = newMax - width; }
            cur.min = newMin;
            cur.max = newMax;
          }
          paint();
        }
        function onUp() {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          onCommit(cur.min, cur.max);
        }
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
      });
    }
    bindDrag(leftHandle, "left");
    bindDrag(rightHandle, "right");
    bindDrag(rangeEl, "move");
  }

  function renderXoverChart(boat) {
    var container = document.getElementById("xover-" + boat);
    if (!container) return;
    container.innerHTML = "";

    var sail = currentSail[boat], pos = currentXoverPos[boat] || 1, kind = xoverKind[boat] || "battens";
    var slot = ensureXoverPos(boat, sail, pos);

    var ruler = document.createElement("div");
    ruler.className = "xover-ruler";
    [4, 8, 12, 16, 20, 25].forEach(function (t) {
      var tick = document.createElement("span");
      tick.className = "xover-ruler__tick";
      tick.style.left = toPercent(t) + "%";
      tick.textContent = t + "kt";
      ruler.appendChild(tick);
    });
    container.appendChild(ruler);

    var custom = CUSTOM_KINDS[kind]; // undefined for "battens"

    if (custom) {
      var addForm = document.createElement("form");
      addForm.className = "add-chock-form";
      var addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = custom.placeholder;
      addInput.required = true;
      var addBtn = document.createElement("button");
      addBtn.type = "submit";
      addBtn.className = "ghost-button";
      addBtn.style.cssText = "font-size:.78rem; padding:7px 14px;";
      addBtn.textContent = custom.addLabel;
      addForm.appendChild(addInput);
      addForm.appendChild(addBtn);
      addForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = addInput.value.trim();
        if (!name) return;
        slot[kind].defs.push({ id: kind + "-" + Date.now().toString(36), name: name });
        saveCrossover(boat);
        renderXoverChart(boat);
      });
      container.appendChild(addForm);
    }

    var chart = document.createElement("div");
    chart.className = "xover-chart";
    container.appendChild(chart);

    var rows = kind === "battens"
      ? sortByEi(slotsFor(boat)[pos].battens.filter(function (b) { return !b.decommissioned; })).map(function (b) {
          return { id: b.id, label: b.name, sub: eiLabel(b.ei), removable: false };
        })
      : slot[kind].defs.map(function (c) { return { id: c.id, label: c.name, sub: "", removable: true }; });

    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "import-step__hint";
      empty.textContent = kind === "battens"
        ? "No battens in B" + pos + "'s " + sail + " inventory yet — add some under Full inventory."
        : "No " + custom.noun + " added for B" + pos + " yet — add one above.";
      chart.appendChild(empty);
      return;
    }

    var store = kind === "battens" ? slot.battens : slot[kind].ranges;

    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "xover-row";

      var label = document.createElement("div");
      label.className = "xover-row__label";
      label.innerHTML = escapeHtml(r.label) + (r.sub ? "<span class='xover-row__ei'>" + escapeHtml(r.sub) + "</span>" : "");
      row.appendChild(label);

      var track = document.createElement("div");
      track.className = "xover-track";
      row.appendChild(track);

      if (r.removable) {
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "text-link xover-row__remove";
        rm.textContent = "Remove";
        rm.addEventListener("click", function () {
          slot[kind].defs = slot[kind].defs.filter(function (c) { return c.id !== r.id; });
          delete slot[kind].ranges[r.id];
          saveCrossover(boat);
          renderXoverChart(boat);
        });
        row.appendChild(rm);
      }

      chart.appendChild(row);

      renderRangeTrack(track, store[r.id] || null, function (min, max) {
        store[r.id] = { min: min, max: max };
        saveCrossover(boat);
        renderXoverChart(boat);
      }, function () {
        delete store[r.id];
        saveCrossover(boat);
        renderXoverChart(boat);
      });
    });
  }

  // ---------- Manage-inventory dialog (per-slot list + add form) ----------

  var manageState = { boat: null, pos: null };

  function openManage(boat, pos) {
    manageState = { boat: boat, pos: pos };
    document.getElementById("newBattenPos").value = String(pos);
    updateManageTitle();
    renderManageList();
    document.getElementById("manageDialog").classList.remove("is-hidden");
  }

  function updateManageTitle() {
    document.getElementById("manageTitle").textContent =
      data[manageState.boat].boatLabel + " " + currentSail[manageState.boat] + " · Batten " + manageState.pos + " inventory";
  }

  function closeManage() {
    document.getElementById("manageDialog").classList.add("is-hidden");
  }

  function renderManageList() {
    var boat = manageState.boat, pos = manageState.pos;
    var slot = slotsFor(boat)[pos];
    var list = document.getElementById("manageList");
    list.innerHTML = "";
    if (!slot.battens.length) {
      var empty = document.createElement("p");
      empty.className = "import-step__hint";
      empty.textContent = "No battens recorded for this slot yet — add one below.";
      list.appendChild(empty);
      return;
    }
    sortByEi(slot.battens).forEach(function (b) {
      list.appendChild(buildBattenRow(boat, pos, b));
    });
  }

  document.getElementById("newBattenPos").addEventListener("change", function (e) {
    if (!manageState.boat) return;
    manageState.pos = Number(e.target.value);
    updateManageTitle();
    renderManageList();
  });

  document.getElementById("manageClose").addEventListener("click", closeManage);
  document.getElementById("manageAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var boat = manageState.boat;
    var pos = Number(document.getElementById("newBattenPos").value);
    var name = document.getElementById("newBattenName").value.trim();
    var eiVal = document.getElementById("newBattenEi").value.trim();
    var colour = document.getElementById("newBattenColour").value.trim();
    var length = document.getElementById("newBattenLength").value.trim();
    var serial = document.getElementById("newBattenSerial").value.trim();
    var manufacturer = document.getElementById("newBattenManufacturer").value.trim();
    var notes = document.getElementById("newBattenNotes").value.trim();
    if (!name) return;
    var id = boat + "-" + currentSail[boat] + "-" + pos + "-" + Date.now().toString(36);
    slotsFor(boat)[pos].battens.push({
      id: id,
      name: name,
      ei: eiVal === "" ? null : Number(eiVal),
      colour: colour || undefined,
      length: length || undefined,
      serial: serial || undefined,
      manufacturer: manufacturer || undefined,
      notes: notes || ""
    });
    saveBoat(boat);
    manageState.pos = pos;
    updateManageTitle();
    renderManageList();
    if (currentView === "inventory") renderFullInventory();
    e.target.reset();
    document.getElementById("newBattenPos").value = String(pos);
  });

  // ---------- Backup export ----------

  function generateDataJs() {
    return "/* RC44 Main Batten inventory — snapshot exported " + new Date().toISOString() + ". */\n" +
      "window.BATTEN_DATA = " + JSON.stringify(data, null, 2) + ";\n";
  }

  document.getElementById("downloadDataBtn").addEventListener("click", function () {
    var blob = new Blob([generateDataJs()], { type: "text/javascript" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "data.js";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  if (!liveMode) renderAll();
})();
