// script.js — MakerSG ESP32 Flasher (robust init + debug)
// Key fixes:
// - Wait for DOMContentLoaded before querying DOM
// - All UI refs acquired inside init()
// - Defensive guards & helpful console/log output
// - Single install handler, no double-listener
// - Renders options if not present in HTML
// - Adds pointer style to clickable cards for UX

const MANIFEST_URL = './manifest.json';
const CHUNK_SIZE = 16 * 1024;
const AUTO_BOOT_SIGNALS = true;

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

// UI refs (will be assigned in init)
let $programs, $chips, $oleds, $connectBtn, $installBtn, $downloadBtn;
let $serialStatus, $progressBar, $progressText, $log, $fwVersion, $fwSize, $fwSha;

// small helpers
function logUI(...args){
  const t = new Date().toLocaleTimeString();
  const txt = `[${t}] ${args.join(' ')}`;
  if($log){
    $log.classList.remove('logs-empty');
    $log.textContent += '\n' + txt;
    $log.scrollTop = $log.scrollHeight;
  }
  console.log(...args);
}
function humanSize(bytes){
  if(!bytes) return '—';
  const units = ['B','KB','MB','GB'];
  let i=0; let v = bytes;
  while(v >= 1024 && i < units.length - 1){ v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}
async function sha256Hex(buffer){
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
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

// Default option lists (used when HTML doesn't contain data-* options)
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

// Create clickable card element
function createCard(item, group){
  const el = document.createElement('div');
  el.className = 'card card-clickable';
  el.setAttribute('role','button');
  el.tabIndex = 0;
  el.dataset.optId = item.id;
  el.dataset.optGroup = group;
  el.style.cursor = 'pointer';
  el.innerHTML = `<div><strong>${item.label}</strong><div style="font-size:0.85rem;color:var(--muted-fg)">${item.meta||''}</div></div>`;
  el.addEventListener('click', ()=> onOptionClick(item.id, group, el));
  el.addEventListener('keydown', e => { if(e.key === 'Enter') onOptionClick(item.id, group, el); });
  return el;
}

// When user clicks option
function onOptionClick(id, group, el){
  if(group === 'program'){
    state.program = id;
    if($programs) Array.from($programs.children).forEach(n=>n.classList.remove('card-selected'));
  } else if(group === 'chip'){
    state.chip = id;
    if($chips) Array.from($chips.children).forEach(n=>n.classList.remove('card-selected'));
  } else if(group === 'oled'){
    state.oled = id;
    if($oleds) Array.from($oleds.children).forEach(n=>n.classList.remove('card-selected'));
  }
  if(el) el.classList.add('card-selected');
  logUI('Selected', group, id);
  onSelectionChanged(); // update manifest info
}

// Read any existing DOM options (data-program / data-chip / data-oled)
function readExistingOptions(){
  const programs = [];
  const chips = [];
  const oleds = [];
  document.querySelectorAll('[data-program]').forEach(n=>{
    const id = n.dataset.program;
    const label = (n.querySelector('.card-title') && n.querySelector('.card-title').textContent) || id;
    programs.push({ id, label, meta: n.dataset.meta || '' });
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

// Render options into DOM
function renderOptions(){
  const existing = readExistingOptions();
  const progs = existing.programs.length ? existing.programs : defaultPrograms;
  const chps  = existing.chips.length ? existing.chips : defaultChips;
  const olds  = existing.oleds.length ? existing.oleds : defaultOleds;

  if($programs){ $programs.innerHTML = ''; progs.forEach(p=> $programs.appendChild(createCard(p,'program'))); }
  if($chips){ $chips.innerHTML = ''; chps.forEach(c=> $chips.appendChild(createCard(c,'chip'))); }
  if($oleds){ $oleds.innerHTML = ''; olds.forEach(o=> $oleds.appendChild(createCard(o,'oled'))); }

  // default selects (first item)
  if(!state.program && progs[0]) { state.program = progs[0].id; if($programs && $programs.children[0]) $programs.children[0].classList.add('card-selected'); }
  if(!state.chip && chps[0]) { state.chip = chps[0].id; if($chips && $chips.children[0]) $chips.children[0].classList.add('card-selected'); }
  if(!state.oled && olds[0]) { state.oled = olds[0].id; if($oleds && $oleds.children[0]) $oleds.children[0].classList.add('card-selected'); }

  onSelectionChanged();
}

// Load manifest.json
async function loadManifest(){
  try{
    const res = await fetch(MANIFEST_URL + '?_=' + Date.now());
    if(!res.ok){ logUI('Manifest fetch failed', res.status); manifestMap = {}; return {}; }
    manifestMap = await res.json();
    logUI('Loaded manifest entries:', Object.keys(manifestMap).length);
    return manifestMap;
  }catch(e){
    logUI('Manifest load error', e.message);
    manifestMap = {};
    return {};
  }
}

// Called when selection changes — update firmware info and enable buttons
async function onSelectionChanged(){
  if(!state.program || !state.chip || !state.oled) return;
  const progKey = state.program === 'chatbot' ? 'ChatBotAI' : (state.program === 'mochinav' ? 'MochiNav' : state.program);
  const key = `${progKey}|${state.chip}|${state.oled}`;
  logUI('Looking up key:', key);
  if(!manifestMap) await loadManifest();
  const entry = manifestMap[key] || null;
  state.manifest = entry;
  if(entry){
    if($fwVersion) $fwVersion.textContent = entry.version || '—';
    if($fwSize) $fwSize.textContent = entry.size ? humanSize(entry.size) : '—';
    if($fwSha) $fwSha.textContent = entry.sha256 || '—';
    if($downloadBtn) $downloadBtn.disabled = false;
    if($installBtn) $installBtn.disabled = false;
    logUI('Firmware found for selection');
  } else {
    if($fwVersion) $fwVersion.textContent = 'Không có firmware';
    if($fwSize) $fwSize.textContent = '—';
    if($fwSha) $fwSha.textContent = '—';
    if($downloadBtn) $downloadBtn.disabled = true;
    if($installBtn) $installBtn.disabled = true;
    logUI('No firmware for selection');
  }
}

// Serial connect
async function connectSerial(){
  if(state.port){ await disconnectSerial(); return; }
  if(!('serial' in navigator)){ alert('Web Serial API không được hỗ trợ'); return; }
  try{
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.port = port;
    if($serialStatus) $serialStatus.textContent = 'Connected';
    if($connectBtn) $connectBtn.textContent = 'Disconnect';
    logUI('Serial opened');
    if(AUTO_BOOT_SIGNALS && port.setSignals){
      try{
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await sleep(80);
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
        await sleep(80);
        logUI('Attempted auto-boot toggle');
      }catch(e){ logUI('Auto-boot toggle not supported', e.message); }
    }
    startReadLoop(port);
  }catch(e){
    logUI('Serial open failed', e.message);
    alert('Không thể mở cổng Serial: ' + e.message);
  }
}

async function disconnectSerial(){
  if(!state.port) return;
  try{
    if(state.reader){ await state.reader.cancel(); state.reader = null; }
    if(state.writer){ try{ await state.writer.close(); }catch(_){} state.writer = null; }
    await state.port.close();
    logUI('Serial closed');
  }catch(e){ logUI('Serial close error', e.message); }
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
      if(value) logUI('[Device]', value.trim());
    }
  }catch(e){ logUI('Read loop ended', e.message); }
}

// Download firmware for user
async function downloadHandler(){
  if(!state.manifest || !state.manifest.url) return alert('Không có URL firmware');
  try{
    $downloadBtn.disabled = true;
    logUI('Downloading', state.manifest.url);
    const r = await fetch(state.manifest.url);
    if(!r.ok) throw new Error('Fetch failed: ' + r.status);
    const blob = await r.blob();
    const fname = state.manifest.filename || `firmware-${Date.now()}.bin`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    logUI('Downloaded', blob.size, 'bytes');
    const buf = await blob.arrayBuffer();
    const h = await sha256Hex(buf);
    logUI('SHA256', h);
    if($fwSize) $fwSize.textContent = humanSize(blob.size);
    if($fwSha) $fwSha.textContent = h;
  }catch(e){ logUI('Download error', e.message); alert('Lỗi khi tải firmware: ' + e.message); }
  finally{ $downloadBtn.disabled = false; }
}

// Install / flash (uses esptool.js when available, fallback raw stream)
async function installHandler(){
  if(!state.manifest || !state.manifest.url) return alert('Không có manifest');
  if(!state.port) return alert('Kết nối thiết bị trước khi nạp');
  if(!confirm('Chắc chắn muốn nạp firmware?')) return;
  $installBtn.disabled = true; if($downloadBtn) $downloadBtn.disabled = true; if($connectBtn) $connectBtn.disabled = true;
  try{
    logUI('Fetching firmware...');
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
    logUI('Firmware ready', bin.length, 'bytes');
    const sha = await sha256Hex(bin.buffer);
    logUI('SHA256', sha);

    // esptool path
    if(window.ESPLoader && window.ESPTransport){
      try{
        logUI('Using esptool.js path.');
        const transport = new ESPTransport(state.port);
        const esploader = new ESPLoader({ transport, baudrate: 115200, debug: (m)=>logUI('[esptool]', m) });
        state.esploader = esploader;
        await esploader.main();
        logUI('Chip:', esploader.chipName || 'unknown');
        if(state.manifest.parts && Array.isArray(state.manifest.parts)){
          for(const part of state.manifest.parts){
            const addr = Number(part.address);
            let data;
            if(part.url){ const r = await fetch(part.url); data = new Uint8Array(await r.arrayBuffer()); }
            else if(part.data_base64){ const raw = atob(part.data_base64); data = new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) data[i]=raw.charCodeAt(i); }
            else throw new Error('Part missing data/url');
            logUI(`Flashing part @ 0x${addr.toString(16)} size=${data.length}`);
            await esploader.flashData([{ address: addr, data }]);
            logUI('Part flashed');
          }
        } else {
          const addr = state.manifest.address ? Number(state.manifest.address) : 0x10000;
          logUI(`Flashing binary @ 0x${addr.toString(16)} (len=${bin.length})`);
          await esploader.flashData([{ address: addr, data: bin }]);
          logUI('Flash complete (esptool).');
        }
        updateProgress(100, bin.length, bin.length);
      }catch(e){
        logUI('esptool path failed:', e.message);
        logUI('Falling back to raw stream...');
        await fallbackRawStream(bin);
      }
    } else {
      logUI('esptool.js not present; using fallback raw stream.');
      await fallbackRawStream(bin);
    }

  }catch(e){
    logUI('Install failed:', e.message);
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
    logUI('All chunks written (raw stream).');
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

// Remove existing handlers and attach fresh ones (prevents doubles)
function attachHandlers(){
  if($connectBtn) { $connectBtn.onclick = connectSerial; }
  if($downloadBtn) { $downloadBtn.onclick = downloadHandler; }
  if($installBtn) { $installBtn.onclick = installHandler; }
}

// DIAGNOSTIC helper: run in Console if something still fails
function runDiag(){
  console.group('diag');
  console.log('elements:', {
    programs: !!$programs, chips: !!$chips, oleds: !!$oleds,
    connectBtn: !!$connectBtn, installBtn: !!$installBtn, downloadBtn: !!$downloadBtn,
    progressBar: !!$progressBar, progressText: !!$progressText, log: !!$log
  });
  console.log('state.program,chip,oled:', state.program, state.chip, state.oled);
  console.log('manifestMap keys:', manifestMap ? Object.keys(manifestMap).slice(0,20) : 'no manifest loaded');
  console.groupEnd();
}

// INIT: wait until DOM loaded to query elements
document.addEventListener('DOMContentLoaded', async ()=>{
  // acquire refs
  $programs = document.getElementById('programs');
  $chips = document.getElementById('chips');
  $oleds = document.getElementById('oleds');
  $connectBtn = document.getElementById('connect-btn');
  $installBtn = document.getElementById('install-btn');
  $downloadBtn = document.getElementById('download-btn');
  $serialStatus = document.getElementById('serial-status');
  $progressBar = document.getElementById('progress-bar');
  $progressText = document.getElementById('progress-text');
  $log = document.getElementById('log');
  $fwVersion = document.getElementById('fw-version');
  $fwSize = document.getElementById('fw-size');
  $fwSha = document.getElementById('fw-sha');

  // basic sanity
  logUI('DOM ready — attaching UI');
  // add CSS pointer class for interactivity if not present
  try{
    const style = document.createElement('style');
    style.textContent = `.card-clickable{cursor:pointer} .card-selected{outline:3px solid rgba(0,0,0,0.08);box-shadow:0 6px 18px rgba(0,0,0,0.06);transform:translateY(-2px);border-color:var(--primary);background:linear-gradient(180deg, rgba(0,0,0,0.02), transparent)}`;
    document.head.appendChild(style);
  }catch(e){/* ignore */ }

  // render options and attach handlers
  renderOptions();
  attachHandlers();
  await loadManifest();
  logUI('Init complete. Run runDiag() in console for diagnostics.');
});
