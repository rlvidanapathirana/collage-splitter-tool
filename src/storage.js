// storage.js — persists user settings to localStorage

const STORAGE_KEY = 'collage-splitter-v5';

const defaults = {
  cols: 3,
  rows: 3,
  trimEnabled: true,
  trimX: 0,   // left/right inset (pixels)
  trimY: 0,   // top/bottom inset (pixels)
  colLines: null,
  rowLines: null,
};

export function saveSettings(patch) {
  try {
    const current = loadSettings();
    const next = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (_) {}
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    // Migrate old single trimPx → trimX + trimY
    if (parsed.trimPx !== undefined && parsed.trimX === undefined) {
      parsed.trimX = parsed.trimPx;
      parsed.trimY = parsed.trimPx;
    }
    return { ...defaults, ...parsed };
  } catch (_) {
    return { ...defaults };
  }
}

export function clearLineSettings() {
  saveSettings({ colLines: null, rowLines: null });
}
