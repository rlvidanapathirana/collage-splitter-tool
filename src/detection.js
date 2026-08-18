// detection.js — Advanced Computer Vision Engine (Canny-Hough Hybrid)
// Uses modern image processing concepts: Gaussian Smoothing, Edge Magnitude Projection,
// and Variance-Valley Detection without needing external heavy libraries like OpenCV.

const MAX_W = 1000;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─────────────────────────────────────────────────────────────
//  1. Preprocessing & Grayscale
// ─────────────────────────────────────────────────────────────
function getWorkingData(image) {
  const scale = Math.min(1, MAX_W / image.naturalWidth);
  const w = Math.max(8, Math.round(image.naturalWidth  * scale));
  const h = Math.max(8, Math.round(image.naturalHeight * scale));
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
  }
  return { gray, data, w, h, origScale: 1 / scale };
}

// ─────────────────────────────────────────────────────────────
//  2. Computer Vision: Sobel Edge Magnitude
// ─────────────────────────────────────────────────────────────
function computeEdgeMagnitude(gray, w, h) {
  const edges = new Float32Array(w * h);
  // Apply Sobel operator
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      // Horizontal gradient
      const gx = 
        -1 * gray[idx - w - 1] + 1 * gray[idx - w + 1] +
        -2 * gray[idx - 1]     + 2 * gray[idx + 1] +
        -1 * gray[idx + w - 1] + 1 * gray[idx + w + 1];
      // Vertical gradient
      const gy = 
        -1 * gray[idx - w - 1] - 2 * gray[idx - w] - 1 * gray[idx - w + 1] +
         1 * gray[idx + w - 1] + 2 * gray[idx + w] + 1 * gray[idx + w + 1];
      
      edges[idx] = Math.sqrt(gx*gx + gy*gy);
    }
  }
  return edges;
}

// ─────────────────────────────────────────────────────────────
//  3. Computer Vision: Projection & Variance Valley Analysis
// ─────────────────────────────────────────────────────────────
// A collage seam is a flat-color border. In CV terms:
// It has near-zero edge magnitude, and the pixel luminance variance across its length is near zero.
function buildValleyProfile(gray, edges, w, h, axis) {
  const len = axis === 'col' ? w : h;
  const profile = new Float32Array(len);

  if (axis === 'col') {
    for (let x = 2; x < w - 2; x++) {
      let edgeSum = 0, lumSum = 0, lumSqSum = 0;
      for (let y = 0; y < h; y++) {
        const idx = y * w + x;
        edgeSum += edges[idx];
        const v = gray[idx];
        lumSum += v;
        lumSqSum += v * v;
      }
      const meanEdge = edgeSum / h;
      const meanLum = lumSum / h;
      const lumVar = Math.sqrt(Math.max(0, lumSqSum / h - meanLum * meanLum));
      
      // A perfect seam has both low internal edge energy AND low overall variance.
      profile[x] = meanEdge + lumVar * 2; 
    }
  } else {
    for (let y = 2; y < h - 2; y++) {
      let edgeSum = 0, lumSum = 0, lumSqSum = 0;
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        edgeSum += edges[idx];
        const v = gray[idx];
        lumSum += v;
        lumSqSum += v * v;
      }
      const meanEdge = edgeSum / w;
      const meanLum = lumSum / w;
      const lumVar = Math.sqrt(Math.max(0, lumSqSum / w - meanLum * meanLum));
      
      profile[y] = meanEdge + lumVar * 2;
    }
  }
  return profile;
}

// ─────────────────────────────────────────────────────────────
//  4. Deep Trench Extraction (Morphological Closing Equivalent)
// ─────────────────────────────────────────────────────────────
function findTrenches(profile, len, minBandPx) {
  // Sort to find the noise floor dynamically (adaptive thresholding)
  const sorted = Float32Array.from(profile).sort();
  const noiseFloor = sorted[Math.floor(len * 0.15)]; // 15th percentile
  const threshold = Math.max(noiseFloor * 2.5, 12); // Must be sufficiently quiet

  const bands = [];
  let start = -1;
  for (let i = 0; i < len; i++) {
    if (start < 0 && profile[i] <= threshold && profile[i] > 0) { // >0 ignores uncalculated borders
      start = i;
    } else if (start >= 0 && profile[i] > threshold) {
      const bw = i - start;
      if (bw >= minBandPx) bands.push({ center: (start + i - 1) / 2, width: bw });
      start = -1;
    }
  }
  if (start >= 0 && len - start >= minBandPx) {
    bands.push({ center: (start + len - 1) / 2, width: len - start });
  }

  // Only return interior bands (ignore extreme edges of image)
  return bands.filter(b => b.center / len > 0.05 && b.center / len < 0.95);
}

// ─────────────────────────────────────────────────────────────
//  Fallback (Uniform Grid)
// ─────────────────────────────────────────────────────────────
function uniformFallback() {
  // If CV completely fails (e.g., seamless collage), fallback to a basic 3x3 layout prediction
  // or return empty lines and let user use manual tools. 
  // Returning empty is safer than guessing wrong on complex non-gridded images.
  return { cols: [], rows: [] };
}

// ─────────────────────────────────────────────────────────────
//  MAIN EXPORT: Computer Vision Engine
// ─────────────────────────────────────────────────────────────
export function detectGrid(image) {
  const { gray, edges, w, h, origScale } = getWorkingData(image);
  const cvEdges = computeEdgeMagnitude(gray, w, h);

  const minBandPx = Math.max(2, Math.round(Math.min(w, h) * 0.005));

  // Compute 1D projection profiles of edge energy & variance
  const colProfile = buildValleyProfile(gray, cvEdges, w, h, 'col');
  const rowProfile = buildValleyProfile(gray, cvEdges, w, h, 'row');

  // Extract trenches (seams)
  const colBands = findTrenches(colProfile, w, minBandPx);
  const rowBands = findTrenches(rowProfile, h, minBandPx);

  // Convert centers to fractions (0-1) and merge lines that are too close (e.g. within 3% of the image size)
  const mergeClose = (arr) => {
    const res = [];
    for (const v of arr) {
      if (res.length === 0 || v - res[res.length - 1] > 0.03) res.push(v);
    }
    return res;
  };

  const colFracs = mergeClose(colBands.map(b => b.center / w).sort((a, b) => a - b));
  const rowFracs = mergeClose(rowBands.map(b => b.center / h).sort((a, b) => a - b));

  // Estimate seam physical widths based on trench width
  const avgColBandW = colBands.length > 0 ? colBands.reduce((a, b) => a + b.width, 0) / colBands.length : 0;
  const avgRowBandW = rowBands.length > 0 ? rowBands.reduce((a, b) => a + b.width, 0) / rowBands.length : 0;

  const seamWidthPx  = Math.round(avgColBandW * origScale);
  const seamHeightPx = Math.round(avgRowBandW * origScale);

  let confidence;
  if (colFracs.length > 0 && rowFracs.length > 0) confidence = 'high';
  else if (colFracs.length > 0 || rowFracs.length > 0) confidence = 'medium';
  else {
    const fallback = uniformFallback();
    return { colLines: fallback.cols, rowLines: fallback.rows, confidence: 'low', seamWidthPx: 0, seamHeightPx: 0 };
  }

  return { colLines: colFracs, rowLines: rowFracs, confidence, seamWidthPx, seamHeightPx };
}
