// downloader.js — metadata-scrubbed, uniquely-named frame exports

/**
 * Build a unique filename for a frame.
 * Format: frame_r{row+1}c{col+1}_YYYYMMDD_HHMMSS_MMM.png
 */
export function buildFilename(r, c) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  
  return `frame_r${r + 1}c${c + 1}_${yyyy}${mm}${dd}_${hh}${min}${ss}_${ms}.png`;
}

/**
 * Crop a single cell from the source image with independent X and Y insets,
 * and return a Blob with all metadata stripped (canvas toBlob = zero EXIF/XMP/ICC).
 *
 * @param {HTMLImageElement} img
 * @param {number} sx   Source x
 * @param {number} sy   Source y
 * @param {number} sw   Source width
 * @param {number} sh   Source height
 * @param {number} trimX  Left+right inset in pixels (each side)
 * @param {number} trimY  Top+bottom inset in pixels (each side)
 * @param {string} format
 * @returns {Promise<Blob>}
 */
export function cropToBlob(img, sx, sy, sw, sh, trimX = 0, trimY = 0, format = 'image/png') {
  const tx = Math.max(0, trimX);
  const ty = Math.max(0, trimY);

  const cx = sx + tx;
  const cy = sy + ty;
  const cw = Math.max(1, sw - tx * 2);
  const ch = Math.max(1, sh - ty * 2);

  const tmp = document.createElement('canvas');
  tmp.width  = Math.round(cw);
  tmp.height = Math.round(ch);
  tmp.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, tmp.width, tmp.height);

  return new Promise(resolve => tmp.toBlob(resolve, format));
}
