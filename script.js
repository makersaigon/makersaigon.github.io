// script.js — MakerSG ESP32 Pro Flasher (compat: read existing DOM options OR render defaults)
// Paste this to replace current script.js

const MANIFEST_URL = './manifest.json';
const CHUNK_SIZE = 16 * 1024;
const AUTO_BOOT_SIGNALS = true;

// UI refs (guarding for missing IDs)
function requireId(id){ return document.getElementById(id); }
const $programs = requireId('programs');
const $chips = requireId('chips');
const $oleds = requireId('oleds');
const $connectBtn = requireId('connect-btn');
let $installBtn = requireId('install-btn');
const $downloadBtn = requireId('download-btn');
const $serialStatus = requireId('serial-status');
const $progressBar = requireId('progress-bar');
const $progressText = requireId('progress-text');
const $log = requireId('log');
const $fwVersion = requireId('fw-version');
const $fwSize = requireId('fw-size');
const $fwSha = requireId('fw-sha');

function safeLog(...args){
  if($log){
    const t = new Date().toLocaleTimeString();
    $log.classList.remove('logs-empty');
    $log.textContent += `\n[${t}] ${args.join(' ')}`;
    $log.scrollTop = $log.scrollHeight;
  } else {
    console.log(...args);
  }
}

function humanSize(bytes){
  if(!bytes) return '—';
  const units = ['B','KB','MB','GB'];
  let i=0; let v=bytes;
  while(v>=1024 && i<units.length-1){ v/=1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

async function sha256Hex(buffer){
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function updateProgress(pct, loaded, total){
  if($progressBar && $progressText){
    if(pct === null){
      $progressBar.style.width = '0%';
      $progressText.textContent = `${humanSize(loaded)} / ${total?humanSize(total):'—'}`;
    } else {
      $progressBar.style.width = `${pct}%`;
      $progressText.textContent = `${pct}% • ${humanSize(loaded)} / ${total?humanSize(total):'—'}`;
    }
  }
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

let manifestMap = null;
let state = {
  program: null,
  chip: null,
  oled: null,
  manifest: null,
  port: null,
  reader: null,
  writer: null,
  esploader: null
};

// Default lists (used if DOM options not present)
const defaultPrograms = [
  { id: 'mochinav', label: 'MochiNav', meta: 'Navigation module' },
  { id: 'chatbot', label: 'ChatBot AI', meta: 'AI assistant' }
];
const defaultChips = [
  { id: 'ESP32-S3-M16R8', label: 'ESP32-S3 M16R8' },
  { id: 'ESP32-S3-SUPER', label: 'ESP32-S3 Super' },
  { id: 'ESP32-S3-ZERO', label: 'ESP32-S3 Zero' }
];
const defaultOleds = [
  { id: 'OLED-0.91', label: 'OLED 0.91"' },
  { id: 'OLED-0.96', label: 'OLED 0.96"' },
  { id: 'OLED-1.3', label: 'OLED 1.3"' }
];

// Utility to create card element (matches style)
function createCard(item, group){
  const el = document.createElement('div');
  el.className = 'card card-clickable';
  el.tabIndex = 0;
  el.dataset.optId = item.id;
  el.dataset.optGroup = group;
  el.innerHTML = `<div><strong>${item.label}</strong><div style="font-size:0.85rem;color:var(--muted-fg)">${item.meta||''}</div></div>`;
  el.addEventListener('click', ()=> onOptionClick(item.id, group, el));
  el.addEventListener('keydown', e => { if(e.key === 'Enter') onOptionClick(item.id, group, el); });
  return el;
}

function onOptionClick(id, group, el){
  if(group === 'program'){
    state.program = id;
    if($programs) Array.from($programs.children).forEach(n=>n.classList.remove('card-selected'));
  }
  if(group === 'chip'){
    state.chip = id;
    if($chips) Array.from($chips.children).forEach(n=>n.classList.remove('card-selected'));
  }
  if(group === 'oled'){
    state.oled = id;
    if($oleds) Array.from($oleds.children).forEach(n=>n.classList.remove('card-selected'));
  }
  if(el) el.classList.add('card-selected');
  onSelectionChanged();
}

// If index.html already contains cards with data-* attributes, read them
function readExistingOptions(){
  const programs = [];
  const chips = [];
  const oleds = [];
  // find elements with data-program/data-chip/data-oled
  document.querySelectorAll('[data-program]').forEach(n=>{
    const id = n.dataset.program;
    const label = (n.querySelector('.card-title') && n.querySelector('.card-title').textContent) || id;
    programs.push({ id, label });
  });
  document.querySelectorAll('[data-chip]').forEach(n=>{
    const id = n.dataset.chip;
    const label = (n.querySelector('.card-title') && n.querySelector('.card-title').textContent) || id;
    chips.push({ id, label });
  });
  document.querySelectorAll('[data-oled]').forEach(n=>{
    const id = n.dataset.oled;
    const label = (n.querySelector('.oled-size') && n.querySelector('.oled-size').textContent) || id;
    oleds.push({ id, label });
  });
  return { programs, chips, oleds };
}

function renderOptions(){
  // try reading existing DOM options first
  const existing = readExistingOptions();
  const progs = (existing.programs.length ? existing.programs : defaultPrograms);
  const chps  = (existing.chips.length ? existing.chips : defaultChips);
  const olds  = (existing.oleds.length ? existing.oleds : defaultOleds);

  if($programs){ $programs.innerHTML = ''; progs.forEach(p=> $programs.appendChild(createCard(p,'program'))); }
  if($chips){ $chips.innerHTML = ''; chps.forEach(c=> $chips.appendChild(createCard(c,'chip'))); }
  if($oleds){ $oleds.innerHTML = ''; olds.forEach(o=> $oleds.appendChild(createCard(o,'oled'))); }

  // default select first items if not already selected
  if(!state.program && progs[0]) { state.program = progs[0].id; if($programs && $programs.children[0]) $programs.children[0].classList.add('card-selected'); }
  if(!state.chip && chps[0]) { state.chip = chps[0].id; if($chips && $chips.children[0]) $chips.children[0].classList.add('card-selected'); }
  if(!state.oled && olds[0]) { state.oled = olds[0].id; if($oleds && $oleds.children[0]) $oleds.children[0].classList.add('card-selected'); }

  onSelectionChanged();
}

async function loadManifest(){
  try{
    const r = await fetch(MANIFEST_URL + '?_=' + Date.now());
    if(!r.ok) { safeLog('Manifest fetch failed', r.status); manifestMap = {}; return {}; }
    manifestMap = await r.json();
    safeLog('Manifest loaded');
    return manifestMap;
  }catch(e){ safeLog('Manifest load error', e.message); manifestMap = {}; return {}; }
}

async function onSelectionChanged(){
  if(!state.program || !state.chip || !state.oled) return;
  const progKey = state.program === 'chatbot' ? 'ChatBotAI' : (state.program === 'mochinav' ? 'MochiNav' : state.program);
  const key = `${progKey}|${state.chip}|${state.oled}`;
  safeLog('Selection:', key);
  if(!manifestMap) await loadManifest();
  const entry = manifestMap[key] || null;
  state.manifest = entry;
  if(entry){
    if($fwVersion) $fwVersion.textContent = entry.version || '—';
    if($fwSize) $fwSize.textContent = entry.size ? humanSize(entry.size) : '—';
    if($fwSha) $fwSha.textContent = entry.sha256 || '—';
    if($downloadBtn) $downloadBtn.disabled = false;
    if($installBtn) $installBtn.disabled = false;
  } else {
    if($fwVersion) $fwVersion.textContent = 'Không có firmware';
    if($fwSize) $fwSize.textContent = '—';
    if($fwSha) $fwSha.textContent = '—';
    if($downloadBtn) $downloadBtn.disabled = true;
    if($installBtn) $installBtn.disabled = true;
  }
}

// Serial connect/disconnect (simple, safe)
async function connectSerial(){
  if(state.port){ await disconnectSerial(); return; }
  if(!('serial' in navigator)){ alert('Web Serial API không được hỗ trợ'); return; }
  try{
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.port = port;
    if($serialStatus) $serialStatus.textContent = 'Connected';
    if($connectBtn) $connectBtn.textContent = 'Disconnect';
    safeLog('Serial opened');
    // optional auto-boot toggle (best-effort)
    if(AUTO_BOOT_SIGNALS && port.setSignals){
      try{
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await sleep(80);
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
        await sleep(80);
        safeLog('Attempted auto-boot toggle');
      }catch(e){ safeLog('Auto-boot toggle not supported', e.message); }
    }
    startReadLoop(port);
  }catch(e){ safeLog('Serial open failed', e.message); alert('Không thể mở cổng Serial: ' + e.message); }
}

async function disconnectSerial(){
  if(!state.port) return;
  try{
    if(state.reader){ await state.reader.cancel(); state.reader = null; }
    if(state.writer){ try{ await state.writer.close(); }catch(_){} state.writer = null; }
    await state.port.close();
    safeLog('Serial closed');
  }catch(e){ safeLog('Serial close error', e.message); }
  state.port = null;
  if($serialStatus) $serialStatus.textContent = 'Not connected';
  if($connectBtn) $connectBtn.textContent = 'Kết nối';
}

async function startReadLoop(port){
  try{
    const dec = new TextDecoderStream();
    port.readable.pipeTo(dec.writable);
    const reader = dec.readable.getReader();
    state.reader = reader;
    while(true){
      const { value, done } = await reader.read();
      if(done) break;
      if(value) safeLog('[Device]', value.trim());
    }
  }catch(e){ safeLog('Read loop ended', e.message); }
}

// download and install handlers (concise fallback behavior)
async function downloadHandler(){
  if(!state.manifest || !state.manifest.url) return alert('Không có URL firmware');
  try{
    $downloadBtn.disabled = true;
    safeLog('Downloading', state.manifest.url);
    const r = await fetch(state.manifest.url);
    if(!r.ok) throw new Error('Fetch failed: ' + r.status);
    const blob = await r.blob();
    const fname = state.manifest.filename || `firmware-${Date.now()}.bin`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    safeLog('Downloaded', blob.size, 'bytes');
    const buf = await blob.arrayBuffer();
    const h = await sha256Hex(buf);
    safeLog('SHA256', h);
    if($fwSize) $fwSize.textContent = humanSize(blob.size);
    if($fwSha) $fwSha.textContent = h;
  }catch(e){ safeLog('Download error', e.message); alert('Lỗi khi tải firmware: ' + e.message); }
  finally{ $downloadBtn.disabled = false; }
}

async function installHandler(){
  if(!state.manifest || !state.manifest.url) return alert('Không có manifest');
  if(!state.port) return alert('Kết nối thiết bị trước khi nạp');
  if(!confirm('Chắc chắn muốn nạp firmware?')) return;
  $installBtn.disabled = true; if($downloadBtn) $downloadBtn.disabled = true; if($connectBtn) $connectBtn.disabled = true;
  try{
    safeLog('Fetching firmware...');
    const resp = await fetch(state.manifest.url);
    if(!resp.ok) throw new Error('Fetch failed ' + resp.status);
    const total = resp.headers.get('Content-Length') ? Number(resp.headers.get('Content-Length')) : null;
    let loaded = 0, chunks = [];
    const rdr = resp.body.getReader();
    while(true){
      const { done, value } = await rdr.read();
      if(done) break;
      chunks.push(value); loaded += value.length;
      updateProgress(total ? Math.round(loaded/total*100) : null, loaded, total);
    }
    const bin = concatChunks(chunks);
    safeLog('Firmware ready', bin.length, 'bytes');
    const sha = await sha256Hex(bin.buffer);
    safeLog('SHA256', sha);

    // prefer esptool if available
    if(window.ESPLoader && window.ESPTransport){
      try{
        safeLog('Using esptool.js path (if available).');
        const transport = new ESPTransport(state.port);
        const esploader = new ESPLoader({ transport, baudrate: 115200, debug: (m)=>safeLog('[esptool]', m) });
        state.esploader = esploader;
        await esploader.main();
        safeLog('Chip:', esploader.chipName || 'unknown');
        if(state.manifest.parts && Array.isArray(state.manifest.parts)){
          for(const part of state.manifest.parts){
            const addr = Number(part.address);
            let data;
            if(part.url){ const r = await fetch(part.url); data = new Uint8Array(await r.arrayBuffer()); }
            else if(part.data_base64){ const raw = atob(part.data_base64); data = new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) data[i]=raw.charCodeAt(i); }
            else throw new Error('Part missing data/url');
            safeLog(`Flashing part @ 0x${addr.toString(16)} size=${data.length}`);
            await esploader.flashData([{ address: addr, data }]);
            safeLog('Part flashed');
          }
        } else {
          const addr = state.manifest.address ? Number(state.manifest.address) : 0x10000;
          safeLog(`Flashing binary @ 0x${addr.toString(16)} (len=${bin.length})`);
          await esploader.flashData([{ address: addr, data: bin }]);
          safeLog('Flash complete (esptool).');
        }
        updateProgress(100, bin.length, bin.length);
      }catch(e){
        safeLog('esptool path failed:', e.message);
        safeLog('Falling back to raw stream...');
        await fallbackRawStream(bin);
      }
    } else {
      safeLog('esptool.js not present; using fallback raw stream.');
      await fallbackRawStream(bin);
    }
  }catch(e){
    safeLog('Install failed:', e.message);
    alert('Lỗi khi nạp: ' + e.message);
  } finally {
    $installBtn.disabled = false; if($downloadBtn) $downloadBtn.disabled = false; if($connectBtn) $connectBtn.disabled = false;
  }
}

async function fallbackRawStream(u8){
  if(!state.port) throw new Error('No serial port');
  const writer = state.port.writable.getWriter();
  state.writer = writer;
  try{
    const total = u8.length;
    for(let offset=0; offset<total; offset += CHUNK_SIZE){
      const slice = u8.slice(offset, Math.min(offset+CHUNK_SIZE, total));
      await writer.write(slice);
      const pct = Math.round((offset + slice.length) / total * 100);
      updateProgress(pct, offset + slice.length, total);
      await sleep(20);
    }
    safeLog('All chunks written (raw stream).');
    updateProgress(100, u8.length, u8.length);
  }catch(e){ throw e; }
  finally{ try{ await writer.releaseLock(); }catch(_){} state.writer = null; }
}

function concatChunks(chunks){
  let total = 0;
  for(const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for(const c of chunks){ out.set(c, offset); offset += c.length; }
  return out;
}

// Attach handlers safely (no double listeners)
function attachHandlers(){
  if($connectBtn) { $connectBtn.removeEventListener('click', connectSerial); $connectBtn.addEventListener('click', connectSerial); }
  if($downloadBtn) { $downloadBtn.removeEventListener('click', downloadHandler); $downloadBtn.addEventListener('click', downloadHandler); }
  if($installBtn) {
    // replace node to clear previous listeners (robust)
    const newBtn = $installBtn.cloneNode(true);
    $installBtn.parentNode.replaceChild(newBtn, $installBtn);
    $installBtn = newBtn;
    $installBtn.addEventListener('click', installHandler);
  }
}

(async function init(){
  try{
    renderOptions();
    attachHandlers();
    await loadManifest();
    safeLog('Init complete.');
  }catch(e){ safeLog('Init error', e.message); }
})();
