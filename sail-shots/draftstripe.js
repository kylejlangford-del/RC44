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

  // `cropNat` (optional) restricts the working canvas to a sub-region of the original image,
  // given in natural (full-photo) pixel coordinates: { x0, y0, x1, y1 }. Used by the paint-a-
  // corridor flow so detection only ever looks at the area the sailor dragged over, and can
  // upscale that small region for more effective resolution (a `maxDim` of e.g. 900 downscales
  // a full photo, but is often an UPSCALE for a tight crop, which helps rather than hurts).
  function buildWorkingCanvas(imgEl, maxDim, cropNat) {
    var iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
    if (!iw || !ih) return null;
    var srcX = 0, srcY = 0, srcW = iw, srcH = ih;
    if (cropNat) {
      srcX = Math.max(0, Math.min(iw - 1, Math.round(cropNat.x0)));
      srcY = Math.max(0, Math.min(ih - 1, Math.round(cropNat.y0)));
      srcW = Math.max(1, Math.min(iw - srcX, Math.round(cropNat.x1 - cropNat.x0)));
      srcH = Math.max(1, Math.min(ih - srcY, Math.round(cropNat.y1 - cropNat.y0)));
    }
    var scaleCap = cropNat ? 3 : 1; // allow upscaling a small painted crop, never a full photo
    var scale = Math.min(scaleCap, maxDim / Math.max(srcW, srcH));
    var w = Math.max(1, Math.round(srcW * scale));
    var h = Math.max(1, Math.round(srcH * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    try {
      ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, w, h);
    } catch (err) {
      return null;
    }
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      return null; // cross-origin, can't inspect pixels
    }
    return { w: w, h: h, data: data, scale: scale, naturalW: iw, naturalH: ih, roiX: srcX, roiY: srcY };
  }

  // Raw LAB 'a' (red/magenta-ness) field plus its mean/std -- the continuous signal a coloured
  // stripe stands out in, before any thresholding. Shared by the whole-photo blob detector and
  // the paint-guided ridge follower below.
  function computeAField(work) {
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
    var std = Math.sqrt(sq / n) || 1;
    return { field: aCh, mean: mean, std: std };
  }

  function computeMask(work) {
    var f = computeAField(work);
    var aCh = f.field, n = aCh.length;
    var threshold = Math.max(f.mean + 1.3 * f.std, f.mean + 9);
    var mask = new Uint8Array(n);
    for (var k = 0; k < n; k++) mask[k] = aCh[k] > threshold ? 1 : 0;
    return mask;
  }

  // Fast separable box blur (mean over a square window), used as a cheap local-background
  // estimate -- the same role a Gaussian blur plays in the validated Python/OpenCV prototype,
  // but done with running sums so it stays fast on a phone at these image sizes.
  function boxBlur(src, w, h, r) {
    if (r <= 0) return src.slice();
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var win = 2 * r + 1;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      var acc = 0;
      for (var x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (var x2 = 0; x2 < w; x2++) {
        tmp[row + x2] = acc / win;
        var addX = Math.min(w - 1, x2 + r + 1), subX = Math.max(0, x2 - r);
        acc += src[row + addX] - src[row + subX];
      }
    }
    for (var x3 = 0; x3 < w; x3++) {
      var acc2 = 0;
      for (var y2 = -r; y2 <= r; y2++) acc2 += tmp[Math.min(h - 1, Math.max(0, y2)) * w + x3];
      for (var y3 = 0; y3 < h; y3++) {
        out[y3 * w + x3] = acc2 / win;
        var addY = Math.min(h - 1, y3 + r + 1), subY = Math.max(0, y3 - r);
        acc2 += tmp[addY * w + x3] - tmp[subY * w + x3];
      }
    }
    return out;
  }

  // Second detection mode: a pale/light-coloured stripe on dark cloth (the common case on
  // dark laminate sails, as opposed to a red/coloured stripe). Instead of a colour channel,
  // this looks for thin ridges that are brighter than their own local surroundings -- a cheap
  // JS stand-in for a white top-hat filter, validated against real dark-sail photos.
  // Raw local-contrast residual field (a pale ridge's continuous signal) plus the sail-cloth
  // mask and residual mean/std it was judged against. Shared by the whole-photo blob detector
  // and the paint-guided ridge follower below.
  function computeLightField(work) {
    var w = work.w, h = work.h, data = work.data;
    var n = w * h;
    var lum = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    var bgR = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    var bg = boxBlur(lum, w, h, bgR);
    var residual = new Float32Array(n);
    for (var j = 0; j < n; j++) residual[j] = lum[j] - bg[j];

    // Exclude sky / very bright regions (a strong, dominant edge there would otherwise
    // swamp everything else). Judge "is this area sky or sail cloth" from the BLURRED
    // background brightness, not the raw pixel -- a thin bright stripe barely moves its
    // own local average (the blur radius is well wider than the stripe), so this keeps
    // stripe pixels in even when the stripe itself is nearly as bright as the sky, while
    // still rejecting the sky region (which is uniformly bright, blurred or not).
    var sumBg = 0;
    for (var jj = 0; jj < n; jj++) sumBg += bg[jj];
    var meanBg = sumBg / n;
    var sqBg = 0;
    for (var jk = 0; jk < n; jk++) { var db = bg[jk] - meanBg; sqBg += db * db; }
    var stdBg = Math.sqrt(sqBg / n);
    var darkCut = Math.min(195, Math.max(115, meanBg + 0.4 * stdBg));
    var sailMask = new Uint8Array(n);
    for (var k = 0; k < n; k++) sailMask[k] = bg[k] < darkCut ? 1 : 0;
    var erR = Math.max(2, Math.round(Math.min(w, h) * 0.018));
    sailMask = erode(sailMask, w, h, erR);

    var residSum = 0, residCount = 0;
    for (var m = 0; m < n; m++) {
      if (!sailMask[m]) continue;
      residSum += residual[m]; residCount++;
    }
    var residMean = residCount ? residSum / residCount : 0;
    var sqR = 0;
    for (var mm = 0; mm < n; mm++) {
      if (!sailMask[mm]) continue;
      var dr = residual[mm] - residMean; sqR += dr * dr;
    }
    var residStd = (residCount ? Math.sqrt(sqR / residCount) : 1) || 1;
    return { field: residual, sailMask: sailMask, mean: residMean, std: residStd };
  }

  function computeMaskLight(work) {
    var f = computeLightField(work);
    var residual = f.field, sailMask = f.sailMask, n = residual.length;
    var rThresh = Math.max(f.mean + 2.2 * f.std, f.mean + 5);
    var mask = new Uint8Array(n);
    for (var p = 0; p < n; p++) mask[p] = (sailMask[p] && residual[p] > rThresh) ? 1 : 0;
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

  // Median cross-sectional thickness of a component along its long (span) axis -- used to
  // reject things that are LONG but not actually THIN, like sail-number lettering or a bold
  // seam band, which a plain span*(1-fill) score doesn't reliably catch (a row of digits has
  // plenty of empty space between/inside the glyphs, so its fill ratio can look almost as low
  // as a real stripe's even though it's much thicker at any given point along its length).
  function medianThickness(c, horizontal) {
    var pts = c.pts, n = c.count;
    var lo = horizontal ? c.minX : c.minY, hi = horizontal ? c.maxX : c.maxY;
    var span = hi - lo + 1;
    // Exact per-column (or per-row) pixel counts -- how many mask pixels sit at each single
    // x position (for a mostly-horizontal component) -- not an aggregate over a wider window,
    // which would conflate the stripe's own along-axis slope with its cross-axis thickness.
    var counts = new Int32Array(span);
    for (var i = 0; i < n; i++) {
      var v = horizontal ? pts[i * 2] : pts[i * 2 + 1];
      var idx = Math.min(span - 1, Math.max(0, v - lo));
      counts[idx]++;
    }
    var nonZero = [];
    for (var k = 0; k < span; k++) if (counts[k] > 0) nonZero.push(counts[k]);
    if (!nonZero.length) return 0;
    nonZero.sort(function (a, b) { return a - b; });
    return nonZero[Math.floor(nonZero.length / 2)];
  }

  function pickStripe(comps, w, h, minSpanFrac) {
    var diag = Math.sqrt(w * w + h * h);
    var minSpan = diag * (minSpanFrac || 0.12);
    var maxThick = Math.max(3, Math.round(diag * 0.012));
    var best = null, bestScore = -1;
    comps.forEach(function (c) {
      var bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      var span = Math.max(bw, bh);
      if (span < minSpan) return;
      var thick = medianThickness(c, bw >= bh);
      if (thick > maxThick) return;
      var area = bw * bh;
      var fill = c.count / area;
      var score = span * (1 - Math.min(fill, 0.9));
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (best) best.score = bestScore;
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

  // Runs one mask-building pass through the shared close/open + connected-components +
  // scoring pipeline. `closeMul` widens the closing step for modes whose stripe tends to be
  // dashed/broken (the light-stripe mode) so nearby fragments bridge into one component.
  // Resample a rough hand-drawn polyline into evenly spaced points along its length, with a
  // light moving-average smoothing pass first (finger/mouse drags are jittery; the tangent
  // estimate below needs a stable direction, not every wobble).
  function resamplePolyline(points, spacing) {
    if (points.length < 2) return points.slice();
    var smoothed = points.map(function (p, i) {
      var lo = Math.max(0, i - 2), hi = Math.min(points.length - 1, i + 2);
      var sx = 0, sy = 0, c = 0;
      for (var k = lo; k <= hi; k++) { sx += points[k].x; sy += points[k].y; c++; }
      return { x: sx / c, y: sy / c };
    });
    var cum = [0];
    for (var i = 1; i < smoothed.length; i++) {
      var dx = smoothed[i].x - smoothed[i - 1].x, dy = smoothed[i].y - smoothed[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var total = cum[cum.length - 1];
    if (total < 1e-6) return [smoothed[0]];
    var count = Math.max(4, Math.round(total / spacing) + 1);
    var out = [];
    var seg = 0;
    for (var s = 0; s < count; s++) {
      var target = (s / (count - 1)) * total;
      while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
      var segLen = cum[seg + 1] - cum[seg];
      var t = segLen > 1e-6 ? (target - cum[seg]) / segLen : 0;
      out.push({
        x: smoothed[seg].x + (smoothed[seg + 1].x - smoothed[seg].x) * t,
        y: smoothed[seg].y + (smoothed[seg + 1].y - smoothed[seg].y) * t
      });
    }
    return out;
  }

  // Per-sample normal (perpendicular to the local tangent, from neighbouring samples).
  function computeNormals(pts) {
    var n = pts.length;
    var normals = [];
    for (var i = 0; i < n; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      normals.push({ x: -dy / len, y: dx / len });
    }
    return normals;
  }

  function sampleBilinear(field, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return -50; // strongly discourage leaving the photo
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    var fx = x - x0, fy = y - y0;
    var v00 = field[y0 * w + x0], v10 = field[y0 * w + x1], v01 = field[y1 * w + x0], v11 = field[y1 * w + x1];
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  }

  // The core of "paint the stripe": instead of thresholding the whole corridor and picking the
  // best blob (which a sail-number stencil can win locally), walk perpendicular slices along
  // the sailor's rough path and find the single best-scoring ridge through them via dynamic
  // programming -- classic "snake"/livewire-style contour fitting. A quadratic penalty on how
  // far the offset moves between adjacent slices means a strong but ISOLATED distractor (a
  // letter's edge sitting just off the true line for a few slices) rarely wins, because jumping
  // to it and back costs more than just coasting straight through on the smoothness prior alone
  // -- which is exactly the behaviour we want under a sail number the real stripe runs beneath.
  function followPaintedRidge(work, pointsWork, radiusWork) {
    var w = work.w, h = work.h;
    if (pointsWork.length < 2) return null;

    var aF = computeAField(work);
    var lF = computeLightField(work);
    var n = w * h;
    var combined = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var za = (aF.field[i] - aF.mean) / aF.std;
      var zl = (lF.field[i] - lF.mean) / lF.std;
      combined[i] = Math.max(za, zl);
    }

    var spacing = Math.max(2, radiusWork * 0.35);
    var center = resamplePolyline(pointsWork, spacing);
    if (center.length < 4) return null;
    var normals = computeNormals(center);

    var R = Math.max(4, Math.round(radiusWork * 0.9));
    var states = 2 * R + 1;
    var M = center.length;

    var cost = new Float32Array(M * states);
    for (var t = 0; t < M; t++) {
      var c = center[t], nrm = normals[t];
      for (var oi = 0; oi < states; oi++) {
        var o = oi - R;
        var s = sampleBilinear(combined, w, h, c.x + nrm.x * o, c.y + nrm.y * o);
        cost[t * states + oi] = -s;
      }
    }

    // Quadratic smoothness penalty between consecutive slices' offsets, searched within a
    // bounded window (an offset rarely needs to jump far between adjacent, closely-spaced
    // slices, and bounding this keeps the DP fast at any brush radius).
    var lambda = 0.05;
    var win = Math.max(6, Math.round(R * 0.25));
    var dp = new Float32Array(M * states);
    var back = new Int16Array(M * states);
    for (var oi0 = 0; oi0 < states; oi0++) dp[oi0] = cost[oi0];
    for (var t2 = 1; t2 < M; t2++) {
      for (var oi2 = 0; oi2 < states; oi2++) {
        var best = Infinity, bestPrev = oi2;
        var lo = Math.max(0, oi2 - win), hi = Math.min(states - 1, oi2 + win);
        for (var pOi = lo; pOi <= hi; pOi++) {
          var diff = oi2 - pOi;
          var val = dp[(t2 - 1) * states + pOi] + lambda * diff * diff;
          if (val < best) { best = val; bestPrev = pOi; }
        }
        dp[t2 * states + oi2] = best + cost[t2 * states + oi2];
        back[t2 * states + oi2] = bestPrev;
      }
    }

    var bestFinal = 0, bestVal = Infinity;
    for (var oiF = 0; oiF < states; oiF++) {
      var v = dp[(M - 1) * states + oiF];
      if (v < bestVal) { bestVal = v; bestFinal = oiF; }
    }
    var offsets = new Int16Array(M);
    offsets[M - 1] = bestFinal;
    for (var t3 = M - 1; t3 > 0; t3--) offsets[t3 - 1] = back[t3 * states + offsets[t3]];

    var curve = [];
    var scoreSum = 0;
    for (var t4 = 0; t4 < M; t4++) {
      var o4 = offsets[t4] - R;
      var c4 = center[t4], nrm4 = normals[t4];
      curve.push({ x: c4.x + nrm4.x * o4, y: c4.y + nrm4.y * o4 });
      scoreSum += -cost[t4 * states + offsets[t4]];
    }
    return { curve: curve, avgScore: scoreSum / M };
  }

  function detectFromMask(mask, w, h, closeMul, paintMask, minSpanFrac) {
    if (paintMask) {
      var restricted = new Uint8Array(w * h);
      for (var pm = 0; pm < mask.length; pm++) restricted[pm] = (mask[pm] && paintMask[pm]) ? 1 : 0;
      mask = restricted;
    }
    var closeR = Math.max(3, Math.round(Math.min(w, h) * 0.018 * (closeMul || 1)));
    mask = dilate(mask, w, h, closeR);
    mask = erode(mask, w, h, closeR);
    // The "open" (noise-removal) step must stay sized to the stripe's own thickness, NOT to
    // however wide we had to make the close step to bridge dashes -- otherwise a big closeMul
    // (needed to bridge a dashed stripe) also inflates the open radius past the stripe's own
    // thickness and erases it completely after closing. Base it on the un-multiplied radius.
    var baseR = Math.max(3, Math.round(Math.min(w, h) * 0.018));
    var openR = Math.max(1, Math.round(baseR * 0.2));
    mask = erode(mask, w, h, openR);
    mask = dilate(mask, w, h, openR);
    var comps = connectedComponents(mask, w, h);
    return pickStripe(comps, w, h, minSpanFrac);
  }

  // `paintStroke` (optional): { points: [{x,y}, ...], radius } all in the ORIGINAL image's
  // natural pixel space -- a hand-dragged corridor the sailor painted roughly along the stripe.
  // When given, detection crops to (and upscales) just that corridor's bounding box and only
  // ever considers pixels within `radius` of the painted path, so a sail-number stencil or a
  // seam elsewhere in the photo can no longer be mistaken for the stripe -- it's simply outside
  // the corridor. Without it, the whole photo is scanned as before.
  function analyze(imgEl, paintStroke) {
    var hasStroke = paintStroke && paintStroke.points && paintStroke.points.length > 0;
    var cropNat = null;
    if (hasStroke) {
      var r = paintStroke.radius || 40;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      paintStroke.points.forEach(function (p) {
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      });
      var pad = r * 1.6;
      cropNat = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }

    var work = buildWorkingCanvas(imgEl, hasStroke ? 1100 : 900, cropNat);
    if (!work) return { status: "none", reason: "Couldn't read this photo's pixels (cross-origin image)." };

    var scale = 1 / work.scale;
    function toNat(p) { return { x: work.roiX + p.x * scale, y: work.roiY + p.y * scale }; }

    if (hasStroke) {
      var pointsWork = paintStroke.points.map(function (p) {
        return { x: (p.x - work.roiX) * work.scale, y: (p.y - work.roiY) * work.scale };
      });
      var radiusWork = (paintStroke.radius || 40) * work.scale;

      // Follow the actual ridge under the sailor's stroke rather than thresholding the whole
      // corridor and picking the best blob -- robust to a letter or seam crossing part of the
      // path, since the DP's smoothness prior carries the trace through a short bad stretch.
      var ridge = followPaintedRidge(work, pointsWork, radiusWork);
      if (!ridge || ridge.curve.length < 4) {
        return { status: "none", reason: "Couldn't find a clear stripe along that painted path — try tracing more closely along the stripe, or place points by hand." };
      }
      var rMath = chordMath(ridge.curve);
      if (!rMath) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

      // A low average score means long stretches were carried by the smoothness prior alone,
      // not real contrast -- likely crossing a sail number, a seam, or just a faint patch.
      var weak = ridge.avgScore < 1.0;
      return {
        status: weak ? "flagged" : "ok",
        reason: weak ? "Part of the painted path had weak contrast (maybe crossing lettering or a seam) — check the trace closely before trusting it, or place points by hand." : "",
        mode: "paint",
        curve: ridge.curve.map(toNat),
        chordA: toNat(rMath.chordA),
        chordB: toNat(rMath.chordB),
        camberPct: rMath.camberPct,
        draftPct: rMath.draftPct,
        entryDeg: rMath.entryDeg,
        exitDeg: rMath.exitDeg
      };
    }

    // Whole-photo scan (no painted hint): try two independent blob detectors and keep
    // whichever finds the more convincing stripe -- a coloured (red-ish) stripe via LAB 'a',
    // and a pale stripe on dark cloth via local brightness contrast.
    var redBest = detectFromMask(computeMask(work), work.w, work.h, 1);
    var lightBest = detectFromMask(computeMaskLight(work), work.w, work.h, 2.2);

    var best = null, mode = null;
    if (redBest && lightBest) {
      if (redBest.score >= lightBest.score) { best = redBest; mode = "colour"; }
      else { best = lightBest; mode = "light"; }
    } else if (redBest) { best = redBest; mode = "colour"; }
    else if (lightBest) { best = lightBest; mode = "light"; }

    if (!best) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

    var curve = extractCurve(best);
    if (curve.length < 10) {
      return { status: "flagged", reason: "The stripe was only faintly visible — check or place points by hand.", curve: [], toNatural: null };
    }

    var math = chordMath(curve);
    if (!math) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

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
      mode: mode,
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
