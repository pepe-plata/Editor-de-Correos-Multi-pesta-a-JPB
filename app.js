import { parseMsgFile } from 'msg-lens';
import PostalMime from 'postal-mime';

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const tabsBar = document.getElementById('tabsBar');
const editor = document.getElementById('editor');
const subject = document.getElementById('subject');
const toField = document.getElementById('toField');
const ccField = document.getElementById('ccField');
const charCount = document.getElementById('charCount');

let tabs = [];
let activeTabId = null;
let tabCounter = 1;

function uid() { return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function getActiveTab() { return tabs.find(t => t.id === activeTabId); }

function saveActiveTabState() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.subject = subject.value;
  tab.to = toField.value;
  tab.cc = ccField.value;
  tab.body = editor.innerHTML;
}

function loadTabToEditor(tab) {
  subject.value = tab.subject || '';
  toField.value = tab.to || '';
  ccField.value = tab.cc || '';
  editor.innerHTML = tab.body || '';
  updateCharCount();
  updateToolbarState();
  syncColorsFromSelection();
  syncFontFromSelection();
}

function markActiveTabDirty() {
  const tab = getActiveTab();
  if (!tab) return;
  if (!tab.dirty) { tab.dirty = true; renderTabs(); }
}

/* ============================================================
   PESTAÑAS
   ============================================================ */
function renderTabs() {
  tabsBar.querySelectorAll('.tab').forEach(el => el.remove());
  const newBtn = document.getElementById('newTabBtn');
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.dirty ? ' tab-dirty' : '');
    el.dataset.id = tab.id;
    el.title = tab.filename || tab.title;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    el.appendChild(titleSpan);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Cerrar pestaña';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    el.appendChild(closeBtn);
    el.addEventListener('dblclick', e => { e.stopPropagation(); startRenameTab(tab.id, el, titleSpan); });
    el.addEventListener('click', () => switchTab(tab.id));
    tabsBar.insertBefore(el, newBtn);
  });
}

function startRenameTab(id, tabEl, titleSpan) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const input = document.createElement('input');
  input.className = 'tab-title-input';
  input.value = tab.title;
  titleSpan.replaceWith(input);
  input.focus(); input.select();
  const finish = (commit) => {
    if (commit && input.value.trim()) tab.title = input.value.trim();
    renderTabs();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

function createTab(opts = {}) {
  const id = uid();
  const tab = {
    id,
    title: opts.title || `Correo ${tabCounter++}`,
    subject: opts.subject || '',
    to: opts.to || '',
    cc: opts.cc || '',
    body: opts.body || '',
    filename: opts.filename || null,
    dirty: false
  };
  tabs.push(tab);
  activeTabId = id;
  renderTabs();
  loadTabToEditor(tab);
  return tab;
}

function switchTab(id) {
  if (id === activeTabId) return;
  saveActiveTabState();
  activeTabId = id;
  renderTabs();
  loadTabToEditor(getActiveTab());
  if (typeof setZoom === 'function') setZoom(1.0);
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.dirty && !confirm(`La pestaña "${tab.title}" tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
  if (id === activeTabId) saveActiveTabState();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab(); return; }
  if (id === activeTabId) {
    const newIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[newIdx].id;
    loadTabToEditor(tabs[newIdx]);
  }
  renderTabs();
}

document.getElementById('newTabBtn').addEventListener('click', () => {
  saveActiveTabState();
  createTab();
});

/* ============================================================
   ABRIR ARCHIVOS (botón)
   ============================================================ */
const openFileInput = document.getElementById('openFileInput');
document.getElementById('openFileBtn').addEventListener('click', () => openFileInput.click());

openFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  saveActiveTabState();
  for (const file of files) {
    await openFileIntoNewTab(file);
  }
  openFileInput.value = '';
});

/* Función compartida entre el botón y el launchQueue */
async function openFileIntoNewTab(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    let parsed;
    if (ext === 'msg') parsed = await parseMsgFileBrowser(file);
    else if (ext === 'eml') parsed = await parseEmlBrowser(file);
    else if (ext === 'html' || ext === 'htm') parsed = await parseHtmlFile(file);
    else { alert(`Formato no soportado: ${file.name}`); return; }

    createTab({
      title: parsed.title || file.name.replace(/\.[^.]+$/, ''),
      subject: parsed.subject,
      to: parsed.to || '',
      cc: parsed.cc || '',
      body: parsed.body,
      filename: file.name
    });

    if (parsed.body) {
      extractAndRegisterColorsFromHtml(parsed.body);
    }
  } catch (err) {
    console.error(`Error al abrir ${file.name}:`, err);
    alert(`No se pudo abrir "${file.name}": ${err.message || err}`);
  }
}

/* -------- Parser .msg con msg-lens -------- */
async function parseMsgFileBrowser(file) {
  const buffer = await file.arrayBuffer();
  const result = parseMsgFile(buffer);

  if (!result.success) {
    throw new Error(`Error al parsear .msg (${result.error.code}): ${result.error.message}`);
  }

  const msg = result.message;
  let body = msg.bodyHtml || '';
  body = ensureCharset(body);

  return {
    title: msg.subject || file.name.replace(/\.msg$/i, ''),
    subject: msg.subject || '',
    to: formatRecipients(msg.recipients),
    cc: formatRecipients(msg.ccRecipients),
    body: body
  };
}

function ensureCharset(html) {
  if (!html) return html;
  if (/<meta[^>]+charset/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, '$&<meta charset="utf-8">');
  }
  return `<meta charset="utf-8">${html}`;
}

/* -------- Parser .eml con postal-mime -------- */
async function parseEmlBrowser(file) {
  const buffer = await file.arrayBuffer();
  const email = await PostalMime.parse(buffer);

  let body = email.html || '';
  if (!body && email.text) body = email.text.replace(/\n/g, '<br>');
  body = resolveInlineImages(body, email.attachments);
  body = ensureCharset(body);

  return {
    title: email.subject || file.name.replace(/\.eml$/i, ''),
    subject: email.subject || '',
    to: formatRecipients(email.to),
    cc: formatRecipients(email.cc),
    body: body
  };
}

function formatRecipients(list) {
  if (!list) return '';
  if (typeof list === 'string') return list;
  if (!Array.isArray(list)) list = [list];
  return list.map(r => {
    if (typeof r === 'string') return r;
    const name = r.name || '';
    const address = r.address || r.email || '';
    if (name && address) return `${name} <${address}>`;
    return address || name;
  }).filter(Boolean).join('; ');
}

function resolveInlineImages(html, attachments) {
  if (!html || !attachments || !attachments.length) return html;
  attachments.forEach(att => {
    if (!att.contentId) return;
    let cid = att.contentId.replace(/^<|>$/g, '');
    let base64 = '';
    if (att.content instanceof ArrayBuffer) {
      const bytes = new Uint8Array(att.content);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64 = btoa(binary);
    } else if (typeof att.content === 'string') {
      base64 = att.content;
    }
    if (!base64) return;
    const dataUri = `data:${att.mimeType || 'image/png'};base64,${base64}`;
    const regex = new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    html = html.replace(regex, dataUri);
  });
  return html;
}

/* -------- Parser .html -------- */
async function parseHtmlFile(file) {
  const html = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const metaSubject = doc.querySelector('meta[name="subject"]');
  const metaTo = doc.querySelector('meta[name="to"]');
  const metaCc = doc.querySelector('meta[name="cc"]');
  let subjectVal = metaSubject ? metaSubject.getAttribute('content') || '' : (doc.title || '');
  let toVal = metaTo ? metaTo.getAttribute('content') || '' : '';
  let ccVal = metaCc ? metaCc.getAttribute('content') || '' : '';
  let body = '';
  const bodyEl = doc.getElementById('email-body');
  if (bodyEl) body = bodyEl.innerHTML;
  else if (doc.body) body = doc.body.innerHTML;
  return {
    title: doc.title || file.name.replace(/\.html?$/i, ''),
    subject: subjectVal,
    to: toVal,
    cc: ccVal,
    body
  };
}

/* ============================================================
   EXTRACCIÓN DE COLORES DEL CORREO ABIERTO
   ============================================================ */
function extractAndRegisterColorsFromHtml(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  const foreColors = new Set();
  const backColors = new Set();

  const elements = temp.querySelectorAll('*');
  elements.forEach(el => {
    if (el.style) {
      if (el.style.color) foreColors.add(normalizeColor(el.style.color));
      if (el.style.backgroundColor && el.style.backgroundColor !== 'transparent') {
        backColors.add(normalizeColor(el.style.backgroundColor));
      }
    }
    if (el.getAttribute) {
      const colorAttr = el.getAttribute('color');
      if (colorAttr) foreColors.add(normalizeColor(colorAttr));
      const bgAttr = el.getAttribute('bgcolor');
      if (bgAttr) backColors.add(normalizeColor(bgAttr));
    }
  });

  temp.querySelectorAll('font[color]').forEach(f => {
    const c = f.getAttribute('color');
    if (c) foreColors.add(normalizeColor(c));
  });

  const isValid = c => c && (/^#[0-9a-f]{3,8}$/i.test(c) || /^rgb/i.test(c));

  foreColors.forEach(c => { if (isValid(c)) addRecent('fore', c); });
  backColors.forEach(c => { if (isValid(c)) addRecent('back', c); });
}

/* ============================================================
   COLORES
   ============================================================ */
const THEME_COLORS = [
  '#ffffff','#000000','#e7e6e6','#44546a','#4472c4','#ed7d31','#a5a5a5','#ffc000',
  '#5b9bd5','#70ad47','#264478','#9e480e','#636363','#997300','#255e91','#43682b'
];
const STANDARD_COLORS = [
  '#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0',
  '#002060','#7030a0','#ff00ff','#ff99cc','#a52a2a','#808080','#d3d3d3','#ffffff'
];

const MAX_RECENT = 8;
function loadRecent(kind) {
  try { return JSON.parse(localStorage.getItem(`recentColors_${kind}`) || '[]'); } catch { return []; }
}
function saveRecent(kind, colors) { localStorage.setItem(`recentColors_${kind}`, JSON.stringify(colors)); }

function addRecent(kind, color) {
  if (!color) return;
  color = normalizeColor(color);
  if (!color) return;
  let list = loadRecent(kind);
  list = list.filter(c => c.toLowerCase() !== color.toLowerCase());
  list.unshift(color);
  if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
  saveRecent(kind, list);
  renderRecent(kind);
}

function normalizeColor(c) {
  if (!c) return null;
  c = c.trim();
  if (/^(transparent|inherit|initial|unset|currentcolor|none)$/i.test(c)) return null;

  if (/^rgba?\(/i.test(c)) {
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      return '#' + [m[0], m[1], m[2]].map(x => {
        const v = Math.round(+x);
        return v.toString(16).padStart(2, '0');
      }).join('');
    }
  }

  if (/^[a-z]+$/i.test(c)) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = c;
      const computed = ctx.fillStyle;
      if (computed.startsWith('#')) return computed;
      if (computed.startsWith('rgb')) {
        const m = computed.match(/\d+/g);
        if (m && m.length >= 3) return '#' + [m[0], m[1], m[2]].map(x => (+x).toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
  }
  return c;
}

function buildSwatches(container, colors, onPick) {
  container.innerHTML = '';
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('mousedown', e => e.preventDefault());
    sw.addEventListener('click', () => onPick(c));
    container.appendChild(sw);
  });
}
function renderRecent(kind) {
  const container = document.getElementById(kind === 'fore' ? 'foreRecentContainer' : 'backRecentContainer');
  const list = loadRecent(kind);
  if (!list.length) { container.innerHTML = '<p class="no-recent">Aún no hay colores recientes</p>'; return; }
  const grid = document.createElement('div');
  grid.className = 'color-grid';
  list.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch recent';
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('mousedown', e => e.preventDefault());
    sw.addEventListener('click', () => applyColor(kind, c));
    grid.appendChild(sw);
  });
  container.innerHTML = '';
  container.appendChild(grid);
}

let savedRange = null;
function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}
function applyColor(kind, color) {
  editor.focus();
  restoreSelection();
  const cmd = kind === 'fore' ? 'foreColor' : 'hiliteColor';
  if (kind === 'back') document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, color);
  addRecent(kind, color);
  updateColorSwatch(kind, color);
  closeAllPopups();
  updateToolbarState();
  updateCharCount();
  markActiveTabDirty();
}
function updateColorSwatch(kind, color) {
  const el = document.getElementById(kind === 'fore' ? 'foreColorSwatch' : 'backColorSwatch');
  if (el && color) el.style.background = color;
}
function setupColorButton(kind) {
  const btn = document.getElementById(kind === 'fore' ? 'foreColorBtn' : 'backColorBtn');
  const popup = document.getElementById(kind === 'fore' ? 'foreColorPopup' : 'backColorPopup');
  const themeGrid = document.getElementById(kind === 'fore' ? 'foreThemeGrid' : 'backThemeGrid');
  const stdGrid = document.getElementById(kind === 'fore' ? 'foreStandardGrid' : 'backStandardGrid');
  const customInput = document.getElementById(kind === 'fore' ? 'foreCustom' : 'backCustom');
  buildSwatches(themeGrid, THEME_COLORS, c => applyColor(kind, c));
  buildSwatches(stdGrid, STANDARD_COLORS, c => applyColor(kind, c));
  renderRecent(kind);
  btn.addEventListener('mousedown', e => { e.preventDefault(); saveSelection(); });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popup.classList.contains('show');
    closeAllPopups();
    if (!isOpen) popup.classList.add('show');
  });
  customInput.addEventListener('input', e => updateColorSwatch(kind, e.target.value));
  customInput.addEventListener('change', e => applyColor(kind, e.target.value));
  popup.querySelector('.clear-recent').addEventListener('click', e => {
    e.stopPropagation();
    saveRecent(kind, []);
    renderRecent(kind);
  });
  popup.addEventListener('mousedown', e => e.stopPropagation());
}
function closeAllPopups() { document.querySelectorAll('.color-popup.show').forEach(p => p.classList.remove('show')); }
document.addEventListener('click', closeAllPopups);
setupColorButton('fore');
setupColorButton('back');

function getComputedColor(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el) return null;
  const style = window.getComputedStyle(el);
  return { fore: rgbToHex(style.color), back: rgbToHex(style.backgroundColor) };
}
function rgbToHex(rgb) {
  if (!rgb) return null;
  if (rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + [m[0], m[1], m[2]].map(x => (+x).toString(16).padStart(2, '0')).join('');
}
function syncColorsFromSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node) return;
  const colors = getComputedColor(node);
  if (!colors) return;
  if (colors.fore) document.getElementById('foreColorSwatch').style.background = colors.fore;
  const backColor = colors.back;
  const displayBack = (backColor === 'rgba(0,0,0,0)' || !backColor) ? '#ffffff' : backColor;
  document.getElementById('backColorSwatch').style.background = displayBack;
}

/* ============================================================
   SINCRONIZACIÓN DE FUENTE, TAMAÑO E INTERLINEADO
   ============================================================ */
const KNOWN_FONTS = [
  'Aptos', 'Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium',
  'Georgia', 'Helvetica', 'Lucida Sans Unicode', 'Palatino Linotype',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'
];

function extractPrimaryFontName(fontFamilyString) {
  if (!fontFamilyString) return '';
  const parts = fontFamilyString.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));

  for (const part of parts) {
    const found = KNOWN_FONTS.find(k => k.toLowerCase() === part.toLowerCase());
    if (found) return found;
  }

  for (const part of parts) {
    const found = KNOWN_FONTS.find(k => part.toLowerCase().includes(k.toLowerCase()));
    if (found) return found;
  }

  const generic = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|-apple-system|inherit|initial)$/i;
  for (const part of parts) {
    if (part && !generic.test(part)) return part;
  }
  return parts[0] || '';
}

function syncFontFromSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;

  // --- Tipo de letra ---
  let fontName = '';
  try { fontName = document.queryCommandValue('fontName') || ''; } catch (e) {}

  if (!fontName) {
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    if (node) fontName = window.getComputedStyle(node).fontFamily;
  }

  fontName = extractPrimaryFontName(fontName);

  const fontNameSelect = document.getElementById('fontName');
  if (fontName && fontNameSelect) {
    const match = Array.from(fontNameSelect.options).find(
      opt => opt.value.toLowerCase() === fontName.toLowerCase()
    );
    if (match) {
      const temp = fontNameSelect.querySelector('option[data-temp="1"]');
      if (temp) temp.remove();
      fontNameSelect.value = match.value;
    } else {
      let tempOpt = fontNameSelect.querySelector('option[data-temp="1"]');
      if (!tempOpt) {
        tempOpt = document.createElement('option');
        tempOpt.dataset.temp = '1';
        fontNameSelect.appendChild(tempOpt);
      }
      tempOpt.value = fontName;
      tempOpt.textContent = fontName;
      fontNameSelect.value = fontName;
    }
  }

  // --- Tamaño de letra ---
  let sizeIndex = '';
  try { sizeIndex = document.queryCommandValue('fontSize') || ''; } catch (e) {}
  const fontSizeSelect = document.getElementById('fontSize');
  if (fontSizeSelect) {
    if (sizeIndex && /^[1-7]$/.test(sizeIndex)) {
      fontSizeSelect.value = sizeIndex;
    } else {
      let node = range.startContainer;
      if (node.nodeType === 3) node = node.parentElement;
      if (node) {
        const px = parseFloat(window.getComputedStyle(node).fontSize);
        if (!isNaN(px)) fontSizeSelect.value = mapPxToFontSize(px);
      }
    }
  }

  // --- Interlineado ---
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const lineHeightSelect = document.getElementById('lineHeight');
  if (node && lineHeightSelect) {
    const style = window.getComputedStyle(node);
    const lh = style.lineHeight;
    if (lh && lh !== 'normal') {
      const fontSizePx = parseFloat(style.fontSize);
      const lhPx = parseFloat(lh);
      if (fontSizePx > 0 && lhPx > 0) {
        const ratio = lhPx / fontSizePx;
        const match = Array.from(lineHeightSelect.options).find(
          opt => Math.abs(parseFloat(opt.value) - ratio) < 0.06
        );
        if (match) {
          lineHeightSelect.value = match.value;
        } else {
          let tempOpt = lineHeightSelect.querySelector('option[data-temp="1"]');
          if (!tempOpt) {
            tempOpt = document.createElement('option');
            tempOpt.dataset.temp = '1';
            lineHeightSelect.appendChild(tempOpt);
          }
          const displayRatio = ratio.toFixed(2);
          tempOpt.value = displayRatio;
          tempOpt.textContent = `Interlineado ${displayRatio}`;
          lineHeightSelect.value = displayRatio;
        }
      }
    } else if (lh === 'normal') {
      lineHeightSelect.value = '1';
    }
  }
}

function mapPxToFontSize(px) {
  if (px <= 9) return '1';
  if (px <= 11) return '2';
  if (px <= 13) return '3';
  if (px <= 16) return '4';
  if (px <= 20) return '5';
  if (px <= 28) return '6';
  return '7';
}

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      saveSelection();
      syncColorsFromSelection();
      syncFontFromSelection();
      updateToolbarState();
    }
  }
});

/* ============================================================
   ZOOM CON CTRL + RUEDA DEL MOUSE
   ============================================================ */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;
let zoomLevel = 1.0;

const zoomIndicator = document.createElement('div');
zoomIndicator.id = 'zoomIndicator';
document.querySelector('.editor-body').appendChild(zoomIndicator);

let zoomIndicatorTimeout = null;
function showZoomIndicator() {
  zoomIndicator.textContent = Math.round(zoomLevel * 100) + '%';
  zoomIndicator.classList.add('show');
  clearTimeout(zoomIndicatorTimeout);
  zoomIndicatorTimeout = setTimeout(() => {
    zoomIndicator.classList.remove('show');
  }, 1200);
}

function applyZoom() {
  editor.style.transformOrigin = 'top left';
  editor.style.transform = `scale(${zoomLevel})`;
  editor.style.width = (100 / zoomLevel) + '%';
}

function setZoom(level) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  applyZoom();
  showZoomIndicator();
}

editor.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  setZoom(zoomLevel + delta * ZOOM_STEP);
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    setZoom(zoomLevel + ZOOM_STEP);
  } else if (e.key === '-') {
    e.preventDefault();
    setZoom(zoomLevel - ZOOM_STEP);
  } else if (e.key === '0') {
    e.preventDefault();
    setZoom(1.0);
  }
});

/* ============================================================
   COMANDOS Y TOOLBAR
   ============================================================ */
function exec(cmd, value = null) {
  editor.focus();
  restoreSelection();
  document.execCommand(cmd, false, value);
  updateToolbarState();
  updateCharCount();
  markActiveTabDirty();
  syncFontFromSelection();
  syncColorsFromSelection();
}

document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', e => { e.preventDefault(); exec(btn.dataset.cmd); });
});
document.getElementById('fontName').addEventListener('change', e => exec('fontName', e.target.value));
document.getElementById('fontSize').addEventListener('change', e => exec('fontSize', e.target.value));
document.getElementById('clearFormat').addEventListener('click', () => exec('removeFormat'));
document.getElementById('removeFormat').addEventListener('click', () => {
  const text = editor.innerText;
  editor.innerHTML = text.replace(/\n/g, '<br>');
  updateCharCount();
  markActiveTabDirty();
  syncFontFromSelection();
});

document.getElementById('lineHeight').addEventListener('change', e => {
  editor.focus(); restoreSelection();
  applyLineHeight(e.target.value);
  markActiveTabDirty();
  syncFontFromSelection();
});
function applyLineHeight(lh) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    let block = findBlockElement(node);
    if (block && editor.contains(block)) block.style.lineHeight = lh;
    return;
  }
  const blocks = getBlocksInRange(range);
  blocks.forEach(b => b.style.lineHeight = lh);
}
function findBlockElement(node) {
  const blockTags = ['P','DIV','LI','H1','H2','H3','H4','H5','H6','TD','TH','BLOCKQUOTE','PRE'];
  while (node && node !== editor) {
    if (node.nodeType === 1 && blockTags.includes(node.tagName)) return node;
    node = node.parentElement;
  }
  return null;
}
function getBlocksInRange(range) {
  const blocks = new Set();
  const all = editor.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre');
  all.forEach(el => { if (range.intersectsNode(el)) blocks.add(el); });
  if (!blocks.size) {
    const b = findBlockElement(range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer);
    if (b) blocks.add(b);
  }
  return Array.from(blocks);
}

document.getElementById('insertImage').addEventListener('click', () => {
  editor.focus(); restoreSelection();
  const url = prompt('URL de la imagen (o deja vacío para subir un archivo):');
  if (url) { exec('insertImage', url); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => exec('insertImage', e.target.result);
    reader.readAsDataURL(file);
  };
  input.click();
});
document.getElementById('insertLink').addEventListener('click', () => {
  editor.focus(); restoreSelection();
  const sel = window.getSelection().toString();
  const url = prompt('URL del enlace:', 'https://');
  if (url) {
    if (sel) exec('createLink', url);
    else {
      editor.focus();
      document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${url}</a>`);
      markActiveTabDirty();
    }
  }
});
document.getElementById('insertTable').addEventListener('click', () => {
  editor.focus(); restoreSelection();
  const rows = parseInt(prompt('Número de filas:', '3'), 10) || 3;
  const cols = parseInt(prompt('Número de columnas:', '3'), 10) || 3;
  let html = '<table>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
    html += '</tr>';
  }
  html += '</table><p><br></p>';
  exec('insertHTML', html);
});
const emojis = ['😀','😂','😍','👍','👏','🎉','❤️','🔥','✅','📌','📎','📅','💡','⚠️','📧','✉️','🌟','🙏','💼','🚀'];
document.getElementById('insertEmoji').addEventListener('click', e => {
  e.preventDefault(); editor.focus(); restoreSelection();
  const pick = prompt('Elige un emoji:\n' + emojis.join(' '), '😀');
  if (pick) exec('insertText', pick);
});

function updateToolbarState() {
  ['bold','italic','underline','strikeThrough','superscript','subscript',
   'insertUnorderedList','insertOrderedList',
   'justifyLeft','justifyCenter','justifyRight','justifyFull'].forEach(cmd => {
    const btn = document.querySelector(`button[data-cmd="${cmd}"]`);
    if (btn) { try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch(e) {} }
  });
}
function updateCharCount() { charCount.textContent = `${editor.innerText.length} caracteres`; }

editor.addEventListener('input', () => { updateCharCount(); markActiveTabDirty(); });
editor.addEventListener('mouseup', () => {
  saveSelection();
  syncColorsFromSelection();
  syncFontFromSelection();
  updateToolbarState();
});
editor.addEventListener('keyup', () => {
  saveSelection();
  syncColorsFromSelection();
  syncFontFromSelection();
  updateToolbarState();
});
subject.addEventListener('input', () => markActiveTabDirty());
toField.addEventListener('input', () => markActiveTabDirty());
ccField.addEventListener('input', () => markActiveTabDirty());

/* ============================================================
   MODAL Y EXPORTACIÓN
   ============================================================ */
const modal = document.getElementById('htmlModal');
const htmlOutput = document.getElementById('htmlOutput');
function getFullHtml() { return editor.innerHTML; }

document.getElementById('viewHtml').addEventListener('click', () => {
  htmlOutput.value = getFullHtml();
  modal.classList.add('show');
});
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('closeModalBtn').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('copyFromModal').addEventListener('click', () => {
  navigator.clipboard.writeText(htmlOutput.value).then(() => {
    document.getElementById('copyFromModal').textContent = '¡Copiado!';
    setTimeout(() => { document.getElementById('copyFromModal').textContent = 'Copiar'; }, 1500);
  });
});
document.getElementById('copyHtml').addEventListener('click', () => {
  navigator.clipboard.writeText(getFullHtml()).then(() => {
    const btn = document.getElementById('copyHtml');
    const orig = btn.textContent;
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
});
document.getElementById('downloadHtml').addEventListener('click', () => {
  const tab = getActiveTab();
  const name = tab ? (tab.title || 'correo') : 'correo';
  const subjectVal = subject.value;
  const toVal = toField.value;
  const ccVal = ccField.value;
  const fullDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="subject" content="${escapeHtml(subjectVal)}">
<meta name="to" content="${escapeHtml(toVal)}">
<meta name="cc" content="${escapeHtml(ccVal)}">
<title>${escapeHtml(subjectVal || name)}</title>
</head>
<body>
<div id="email-body">${getFullHtml()}</div>
</body>
</html>`;
  const blob = new Blob([fullDoc], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (subjectVal || name).replace(/[^\w\-]+/g, '_') + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
  if (tab) { tab.dirty = false; renderTabs(); }
});
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
document.getElementById('clearAll').addEventListener('click', () => {
  if (confirm('¿Limpiar todo el contenido?')) {
    editor.innerHTML = '';
    subject.value = '';
    toField.value = '';
    ccField.value = '';
    updateCharCount();
    markActiveTabDirty();
    syncFontFromSelection();
  }
});
editor.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); }
});

/* ============================================================
   INSTALACIÓN PWA (botón en la cabecera)
   ============================================================ */
let deferredInstallPrompt = null;
const installAppBtn = document.getElementById('installAppBtn');

// Chrome dispara este evento cuando la app es instalable
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installAppBtn.removeAttribute('hidden');
});

installAppBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log(`Instalación: ${outcome}`);
  deferredInstallPrompt = null;
  installAppBtn.setAttribute('hidden', '');
});

window.addEventListener('appinstalled', () => {
  installAppBtn.setAttribute('hidden', '');
  console.log('PWA instalada correctamente');
});

/* ============================================================
   MANEJO DE ARCHIVOS ABIERTOS DESDE EL EXPLORADOR (PWA)
   ============================================================ */
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files.length) return;
    saveActiveTabState();
    for (const fileHandle of launchParams.files) {
      try {
        const file = await fileHandle.getFile();
        await openFileIntoNewTab(file);
      } catch (err) {
        console.error('Error al abrir archivo desde el sistema:', err);
      }
    }
  });
}

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
createTab({ title: 'Correo 1' });