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

  // Rasterizes a hand-painted corridor (a polyline of natural-image points plus a half-width,
  // both already converted into WORKING-canvas coordinates by the caller) into a 0/1 mask the
  // same size as the working canvas. Sampling finely along each segment and stamping a small
  // filled square at each sample is cheap and avoids any per-pixel distance-to-polyline math.
  function rasterizeCorridor(pointsWork, radiusWork, w, h) {
    var mask = new Uint8Array(w * h);
    if (!pointsWork || pointsWork.length === 0) return mask;
    var r = Math.max(1, Math.round(radiusWork));
    function stamp(cx, cy) {
      var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      var r2 = r * r;
      for (var y = y0; y <= y1; y++) {
        var dy = y - cy;
        var row = y * w;
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx;
          if (dx * dx + dy * dy <= r2) mask[row + x] = 1;
        }
      }
    }
    if (pointsWork.length === 1) { stamp(pointsWork[0].x, pointsWork[0].y); return mask; }
    for (var i = 0; i < pointsWork.length - 1; i++) {
      var a = pointsWork[i], b = pointsWork[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.5)));
      for (var s = 0; s <= steps; s++) {
        var t = s / steps;
        stamp(a.x + dx * t, a.y + dy * t);
      }
    }
    return mask;
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
  function computeMaskLight(work) {
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
    var residStd = residCount ? Math.sqrt(sqR / residCount) : 1;
    var rThresh = Math.max(residMean + 2.2 * residStd, residMean + 5);

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

    var paintMask = null;
    if (hasStroke) {
      var pointsWork = paintStroke.points.map(function (p) {
        return { x: (p.x - work.roiX) * work.scale, y: (p.y - work.roiY) * work.scale };
      });
      var radiusWork = (paintStroke.radius || 40) * work.scale;
      paintMask = rasterizeCorridor(pointsWork, radiusWork, work.w, work.h);
    }
    // A painted corridor is already a strong, sailor-supplied location prior, so allow a
    // shorter run than the default whole-photo requirement (12% of the crop's own diagonal).
    var minSpanFrac = hasStroke ? 0.04 : 0.12;

    // Try two independent detectors and keep whichever finds the more convincing stripe:
    // a coloured (red-ish) stripe via LAB 'a', and a pale stripe on dark cloth via local
    // brightness contrast. Most dark-hulled/dark-laminate sails use the latter.
    var redBest = detectFromMask(computeMask(work), work.w, work.h, 1, paintMask, minSpanFrac);
    var lightBest = detectFromMask(computeMaskLight(work), work.w, work.h, 2.2, paintMask, minSpanFrac);

    var best = null, mode = null;
    if (redBest && lightBest) {
      if (redBest.score >= lightBest.score) { best = redBest; mode = "colour"; }
      else { best = lightBest; mode = "light"; }
    } else if (redBest) { best = redBest; mode = "colour"; }
    else if (lightBest) { best = lightBest; mode = "light"; }

    if (!best) {
      return {
        status: "none",
        reason: hasStroke
          ? "Couldn't find a clear stripe along that painted path — try tracing more closely along the stripe, or place points by hand."
          : "Couldn't find a clear draft stripe in this photo."
      };
    }

    var curve = extractCurve(best);
    if (curve.length < 10) {
      return { status: "flagged", reason: "The stripe was only faintly visible — check or place points by hand.", curve: [], toNatural: null };
    }

    var math = chordMath(curve);
    if (!math) return { status: "none", reason: "Couldn't find a clear draft stripe in this photo." };

    var scale = 1 / work.scale;
    function toNat(p) { return { x: work.roiX + p.x * scale, y: work.roiY + p.y * scale }; }
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
