// ---------- Draft-stripe auto-detection ----------
// Client-side port of a validated OpenCV/Python prototype. Given an <img>, finds the most
// likely draft-stripe curve, derives a chord from the curve's own endpoints (no manual points
// needed for the happy path), and computes camber %, draft position %, entry/exit angle.
// Flags itself unreliable (status "flagged") when an endpoint looks like it's an artifact of
// the photo frame rather than a true luff/leech edge, or when too little curve was found, so
// the caller can fall back to manual chord-endpoint placement. Returns status "none" when no
// plausible stripe at all was found.
//
// All returned pixel coordinates are in the ORIGINAL image's natural pixel space, so callers
// can convert to xf/yf (0..1) the same way the mast-calibration dialog does.
(function (global) {
  "use strict";

  function rgbToLabA(r, g, b) {
    // sRGB -> linear
    function lin(c) {
      c = c / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var R = lin(r), G = lin(g), B = lin(b);
    // linear sRGB -> XYZ (D65)
    var X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    var Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    var Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
    // normalize by D65 white
    var Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
    }
    var fx = f(X / Xn), fy = f(Y / Yn);
    var a = 500 * (fx - fy); // roughly -128..127, positive = red/magenta
    return a;
  }

  function buildWorkingCanvas(imgEl, maxDim) {
    var iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
    if (!iw || !ih) return null;
    var scale = Math.min(1, maxDim / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * scale));
    var h = Math.max(1, Math.round(ih * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(imgEl, 0, 0, w, h);
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      return null; // cross-origin, can't inspect pixels
    }
    return { w: w, h: h, data: data, scale: scale, naturalW: iw, naturalH: ih };
  }

  function computeMask(work) {
    var w = work.w, h = work.h, data = work.data;
    var n = w * h;
    var aCh = new Float32Array(n);
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      var a = rgbToLabA(data[o], data[o + 1], data[o + 2]);
      aCh[i] = a;
      sum += a;
    }
    var mean = sum / n;
    var sq = 0;
    for (var j = 0; j < n; j++) { var d = aCh[j] - mean; sq += d * d; }
    var std = Math.sqrt(sq / n);
    var threshold = Math.max(mean + 1.3 * std, mean + 9);
    var mask = new Uint8Array(n);
    for (var k = 0; k < n; k++) mask[k] = aCh[k] > threshold ? 1 : 0;
    return mask;
  }

  // Separable binary dilate/erode (max/min over a square window) for speed.
  function dilate(mask, w, h, r) {
    if (r <= 0) return mask;
    var tmp = new Uint8Array(w * h);
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var v = 0;
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        for (var xi = x0; xi <= x1; xi++) { if (mask[row + xi]) { v = 1; break; } }
        tmp[row + x] = v;
      }
    }
    for (var x2 = 0; x2 < w; x2++) {
      for (var y2 = 0; y2 < h; y2++) {
        var v2 = 0;
        var y0 = Math.max(0, y2 - r), y1 = Math.min(h - 1, y2 + r);
        for (var yi = y0; yi <= y1; yi++) { if (tmp[yi * w + x2]) { v2 = 1; break; } }
        out[y2 * w + x2] = v2;
      }
    }
    return out;
  }

  function erode(mask, w, h, r) {
    if (r <= 0) return mask;
    var tmp = new Uint8Array(w * h);
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var v = 1;
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        for (var xi = x0; xi <= x1; xi++) { if (!mask[row + xi]) { v = 0; break; } }
        tmp[row + x] = v;
      }
    }
    for (var x2 = 0; x2 < w; x2++) {
      for (var y2 = 0; y2 < h; y2++) {
        var v2 = 1;
        var y0 = Math.max(0, y2 - r), y1 = Math.min(h - 1, y2 + r);
        for (var yi = y0; yi <= y1; yi++) { if (!tmp[yi * w + x2]) { v2 = 0; break; } }
        out[y2 * w + x2] = v2;
      }
    }
    return out;
  }

  function connectedComponents(mask, w, h) {
    var visited = new Uint8Array(w * h);
    var comps = [];
    var stack = new Int32Array(w * h);
    for (var start = 0; start < w * h; start++) {
      if (!mask[start] || visited[start]) continue;
      var sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      var minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
      var pts = [];
      while (sp > 0) {
        var idx = stack[--sp];
        var x = idx % w, y = (idx / w) | 0;
        count++;
        pts.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack[sp++] = idx - 1; }
        if (x < w - 1 && mask[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack[sp++] = idx + 1; }
        if (y > 0 && mask[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stack[sp++] = idx - w; }
        if (y < h - 1 && mask[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stack[sp++] = idx + w; }
      }
      comps.push({ minX: minX, maxX: maxX, minY: minY, maxY: maxY, count: count, pts: pts });
    }
    return comps;
  }

  function pickStripe(comps, w, h) {
    var diag = Math.sqrt(w * w + h * h);
    var minSpan = diag * 0.12;
    var best = null, bestScore = -1;
    comps.forEach(function (c) {
      var bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      var span = Math.max(bw, bh);
      if (span < minSpan) return;
      var area = bw * bh;
      var fill = c.count / area;
      var score = span * (1 - Math.min(fill, 0.9));
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  // PCA + resample the component into an ordered centerline curve.
  function extractCurve(comp) {
    var pts = comp.pts;
    var n = comp.count;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += pts[i * 2]; sy += pts[i * 2 + 1]; }
    var cx = sx / n, cy = sy / n;
    var sxx = 0, syy = 0, sxy = 0;
    for (var j = 0; j < n; j++) {
      var dx = pts[j * 2] - cx, dy = pts[j * 2 + 1] - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ux = Math.cos(theta), uy = Math.sin(theta);
    var vx = -Math.sin(theta), vy = Math.cos(theta);

    var ts = new Float32Array(n), ds = new Float32Array(n);
    var tMin = Infinity, tMax = -Infinity;
    for (var k = 0; k < n; k++) {
      var ddx = pts[k * 2] - cx, ddy = pts[k * 2 + 1] - cy;
      var t = ddx * ux + ddy * uy;
      var d = ddx * vx + ddy * vy;
      ts[k] = t; ds[k] = d;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }

    var binCount = Math.max(8, Math.min(60, Math.round((tMax - tMin) / 4)));
    var binW = (tMax - tMin) / binCount;
    var sums = new Float64Array(binCount), counts = new Int32Array(binCount);
    for (var m = 0; m < n; m++) {
      var bi = Math.min(binCount - 1, Math.max(0, Math.floor((ts[m] - tMin) / binW)));
      sums[bi] += ds[m];
      counts[bi]++;
    }
    var curve = [];
    for (var b = 0; b < binCount; b++) {
      if (!counts[b]) continue;
      var tMid = tMin + (b + 0.5) * binW;
      var dMean = sums[b] / counts[b];
      curve.push({
        x: cx + tMid * ux + dMean * vx,
        y: cy + tMid * uy + dMean * vy
      });
    }
    return curve;
  }

  function chordMath(curve) {
    var a = curve[0], b = curve[curve.length - 1];
    var cvx = b.x - a.x, cvy = b.y - a.y;
    var chordLen = Math.sqrt(cvx * cvx + cvy * cvy);
    if (chordLen < 1e-6) return null;
    var ux = cvx / chordLen, uy = cvy / chordLen;

    var maxDev = 0, maxDevPos = 0;
    curve.forEach(function (p) {
      var rx = p.x - a.x, ry = p.y - a.y;
      var cross = rx * uy - ry * ux;
      var dot = rx * ux + ry * uy;
      if (Math.abs(cross) > Math.abs(maxDev)) { maxDev = cross; maxDevPos = dot; }
    });

    function tangentAngleDeg(p0, p1) {
      var dx = p1.x - p0.x, dy = p1.y - p0.y;
      var cross = dx * uy - dy * ux;
      var dot = dx * ux + dy * uy;
      return Math.atan2(cross, dot) * 180 / Math.PI;
    }
    var kEntry = Math.max(1, Math.round(curve.length * 0.12));
    var entryDeg = tangentAngleDeg(curve[0], curve[Math.min(curve.length - 1, kEntry)]);
    var exitDeg = tangentAngleDeg(curve[Math.max(0, curve.length - 1 - kEntry)], curve[curve.length - 1]);

    return {
      chordA: a, chordB: b, chordLen: chordLen,
      camberPct: Math.abs(maxDev) / chordLen * 100,
      draftPct: Math.min(100, Math.max(0, maxDevPos / chordLen * 100)),
      entryDeg: entryDeg, exitDeg: exitDeg
    };
  }

  function analyze(imgEl) {
    var work = buildWorkingCanvas(imgEl, 900);
    if (!work) return { status: "none", reason: "Couldn't read this photo's pixels (cross-origin image)." };

    var mask = computeMask(work);
    var closeR = Math.max(3, Math.round(Math.min(work.w, work.h) * 0.018));
    mask = dilate(mask, work.w, work.h, closeR);
    mask = erode(mask, work.w, work.h, closeR);
    var openR = Math.max(1, Math.round(closeR * 0.2));
    mask = erode(mask, work.w, work.h, openR);
    mask = dilate(mask, work.w, work.h, openR);

    var comps = connectedComponents(mask, work.w, work.h);
    var best = pickStripe(comps, work.w, work.h);
    if (!best) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

    var curve = extractCurve(best);
    if (curve.length < 10) {
      return { status: "flagged", reason: "The stripe was only faintly visible — check or place points by hand.", curve: [], toNatural: null };
    }

    var math = chordMath(curve);
    if (!math) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

    var scale = 1 / work.scale;
    function toNat(p) { return { x: p.x * scale, y: p.y * scale }; }
    var curveNat = curve.map(toNat);
    var chordANat = toNat(math.chordA), chordBNat = toNat(math.chordB);

    // Flag endpoints that sit right at the edge of the photo — likely the camera cut the
    // stripe off, not a true luff/leech edge, so the chord isn't trustworthy as-is.
    var edgeMargin = Math.min(work.w, work.h) * 0.02;
    function nearEdge(p) {
      return p.x < edgeMargin || p.x > work.w - edgeMargin || p.y < edgeMargin || p.y > work.h - edgeMargin;
    }
    var clipped = nearEdge(math.chordA) || nearEdge(math.chordB);

    return {
      status: clipped ? "flagged" : "ok",
      reason: clipped ? "One end of the stripe looks like it's cut off by the edge of the photo — check the chord ends, or place them by hand." : "",
      curve: curveNat,
      chordA: chordANat,
      chordB: chordBNat,
      camberPct: math.camberPct,
      draftPct: math.draftPct,
      entryDeg: math.entryDeg,
      exitDeg: math.exitDeg
    };
  }

  // Recompute camber/draft/entry/exit using a manually-placed chord (image natural-pixel coords)
  // but keep the auto-detected curve shape between them — used for the manual-fallback path.
  function recomputeWithChord(curveNat, chordA, chordB) {
    if (!curveNat || curveNat.length < 2) return null;
    var cvx = chordB.x - chordA.x, cvy = chordB.y - chordA.y;
    var chordLen = Math.sqrt(cvx * cvx + cvy * cvy);
    if (chordLen < 1e-6) return null;
    var ux = cvx / chordLen, uy = cvy / chordLen;
    var maxDev = 0, maxDevPos = 0;
    curveNat.forEach(function (p) {
      var rx = p.x - chordA.x, ry = p.y - chordA.y;
      var cross = rx * uy - ry * ux;
      var dot = rx * ux + ry * uy;
      if (Math.abs(cross) > Math.abs(maxDev)) { maxDev = cross; maxDevPos = dot; }
    });
    function tangentAngleDeg(p0, p1) {
      var dx = p1.x - p0.x, dy = p1.y - p0.y;
      var cross = dx * uy - dy * ux;
      var dot = dx * ux + dy * uy;
      return Math.atan2(cross, dot) * 180 / Math.PI;
    }
    var kEntry = Math.max(1, Math.round(curveNat.length * 0.12));
    var entryDeg = tangentAngleDeg(curveNat[0], curveNat[Math.min(curveNat.length - 1, kEntry)]);
    var exitDeg = tangentAngleDeg(curveNat[Math.max(0, curveNat.length - 1 - kEntry)], curveNat[curveNat.length - 1]);
    return {
      camberPct: Math.abs(maxDev) / chordLen * 100,
      draftPct: Math.min(100, Math.max(0, maxDevPos / chordLen * 100)),
      entryDeg: entryDeg,
      exitDeg: exitDeg
    };
  }

  global.DraftStripe = { analyze: analyze, recomputeWithChord: recomputeWithChord };
})(window);
