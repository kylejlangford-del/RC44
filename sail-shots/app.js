(function () {
  "use strict";

  var STORAGE_KEY = "rc44-sail-shots-v1";
  var scans = JSON.parse(JSON.stringify(window.SAIL_SHOTS || []));
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) scans = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  var selected = { artemis: null, gemera: null };
  var dirty = false;

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scans)); } catch (e) { /* ignore */ }
    dirty = true;
    document.getElementById("changesBar").classList.toggle("is-hidden", !dirty);
  }

  function maxCamber(scan) {
    if (!scan.camber || !scan.camber.length) return null;
    return Math.max.apply(null, scan.camber.map(function (c) { return c.camber; }).filter(function (v) { return v !== null && v !== undefined; }));
  }

  function passesFilter(scan) {
    var twsMin = parseFloat(document.getElementById("fTwsMin").value);
    var twsMax = parseFloat(document.getElementById("fTwsMax").value);
    var bspMin = parseFloat(document.getElementById("fBspMin").value);
    var bspMax = parseFloat(document.getElementById("fBspMax").value);
    var camMin = parseFloat(document.getElementById("fCamMin").value);
    var camMax = parseFloat(document.getElementById("fCamMax").value);

    var tws = scan.wind ? scan.wind.tws : null;
    var bsp = scan.boat_ ? scan.boat_.bsp : null;
    var cam = maxCamber(scan);

    if (!isNaN(twsMin) && tws !== null && tws < twsMin) return false;
    if (!isNaN(twsMax) && tws !== null && tws > twsMax) return false;
    if (!isNaN(bspMin) && bsp !== null && bsp < bspMin) return false;
    if (!isNaN(bspMax) && bsp !== null && bsp > bspMax) return false;
    if (!isNaN(camMin) && cam !== null && cam < camMin) return false;
    if (!isNaN(camMax) && cam !== null && cam > camMax) return false;
    return true;
  }

  function scanLabel(scan) {
    var d = new Date(scan.time);
    var when = isNaN(d.getTime()) ? scan.time : d.toISOString().slice(0, 16).replace("T", " ");
    var tws = scan.wind && scan.wind.tws !== undefined ? scan.wind.tws + " kn TWS" : "";
    return when + (tws ? " · " + tws : "");
  }

  function populateSelects() {
    ["artemis", "gemera"].forEach(function (boat) {
      var sel = document.getElementById("select-" + boat);
      var current = sel.value;
      sel.innerHTML = "";
      var noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— select a scan —";
      sel.appendChild(noneOpt);

      var matches = scans.filter(function (s) { return s.boat === boat && passesFilter(s); });
      matches.sort(function (a, b) { return (b.time || "").localeCompare(a.time || ""); });

      matches.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = scanLabel(s);
        sel.appendChild(opt);
      });

      if (matches.some(function (s) { return s.id === current; })) sel.value = current;
      else if (matches.length) sel.value = matches[0].id;
      else sel.value = "";
      selected[boat] = sel.value || null;
    });
  }

  function findScan(id) {
    return scans.filter(function (s) { return s.id === id; })[0] || null;
  }

  function renderStage(boat) {
    var scan = selected[boat] ? findScan(selected[boat]) : null;
    var stage = document.getElementById("stage-" + boat);
    var dataBox = document.getElementById("data-" + boat);

    if (!scan) {
      stage.innerHTML = "<div class='scan-stage__empty'>No scan selected — adjust filters or add a scan.</div>";
      dataBox.innerHTML = "";
      return;
    }

    stage.innerHTML = "<img src='" + scan.file + "' alt='" + boat + " sail scan'>";

    var cells = [];
    cells.push(cell("Time", scan.time ? scan.time.replace("T", " ") : "—"));
    cells.push(cell("Batten", scan.battenLabel || "—"));
    cells.push(cell("TWS", scan.wind && scan.wind.tws !== undefined ? scan.wind.tws + " kn" : "—"));
    cells.push(cell("TWA", scan.wind && scan.wind.twa !== undefined ? scan.wind.twa + "°" : "—"));
    cells.push(cell("BSP", scan.boat_ && scan.boat_.bsp !== undefined ? scan.boat_.bsp + " kn" : "—"));
    cells.push(cell("Forestay", scan.mechanic && scan.mechanic.forestay !== undefined ? scan.mechanic.forestay : "—"));
    cells.push(cell("Rake", scan.mechanic && scan.mechanic.rake !== undefined ? scan.mechanic.rake : "—"));
    cells.push(cell("Trim tab", scan.mechanic && scan.mechanic.trimtab !== undefined ? scan.mechanic.trimtab : "—"));

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

  function cell(label, value) {
    return "<div class='scan-data__cell'><span>" + label + "</span><strong>" + value + "</strong></div>";
  }

  function renderOverlay() {
    var a = selected.artemis ? findScan(selected.artemis) : null;
    var g = selected.gemera ? findScan(selected.gemera) : null;
    var wrap = document.getElementById("overlayStage");
    if (!a || !g) {
      wrap.innerHTML = "<div class='scan-stage__empty'>Select a scan for both boats to overlay them.</div>";
      return;
    }
    var opacity = document.getElementById("overlayOpacity").value / 100;
    wrap.innerHTML =
      "<img src='" + g.file + "' style='position:absolute; inset:0; width:100%;'>" +
      "<img src='" + a.file + "' style='position:absolute; inset:0; width:100%; opacity:" + opacity + ";'>";
  }

  function renderAll() {
    populateSelects();
    renderStage("artemis");
    renderStage("gemera");
    renderOverlay();
  }

  ["fTwsMin", "fTwsMax", "fBspMin", "fBspMax", "fCamMin", "fCamMax"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderAll);
  });

  ["artemis", "gemera"].forEach(function (boat) {
    document.getElementById("select-" + boat).addEventListener("change", function (e) {
      selected[boat] = e.target.value || null;
      renderStage(boat);
      renderOverlay();
    });
  });

  document.getElementById("overlayOpacity").addEventListener("input", renderOverlay);

  document.getElementById("resetFiltersBtn").addEventListener("click", function () {
    ["fTwsMin", "fTwsMax", "fBspMin", "fBspMax", "fCamMin", "fCamMax"].forEach(function (id) {
      document.getElementById(id).value = "";
    });
    renderAll();
  });

  // ---------- Add scan ----------

  var addForm = document.getElementById("addScanForm");
  var photoDataUrl = null;

  document.getElementById("addPhotoInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { photoDataUrl = reader.result; };
    reader.readAsDataURL(file);
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
      file: photoDataUrl,
      time: document.getElementById("addTime").value,
      battenLabel: document.getElementById("addBatten").value,
      wind: { tws: numOrNull("addTws"), twa: numOrNull("addTwa") },
      boat_: { bsp: numOrNull("addBsp") },
      mechanic: { forestay: numOrNull("addForestay"), rake: numOrNull("addRake"), trimtab: numOrNull("addTrimtab") },
      camber: camber
    };
    scans.push(scan);
    persist();
    renderAll();
    addForm.reset();
    photoDataUrl = null;
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
      // Photos added via the browser are inlined as data URLs — flag them so they get
      // saved out as real files before publishing (data URLs bloat the JS file fast).
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
