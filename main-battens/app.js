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
  var NAME_KEY = "rc44-battens-editor-name";
  var POSITIONS = [1, 2, 3, 4, 5, 6];
  var BOATS = ["artemis", "gemera"];

  var data = JSON.parse(JSON.stringify(window.BATTEN_DATA));
  var lastUpdated = { artemis: null, gemera: null }; // {date: Date|null, by: string}
  var liveMode = false;
  var db = null;

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
          BOATS.forEach(function (boat) { subscribeBoat(boat); });
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
    render();
  }

  function subscribeBoat(boat) {
    var ref = doc(db, "rc44-battens", boat);
    getDoc(ref).then(function (snap) {
      if (!snap.exists()) {
        // First run for this boat — seed Firestore from the bundled data.js.
        return setDoc(ref, {
          boatLabel: data[boat].boatLabel,
          positions: data[boat].positions,
          updatedAt: serverTimestamp(),
          updatedBy: "Seed data"
        });
      }
    }).catch(function (e) { console.error("Seed failed for " + boat, e); }).finally(function () {
      onSnapshot(ref, function (snap) {
        if (!snap.exists()) return;
        var d = snap.data();
        data[boat].boatLabel = d.boatLabel || data[boat].boatLabel;
        data[boat].positions = d.positions || data[boat].positions;
        lastUpdated[boat] = {
          date: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate() : null,
          by: d.updatedBy || null
        };
        render();
        renderSyncStatus(boat);
      }, function (err) {
        console.error("Sync error for " + boat, err);
        var el = document.querySelector("#sync-" + boat + " .sync-status__text");
        if (el) el.innerHTML = "<strong style='color:#ffcaa0;'>Sync error</strong> — check console / Firestore rules";
      });
    });
  }

  function saveBoat(boat) {
    if (!liveMode) { persistLocal(); render(); return; }
    var ref = doc(db, "rc44-battens", boat);
    setDoc(ref, {
      boatLabel: data[boat].boatLabel,
      positions: data[boat].positions,
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

  // ---------- Core rendering ----------

  function findBatten(boat, pos, id) {
    var list = data[boat].positions[pos].battens;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function eiLabel(ei) {
    return (ei === null || ei === undefined || ei === "") ? "EI —" : "EI " + ei;
  }

  function render() {
    BOATS.forEach(function (boat) {
      var col = document.getElementById("col-" + boat);
      col.innerHTML = "";
      POSITIONS.forEach(function (pos) {
        var slot = data[boat].positions[pos];
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

        slot.battens.forEach(function (b) {
          if (b.decommissioned) return;
          var opt = document.createElement("option");
          opt.value = b.id;
          opt.textContent = b.name + (b.serial ? " · #" + b.serial : "");
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
    renderCompare();
  }

  function renderEi(boat, pos) {
    var slot = data[boat].positions[pos];
    var el = document.getElementById("ei-" + boat + "-" + pos);
    var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;
    el.textContent = b ? eiLabel(b.ei) : "—";
  }

  // ---------- Comparison table + EI colour scale ----------

  function renderCompare() {
    var body = document.getElementById("compareBody");
    body.innerHTML = "";

    // Auto-scale colour intensity to the biggest EI gap among the 6 positions right now.
    var deltas = {};
    var maxAbs = 0;
    POSITIONS.forEach(function (pos) {
      var a = data.artemis.positions[pos].installed ? findBatten("artemis", pos, data.artemis.positions[pos].installed) : null;
      var g = data.gemera.positions[pos].installed ? findBatten("gemera", pos, data.gemera.positions[pos].installed) : null;
      if (a && g && typeof a.ei === "number" && typeof g.ei === "number") {
        var d = a.ei - g.ei;
        deltas[pos] = d;
        if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
      } else {
        deltas[pos] = null;
      }
    });

    POSITIONS.forEach(function (pos) {
      var tr = document.createElement("tr");

      var tdPos = document.createElement("td");
      tdPos.textContent = "B" + pos;
      tr.appendChild(tdPos);

      var d = deltas[pos];
      var alpha = (d !== null && maxAbs > 0) ? (0.10 + 0.5 * Math.min(1, Math.abs(d) / maxAbs)) : 0;

      BOATS.forEach(function (boat) {
        var slot = data[boat].positions[pos];
        var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;
        var tdName = document.createElement("td");
        tdName.textContent = b ? b.name : "—";
        var tdEi = document.createElement("td");
        tdEi.textContent = b ? eiLabel(b.ei) : "—";
        tdEi.className = "ei-cell";
        if (d !== null && d !== 0) {
          var thisIsStiffer = (boat === "artemis" && d > 0) || (boat === "gemera" && d < 0);
          tdEi.style.backgroundColor = thisIsStiffer
            ? "rgba(255,90,90," + alpha + ")"
            : "rgba(75,224,138," + alpha + ")";
        }
        tr.appendChild(tdName);
        tr.appendChild(tdEi);
      });

      var tdDelta = document.createElement("td");
      if (d === null) {
        tdDelta.innerHTML = "<span class='ei-chip ei-chip--even'>—</span>";
      } else if (d === 0) {
        tdDelta.innerHTML = "<span class='ei-chip ei-chip--even'>Same stiffness</span>";
      } else {
        var stifferBoat = d > 0 ? "Artemis" : "Gemera";
        var chipAlpha = 0.14 + 0.5 * Math.min(1, Math.abs(d) / maxAbs);
        tdDelta.innerHTML =
          "<span class='ei-chip ei-chip--stiff' style='background: rgba(255,90,90," + chipAlpha + ")'>" +
          stifferBoat + " stiffer</span> " +
          "<span style='color: var(--muted-2); font-size:.78rem;'>(" + (d > 0 ? "+" : "") + d + " EI)</span>";
      }
      tr.appendChild(tdDelta);

      body.appendChild(tr);
    });
  }

  // ---------- Manage-inventory dialog ----------

  var manageState = { boat: null, pos: null };

  function openManage(boat, pos) {
    manageState = { boat: boat, pos: pos };
    document.getElementById("manageTitle").textContent =
      data[boat].boatLabel + " · Batten " + pos + " inventory";
    renderManageList();
    document.getElementById("manageDialog").classList.remove("is-hidden");
  }

  function closeManage() {
    document.getElementById("manageDialog").classList.add("is-hidden");
  }

  function renderManageList() {
    var boat = manageState.boat, pos = manageState.pos;
    var slot = data[boat].positions[pos];
    var list = document.getElementById("manageList");
    list.innerHTML = "";

    slot.battens.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "manage-row" + (b.decommissioned ? " manage-row--decommissioned" : "");

      var info = document.createElement("div");
      info.className = "manage-row__info";
      info.innerHTML = "<strong>" + escapeHtml(b.name) + "</strong>" +
        "<span>" + eiLabel(b.ei) + (b.serial ? " · #" + escapeHtml(b.serial) : "") + "</span>" +
        (b.notes ? "<span class='manage-row__notes'>" + escapeHtml(b.notes) + "</span>" : "");
      row.appendChild(info);

      var actions = document.createElement("div");
      actions.className = "manage-row__actions";

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "text-link";
      toggle.textContent = b.decommissioned ? "Restore" : "Decommission";
      toggle.addEventListener("click", function () {
        b.decommissioned = !b.decommissioned;
        if (b.decommissioned && slot.installed === b.id) slot.installed = null;
        saveBoat(boat);
        renderManageList();
      });
      actions.appendChild(toggle);

      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  document.getElementById("manageClose").addEventListener("click", closeManage);
  document.getElementById("manageAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var boat = manageState.boat, pos = manageState.pos;
    var name = document.getElementById("newBattenName").value.trim();
    var eiVal = document.getElementById("newBattenEi").value.trim();
    var serial = document.getElementById("newBattenSerial").value.trim();
    var notes = document.getElementById("newBattenNotes").value.trim();
    if (!name) return;
    var id = boat + "-" + pos + "-" + Date.now().toString(36);
    data[boat].positions[pos].battens.push({
      id: id,
      name: name,
      ei: eiVal === "" ? null : Number(eiVal),
      serial: serial || undefined,
      notes: notes || ""
    });
    saveBoat(boat);
    renderManageList();
    e.target.reset();
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

  if (!liveMode) render();
})();
