// RC44 Daily Log — what each boat used each day. Shared live via Firestore
// (doc rc44-crossover/daily-log, map "entries" keyed by entry id).
// Mains and battens are copied from Main Battens (rc44-battens/<boat>) when a new entry starts.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, updateDoc, deleteField, serverTimestamp, FieldPath
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

(function () {
  "use strict";

  var BOATS = ["artemis", "gemera"];
  var LABEL = { artemis: "Artemis", gemera: "Gemera" };
  var MAINS = { artemis: ["M12", "M13"], gemera: ["M1", "M2"] };
  var POSITIONS = [1, 2, 3, 4, 5, 6];
  var NAME_KEY = "rc44-battens-editor-name"; // same name box as Main Battens

  var db = null;
  var battens = { artemis: null, gemera: null };   // rc44-battens/<boat> data
  var xover = { artemis: null, gemera: null };     // rc44-crossover/<boat> data
  var eventMains = {};
  var entries = {};
  var setupLog = {};   // rc44-crossover/setup-log entries (timestamped set ups)
  var setupNow = {};   // rc44-crossover/setup-now (chock fitted now)
  var editingId = null;

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("logStatus");
  var nameInput = $("logName");

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  nameInput.value = safeGet(NAME_KEY) || "";
  nameInput.addEventListener("change", function () { safeSet(NAME_KEY, nameInput.value.trim()); });
  function who() { return nameInput.value.trim() || "Someone"; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function niceDate(s) {
    var p = String(s || "").split("-");
    if (p.length !== 3) return s || "";
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  // ---------- Firebase ----------

  var cfg = window.RC44_FIREBASE_CONFIG || {};
  try {
    var app = initializeApp(cfg);
    db = getFirestore(app);
    var auth = getAuth(app);
    onAuthStateChanged(auth, function (user) { if (user) subscribe(); });
    signInAnonymously(auth).catch(function (e) {
      statusEl.textContent = "Couldn't connect — check your connection. (" + e.message + ")";
    });
  } catch (e) {
    statusEl.textContent = "Couldn't start live sync. (" + e.message + ")";
  }

  function subscribe() {
    BOATS.forEach(function (boat) {
      onSnapshot(doc(db, "rc44-battens", boat), function (s) { battens[boat] = s.exists() ? s.data() : null; });
      onSnapshot(doc(db, "rc44-crossover", boat), function (s) { xover[boat] = s.exists() ? s.data() : null; });
    });
    onSnapshot(doc(db, "rc44-crossover", "event-mains"), function (s) { eventMains = s.exists() ? s.data() : {}; });
    onSnapshot(doc(db, "rc44-crossover", "setup-log"), function (s) {
      setupLog = (s.exists() && s.data().entries) || {};
      renderList();
    });
    onSnapshot(doc(db, "rc44-crossover", "setup-now"), function (s) { setupNow = s.exists() ? s.data() : {}; });
    onSnapshot(doc(db, "rc44-crossover", "daily-log"), function (s) {
      entries = (s.exists() && s.data().entries) || {};
      var n = Object.keys(entries).length;
      statusEl.textContent = n ? n + " entr" + (n === 1 ? "y" : "ies") + " · live" : "No entries yet — tap + New entry.";
      renderList();
    }, function (err) {
      statusEl.textContent = "Sync error: " + err.message;
    });
  }

  // ---------- Helpers from Main Battens / Crossover data ----------

  function mainsFor(boat) {
    var fromData = window.BATTEN_DATA && window.BATTEN_DATA[boat] && window.BATTEN_DATA[boat].mainsails;
    return (fromData && fromData.length) ? fromData : MAINS[boat];
  }

  function defaultMain(boat) {
    var e = eventMains[boat];
    if (e && e.sail) return e.sail;
    return mainsFor(boat)[0];
  }

  function installedBattens(boat, main) {
    var bySail = battens[boat] && battens[boat].bySail && battens[boat].bySail[main];
    return POSITIONS.map(function (pos) {
      var slot = bySail && bySail[pos];
      var b = null;
      if (slot && slot.installed && slot.battens) {
        for (var i = 0; i < slot.battens.length; i++) if (slot.battens[i].id === slot.installed) b = slot.battens[i];
      }
      return { pos: pos, name: b ? b.name : "", ei: b && b.ei !== undefined && b.ei !== "" ? b.ei : null };
    });
  }

  function optionsFor(boat, main, kind) {
    var sh = xover[boat] && xover[boat].bySail && xover[boat].bySail[main] && xover[boat].bySail[main].shared;
    var defs = (sh && sh[kind] && sh[kind].defs) || [];
    var names = defs.map(function (d) { return d.name; });
    var num = function (n) { var m = String(n).match(/[-+−]?\d+(\.\d+)?/); return m ? parseFloat(m[0].replace("−", "-")) : 1e9; };
    return names.sort(function (a, b) { return num(a) - num(b); });
  }

  function latestEntry() {
    var list = sortedEntries();
    return list.length ? list[0] : null;
  }

  function sortedEntries() {
    return Object.keys(entries).map(function (id) { return Object.assign({ id: id }, entries[id]); })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdMs || 0) - (a.createdMs || 0);
      });
  }

  // ---------- Form ----------

  var form = $("logForm");
  var formBoats = $("formBoats");

  function boatFormHtml(boat) {
    var mains = mainsFor(boat).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");
    return '' +
      '<div class="log-boat" data-boat="' + boat + '">' +
        '<div class="log-boat__head"><span class="boat-dot boat-dot--' + boat + '"></span><strong>' + LABEL[boat] + '</strong>' +
          '<label class="log-inline">Main <select class="log-input log-main">' + mains + '</select></label>' +
          '<button type="button" class="log-link log-refresh" title="Copy the battens set on Main Battens now">↻ Copy battens</button>' +
        '</div>' +
        '<div class="log-battens"></div>' +
        '<div class="log-grid">' +
          '<label class="log-field log-field--small"><span>Chock</span><input class="log-input log-chock" list="dl-chock-' + boat + '" placeholder="mm" maxlength="20" /></label>' +
          '<label class="log-field log-field--small"><span>Rake</span><input class="log-input log-rake" list="dl-rake-' + boat + '" placeholder="°" maxlength="20" /></label>' +
          '<label class="log-field log-field--small"><span>Tune</span><input class="log-input log-tune" list="dl-tune-' + boat + '" placeholder="B / −1 D1" maxlength="30" /></label>' +
          '<label class="log-field log-field--small"><span>Jib</span><input class="log-input log-jib" list="jibList" placeholder="G1 / J2" maxlength="20" /></label>' +
        '</div>' +
        '<datalist id="dl-chock-' + boat + '"></datalist><datalist id="dl-rake-' + boat + '"></datalist><datalist id="dl-tune-' + boat + '"></datalist>' +
        '<label class="log-field"><span>Notes</span><textarea class="log-input log-note" rows="2" maxlength="600" placeholder="How it felt, what to try next"></textarea></label>' +
      '</div>';
  }

  function fillDatalists(boat, main) {
    [["chock", "chocks"], ["rake", "rake"], ["tune", "rigsetup"]].forEach(function (k) {
      var dl = $("dl-" + k[0] + "-" + boat);
      if (!dl) return;
      var extra = k[0] === "tune" ? ["B", "Base", "−1 D's", "−1 D1's", "+1"] : [];
      var opts = optionsFor(boat, main, k[1]).concat(extra.filter(function (x) { return optionsFor(boat, main, k[1]).indexOf(x) === -1; }));
      dl.innerHTML = opts.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join("");
    });
  }

  function renderBattenPreview(card, list) {
    var box = card.querySelector(".log-battens");
    box.dataset.battens = JSON.stringify(list);
    box.innerHTML = list.map(function (b) {
      return '<div class="log-batten"><span class="log-batten__pos">B' + b.pos + '</span>' +
        '<span>' + (b.name ? esc(b.name) : '<em class="log-muted">not set</em>') + '</span>' +
        '<span class="log-batten__ei">' + (b.ei !== null && b.ei !== undefined ? "EI " + esc(b.ei) : "") + '</span></div>';
    }).join("");
  }

  function openForm(entry) {
    editingId = entry ? entry.id : null;
    $("logFormTitle").textContent = entry ? "Edit entry" : "New entry";
    formBoats.innerHTML = BOATS.map(boatFormHtml).join("");
    var last = entry ? null : latestEntry();
    $("fDate").value = entry ? entry.date : todayStr();
    $("fSession").value = entry ? (entry.session || "") : "";
    $("fTwsMin").value = entry && entry.twsMin != null ? entry.twsMin : "";
    $("fTwsMax").value = entry && entry.twsMax != null ? entry.twsMax : "";

    BOATS.forEach(function (boat) {
      var card = formBoats.querySelector('[data-boat="' + boat + '"]');
      var src = entry ? (entry.boats && entry.boats[boat]) || {} : {};
      var prev = last && last.boats && last.boats[boat] || {};
      var mainSel = card.querySelector(".log-main");
      mainSel.value = entry && src.main ? src.main : defaultMain(boat);
      fillDatalists(boat, mainSel.value);
      // New entry: battens copied from Main Battens now; chock/rake/tune/jib start from the last entry.
      renderBattenPreview(card, entry && src.battens ? src.battens : installedBattens(boat, mainSel.value));
      var nowChock = setupNow[boat] && setupNow[boat][mainSel.value] && setupNow[boat][mainSel.value].chock;
      card.querySelector(".log-chock").value = entry ? (src.chock || "") : ((nowChock && nowChock.value) || prev.chock || "");
      card.querySelector(".log-rake").value = entry ? (src.rake || "") : (prev.rake || "");
      card.querySelector(".log-tune").value = entry ? (src.tune || "") : (prev.tune || "");
      card.querySelector(".log-jib").value = entry ? (src.jib || "") : (prev.jib || "");
      card.querySelector(".log-note").value = entry ? (src.note || "") : "";

      mainSel.addEventListener("change", function () {
        fillDatalists(boat, mainSel.value);
        renderBattenPreview(card, installedBattens(boat, mainSel.value));
      });
      card.querySelector(".log-refresh").addEventListener("click", function () {
        renderBattenPreview(card, installedBattens(boat, mainSel.value));
      });
    });

    form.classList.remove("is-hidden");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeForm() {
    form.classList.add("is-hidden");
    editingId = null;
  }

  function numOrNull(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  function collectForm() {
    var e = {
      date: $("fDate").value || todayStr(),
      session: $("fSession").value.trim(),
      twsMin: numOrNull($("fTwsMin").value),
      twsMax: numOrNull($("fTwsMax").value),
      boats: {}
    };
    BOATS.forEach(function (boat) {
      var card = formBoats.querySelector('[data-boat="' + boat + '"]');
      e.boats[boat] = {
        main: card.querySelector(".log-main").value,
        battens: JSON.parse(card.querySelector(".log-battens").dataset.battens || "[]"),
        chock: card.querySelector(".log-chock").value.trim(),
        rake: card.querySelector(".log-rake").value.trim(),
        tune: card.querySelector(".log-tune").value.trim(),
        jib: card.querySelector(".log-jib").value.trim(),
        note: card.querySelector(".log-note").value.trim()
      };
    });
    return e;
  }

  $("newEntryBtn").addEventListener("click", function () { openForm(null); });
  $("cancelEntryBtn").addEventListener("click", closeForm);
  $("saveEntryBtn").addEventListener("click", function () {
    if (!db) return;
    var e = collectForm();
    var id = editingId || ("e" + Date.now().toString(36));
    var prev = editingId ? entries[editingId] : null;
    e.createdMs = prev && prev.createdMs ? prev.createdMs : Date.now();
    e.createdBy = prev && prev.createdBy ? prev.createdBy : who();
    e.updatedBy = who();
    e.updatedAt = serverTimestamp();
    var patch = { entries: {} };
    patch.entries[id] = e;
    var btn = $("saveEntryBtn");
    btn.disabled = true;
    setDoc(doc(db, "rc44-crossover", "daily-log"), patch, { merge: true })
      .then(function () { closeForm(); })
      .catch(function (err) { alert("Couldn't save — check your connection. (" + err.message + ")"); })
      .finally(function () { btn.disabled = false; });
  });

  // ---------- List ----------

  function boatBlock(boat, b) {
    if (!b) return "";
    var rows = [["Chock", b.chock], ["Rake", b.rake], ["Tune", b.tune], ["Jib", b.jib]]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return '<span class="log-kv"><span>' + r[0] + '</span><strong>' + esc(r[1]) + '</strong></span>'; }).join("");
    var bat = (b.battens || []).map(function (x) {
      return '<div class="log-batten"><span class="log-batten__pos">B' + x.pos + '</span><span>' +
        (x.name ? esc(x.name) : '<em class="log-muted">—</em>') + '</span><span class="log-batten__ei">' +
        (x.ei !== null && x.ei !== undefined ? "EI " + esc(x.ei) : "") + '</span></div>';
    }).join("");
    return '<div class="log-boat">' +
      '<div class="log-boat__head"><span class="boat-dot boat-dot--' + boat + '"></span><strong>' + LABEL[boat] + '</strong>' +
      (b.main ? '<span class="log-main-badge">' + esc(b.main) + '</span>' : '') + '</div>' +
      (rows ? '<div class="log-kvs">' + rows + '</div>' : '') +
      '<details class="log-battens-wrap"><summary>Battens</summary>' + bat + '</details>' +
      (b.note ? '<p class="log-note-text">' + esc(b.note) + '</p>' : '') +
      '</div>';
  }

  // Set up periods for one date: each logged set up runs until the next one for that boat.
  function periodsHtml(date) {
    var byBoat = {};
    Object.keys(setupLog).forEach(function (id) {
      var e = setupLog[id];
      if (!e || e.date !== date) return;
      (byBoat[e.boat] = byBoat[e.boat] || []).push(Object.assign({ id: id }, e));
    });
    var boats = BOATS.filter(function (b) { return byBoat[b]; });
    if (!boats.length) return "";
    var isToday = date === todayStr();
    return '<section class="panel log-periods"><div class="log-periods__head"><strong>' + esc(niceDate(date)) + '</strong><span>Set ups logged</span></div>' +
      boats.map(function (boat) {
        var list = byBoat[boat].sort(function (a, b) { return a.ms - b.ms; });
        return '<div class="log-periods__boat"><div class="log-boat__head"><span class="boat-dot boat-dot--' + boat + '"></span><strong>' + LABEL[boat] + '</strong></div>' +
          list.map(function (e, i) {
            var next = list[i + 1];
            var until = next ? next.time : (isToday ? "now" : "end");
            var bat = (e.battens || []).map(function (b) {
              return '<span class="log-period__b" title="' + esc(b.name) + '">B' + b.pos + ' ' + (b.ei != null ? esc(b.ei) : "–") + '</span>';
            }).join("");
            return '<div class="log-period">' +
              '<div class="log-period__time">' + esc(e.time) + '<span>→ ' + esc(until) + '</span></div>' +
              '<div class="log-period__body">' +
                '<div class="log-kvs">' +
                  '<span class="log-main-badge">' + esc(e.sail) + '</span>' +
                  (e.jib ? '<span class="log-kv"><span>Jib</span><strong>' + esc(e.jib) + '</strong></span>' : '') +
                  (e.chock ? '<span class="log-kv"><span>Chock</span><strong>' + esc(e.chock) + '</strong></span>' : '') +
                  (e.seaState ? '<span class="log-kv"><span>Sea</span><strong>' + esc(e.seaState) + '</strong></span>' : '') +
                  (e.feel ? '<span class="log-kv log-feel log-feel--' + esc(e.feel.toLowerCase()) + '"><strong>' + esc(e.feel) + '</strong></span>' : '') +
                  (e.njord && e.njord.twsAvg != null ? '<span class="log-kv log-kv--njord"><span>TWS</span><strong>' +
                    esc(Math.round(e.njord.twsMin) + '–' + Math.round(e.njord.twsMax) + ' (avg ' + (Math.round(e.njord.twsAvg * 10) / 10) + ')') +
                    (e.njord.twd != null ? ' · ' + Math.round(e.njord.twd) + '°' : '') + '</strong></span>' : '') +
                '</div>' +
                '<div class="log-period__battens">' + bat + '</div>' +
                (e.note ? '<p class="log-note-text">' + esc(e.note) + '</p>' : '') +
                '<div class="log-period__foot">' + (e.by ? "by " + esc(e.by) : "") +
                ' <button type="button" class="log-link log-link--danger" data-del-period="' + esc(e.id) + '">Delete</button></div>' +
              '</div></div>';
          }).join("") + '</div>';
      }).join("") + '</section>';
  }

  function renderList() {
    var wrap = $("logList");
    var list = sortedEntries();
    var dates = {};
    list.forEach(function (e) { dates[e.date] = true; });
    Object.keys(setupLog).forEach(function (id) { if (setupLog[id] && setupLog[id].date) dates[setupLog[id].date] = true; });
    var html = Object.keys(dates).sort().reverse().map(function (date) {
      return periodsHtml(date) + list.filter(function (e) { return e.date === date; }).map(entryHtml).join("");
    }).join("");
    wrap.innerHTML = html;
    var n = list.length + Object.keys(setupLog).length;
    if (n && statusEl.textContent.indexOf("No entries") === 0) statusEl.textContent = "Live";
    wrap.querySelectorAll("[data-del-period]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-del-period");
        var e = setupLog[id];
        if (!confirm("Delete the " + (e ? e.time + " " + LABEL[e.boat] + " " + e.sail : "") + " set up? This can't be undone.")) return;
        updateDoc(doc(db, "rc44-crossover", "setup-log"), new FieldPath("entries", id), deleteField())
          .catch(function (err) { alert("Couldn't delete. (" + err.message + ")"); });
      });
    });
    bindEntryButtons(wrap);
  }

  function entryHtml(e) {
    return (function () {
      var tws = (e.twsMin != null || e.twsMax != null)
        ? (e.twsMin != null ? e.twsMin : "?") + "–" + (e.twsMax != null ? e.twsMax : "?") + " kts" : "";
      var meta = [e.session, tws].filter(Boolean).map(esc).join(" · ");
      // Wind from Njord (Gemera's instruments), written into the entry by Claude.
      var nj = e.njord;
      var njHtml = "";
      if (nj && (nj.twsAvg != null || nj.twd != null)) {
        var f = function (n) { return n == null ? "–" : (Math.round(n * 10) / 10).toString(); };
        njHtml = '<div class="log-njord"><span class="log-njord__src">Njord · Gemera</span>' +
          '<span class="log-kv"><span>TWS</span><strong>' + f(nj.twsMin) + ' / ' + f(nj.twsAvg) + ' / ' + f(nj.twsMax) + ' kts</strong></span>' +
          (nj.twd != null ? '<span class="log-kv"><span>TWD</span><strong>' + Math.round(nj.twd) + '°' +
            (nj.twdMin != null && nj.twdMax != null ? ' (' + Math.round(nj.twdMin) + '–' + Math.round(nj.twdMax) + '°)' : '') + '</strong></span>' : '') +
          (nj.window ? '<span class="log-njord__win">' + esc(nj.window) + '</span>' : '') +
          '</div>';
      }
      return '<article class="panel log-entry" data-id="' + esc(e.id) + '">' +
        '<header class="log-entry__head"><div><strong>' + esc(niceDate(e.date)) + '</strong>' +
        (meta ? '<span class="log-entry__meta">' + meta + '</span>' : '') + '</div>' +
        '<div class="log-entry__actions"><button type="button" class="log-link" data-edit="' + esc(e.id) + '">Edit</button>' +
        '<button type="button" class="log-link log-link--danger" data-del="' + esc(e.id) + '">Delete</button></div></header>' +
        njHtml +
        '<div class="log-boats">' + BOATS.map(function (b) { return boatBlock(b, e.boats && e.boats[b]); }).join("") + '</div>' +
        '<footer class="log-entry__foot">Logged by ' + esc(e.createdBy || "someone") +
        (e.updatedBy && e.updatedBy !== e.createdBy ? " · edited by " + esc(e.updatedBy) : "") + '</footer>' +
        '</article>';
    })();
  }

  function bindEntryButtons(wrap) {

    wrap.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-edit");
        openForm(Object.assign({ id: id }, entries[id]));
      });
    });
    wrap.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-del");
        var e = entries[id];
        if (!confirm("Delete the " + niceDate(e && e.date) + (e && e.session ? " · " + e.session : "") + " entry for both boats? This can't be undone.")) return;
        updateDoc(doc(db, "rc44-crossover", "daily-log"), new FieldPath("entries", id), deleteField())
          .catch(function (err) { alert("Couldn't delete. (" + err.message + ")"); });
      });
    });
  }
})();
