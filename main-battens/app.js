(function () {
  "use strict";

  var STORAGE_KEY = "rc44-batten-data-v1";
  var POSITIONS = [1, 2, 3, 4, 5, 6];
  var BOATS = ["artemis", "gemera"];

  // Deep-clone the seed data, then apply any locally-saved edits on top of it.
  var data = JSON.parse(JSON.stringify(window.BATTEN_DATA));
  var saved = null;
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* storage unavailable — proceed with seed data only */ }
  if (saved) data = saved;

  var dirty = false;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    dirty = true;
    updateChangesBar();
  }

  function findBatten(boat, pos, id) {
    var list = data[boat].positions[pos].battens;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function updateChangesBar() {
    var bar = document.getElementById("changesBar");
    bar.classList.toggle("is-hidden", !dirty);
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
          persist();
          renderEi(boat, pos);
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
    });
    renderCompare();
  }

  function renderEi(boat, pos) {
    var slot = data[boat].positions[pos];
    var el = document.getElementById("ei-" + boat + "-" + pos);
    var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;
    el.textContent = b ? eiLabel(b.ei) : "—";
  }

  function renderCompare() {
    var body = document.getElementById("compareBody");
    body.innerHTML = "";
    POSITIONS.forEach(function (pos) {
      var tr = document.createElement("tr");

      var tdPos = document.createElement("td");
      tdPos.textContent = "B" + pos;
      tr.appendChild(tdPos);

      BOATS.forEach(function (boat) {
        var slot = data[boat].positions[pos];
        var b = slot.installed ? findBatten(boat, pos, slot.installed) : null;
        var tdName = document.createElement("td");
        tdName.textContent = b ? b.name : "—";
        var tdEi = document.createElement("td");
        tdEi.textContent = b ? eiLabel(b.ei) : "—";
        tr.appendChild(tdName);
        tr.appendChild(tdEi);
      });

      var a = data.artemis.positions[pos].installed ? findBatten("artemis", pos, data.artemis.positions[pos].installed) : null;
      var g = data.gemera.positions[pos].installed ? findBatten("gemera", pos, data.gemera.positions[pos].installed) : null;
      var tdDelta = document.createElement("td");
      if (a && g && typeof a.ei === "number" && typeof g.ei === "number") {
        var delta = a.ei - g.ei;
        tdDelta.textContent = (delta > 0 ? "+" : "") + delta + " (Artemis vs Gemera)";
      } else {
        tdDelta.textContent = "—";
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
        persist();
        renderManageList();
        render();
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
    persist();
    renderManageList();
    render();
    e.target.reset();
  });

  // ---------- Save / export ----------

  function generateDataJs() {
    return "/* RC44 Main Batten inventory — edited via the Main Battens page. */\n" +
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

  document.getElementById("discardChangesBtn").addEventListener("click", function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    data = JSON.parse(JSON.stringify(window.BATTEN_DATA));
    dirty = false;
    updateChangesBar();
    render();
  });

  render();
})();
