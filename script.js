// script.js — ENTECH Firmware Flasher (with esptool.js integration)
// Integrated minimal esptool.js flashing workflow: connect → sync → erase_flash → write_flash.
// Assumes esptool.min.js is loaded via CDN in index.html (add this before script.js):
// <script src="https://unpkg.com/esptool-js@latest/bundle.js"></script>
 (Codegrid-inspired UI)
// - Renders program/chip/OLED options
// - Loads manifest map (or fetches from API)
// - Web Serial connect/read/write
// - Downloads binary, computes SHA-256, streams to device in chunks
// NOTE: This is a dev skeleton. For production ESP32 flashing, integrate esptool.js

const MANIFEST_ENDPOINT = null; // Set to an API endpoint string if you have one

// Demo manifest map (override or replace by fetching MANIFEST_ENDPOINT)
const MANIFEST_MAP = {
  "ChatBotAI|ESP32-S3-M16R8|OLED-1.3": {
    version: "1.3.0",
    url: "https://github.com/esp8266/Arduino/raw/master/doc/_static/logo.png",
    size: null,
    sha256: null,
    notes: "Demo firmware — replace with real .bin"
  }
};

// Data models
const programs = [
  { id: 'mochinav', label: 'MochiNav (Paid)', meta: 'Navigation module' },
  { id: 'chatbot', label: 'ChatBot AI (Free)', meta: 'AI assistant' }
];
const chips = [
  { id: 'ESP32-S3-M16R8', label: 'ESP32‑S3 M16R8' },
  { id: 'ESP32-S3-Super', label: 'ESP32‑S3 Super' },
  { id: 'ESP32-S3-Zero', label: 'ESP32‑S3 Zero' }
];
const oleds = [
  { id: 'OLED-0.91', label: 'OLED 0.91"' },
  { id: 'OLED-0.96', label: 'OLED 0.96"' },
  { id: 'OLED-1.3', label: 'OLED 1.3"' }
];

// App state
const state = {
  program: null,
  chip: null,
  oled: null,
  manifest: null,
  bin: null,
  port: null,
  reader: null
};

// DOM references
const $programs = document.getElementById('programs');
const $chips = document.getElementById('chips');
const $oleds = document.getElementById('oleds');
const $fwTitle = document.getElementById('fw-title');
const $fwVersion = document.getElementById('fw-version');
const $fwMeta = document.getElementById('fw-meta') || null; // optional
const $fwSize = document.getElementById('fw-size') || null;
const $connectBtn = document.getElementById('connect-btn');
const $installBtn = document.getElementById('install-btn');
const $downloadBtn = document.getElementById('download-btn');
const $serialStatus = document.getElementById('serial-status');
const $progressBar = document.getElementById('progress-bar');
const $progressText = document.getElementById('progress-text');
const $log = document.getElementById('log');

// ----------------- Utilities -----------------
function log(...msg){
  const t = new Date().toLocaleTimeString();
  $log.textContent += `\n[${t}] ${msg.join(' ')} `;
  $log.scrollTop = $log.scrollHeight;
}

function humanSize(bytes){
  if(!bytes) return '—';
  const units = ['B','KB','MB','GB'];
  let i = 0; let v = bytes;
  while(v >= 1024 && i < units.length - 1){ v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

async function sha256Hex(buffer){
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function concatChunks(chunks){
  let total = chunks.reduce((s,c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for(const c of chunks){ out.set(c, offset); offset += c.length; }
  return out;
}

function updateProgress(pct, loaded, total){
  if(pct === null){
    $progressBar.style.width = '0%';
    $progressText.textContent = `${humanSize(loaded)} / ${total?humanSize(total):'—'}`;
  } else {
    $progressBar.style.width = `${pct}%`;
    $progressText.textContent = `${pct}% • ${humanSize(loaded)} / ${total?humanSize(total):'—'}`;
  }
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// ----------------- Render UI -----------------
function makeOption(item){
  const el = document.createElement('div');
  el.className = 'option';
  el.tabIndex = 0;
  el.innerHTML = `<div class="title">${item.label}</div><div class="meta">${item.meta||''}</div>`;
  el.addEventListener('click', () => onOptionClick(item, el));
  el.addEventListener('keydown', e => { if(e.key === 'Enter') onOptionClick(item, el); });
  return el;
}

function onOptionClick(item, el){
  // determine group by presence in arrays
  if(programs.find(p=>p.id===item.id)){
    state.program = item.id;
    Array.from($programs.children).forEach(n=>n.classList.remove('selected'));
    el.classList.add('selected');
  } else if(chips.find(c=>c.id===item.id)){
    state.chip = item.id;
    Array.from($chips.children).forEach(n=>n.classList.remove('selected'));
    el.classList.add('selected');
  } else if(oleds.find(o=>o.id===item.id)){
    state.oled = item.id;
    Array.from($oleds.children).forEach(n=>n.classList.remove('selected'));
    el.classList.add('selected');
  }
  onSelectionChanged();
}

function renderAll(){
  $programs.innerHTML = '';
  for(const p of programs) $programs.appendChild(makeOption(p));

  $chips.innerHTML = '';
  for(const c of chips) $chips.appendChild(makeOption(c));

  $oleds.innerHTML = '';
  for(const o of oleds) $oleds.appendChild(makeOption(o));

  // default selects
  if($programs.children[1]) $programs.children[1].click();
  if($chips.children[0]) $chips.children[0].click();
  if($oleds.children[2]) $oleds.children[2].click();
}

// ----------------- Manifest loading -----------------
async function loadManifestMap(){
  if(MANIFEST_ENDPOINT){
    try{
      const res = await fetch(MANIFEST_ENDPOINT);
      if(res.ok) return await res.json();
      log('Failed to fetch manifest endpoint', res.status);
    }catch(e){ log('Manifest fetch error', e.message); }
  }
  return MANIFEST_MAP; // fallback
}

async function onSelectionChanged(){
  if(!state.program || !state.chip || !state.oled) return;
  const key = `${state.program==='chatbot' ? 'ChatBotAI' : 'MochiNav'}|${state.chip}|${state.oled}`;
  log('Selected', key);
  const map = await loadManifestMap();
  if(map[key]){
    state.manifest = map[key];
    $fwTitle.textContent = `${state.program==='chatbot' ? 'ChatBot AI' : 'MochiNav'} — ${state.chip}`;
    $fwVersion.textContent = `Version: ${state.manifest.version || '—'}`;
    if($fwMeta) $fwMeta.textContent = state.manifest.notes || '—';
    if($fwSize) $fwSize.textContent = state.manifest.size ? humanSize(state.manifest.size) : '—';
    $downloadBtn.disabled = false;
    $installBtn.disabled = false;
  } else {
    state.manifest = null;
    $fwTitle.textContent = 'Chưa có firmware tương ứng';
    $fwVersion.textContent = '';
    if($fwMeta) $fwMeta.textContent = 'Không tìm thấy firmware cho cấu hình đã chọn.';
    if($fwSize) $fwSize.textContent = '—';
    $downloadBtn.disabled = true;
    $installBtn.disabled = true;
  }
}

// ----------------- Download flow -----------------
$downloadBtn.addEventListener('click', async ()=>{
  if(!state.manifest || !state.manifest.url) return alert('Không có URL firmware');
  try{
    $downloadBtn.disabled = true;
    log('Downloading', state.manifest.url);
    const resp = await fetch(state.manifest.url);
    if(!resp.ok) throw new Error('Fetch failed: ' + resp.status);
    const blob = await resp.blob();
    const a = document.createElement('a');
    const fname = state.manifest.filename || `firmware-${Date.now()}.bin`;
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    log('Downloaded', blob.size, 'bytes');
    const buf = await blob.arrayBuffer();
    const hash = await sha256Hex(buf);
    log('SHA256:', hash);
    if($fwSize) $fwSize.textContent = humanSize(blob.size);
  }catch(e){ log('Download error', e.message); alert('Lỗi khi tải firmware: ' + e.message); }
  finally{ $downloadBtn.disabled = false; }
});

// ----------------- Web Serial -----------------
$connectBtn.addEventListener('click', async ()=>{
  if(state.port){ await disconnectSerial(); return; }
  if(!('serial' in navigator)){ alert('Web Serial API không được hỗ trợ trên trình duyệt này. Dùng Chrome/Edge mới nhất.'); return; }
  try{
    log('Requesting serial port...');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.port = port;
    $serialStatus.textContent = 'Connected';
    $connectBtn.textContent = 'Disconnect';
    log('Serial opened');
    startReadLoop(port);
  }catch(e){ log('Serial open failed', e.message); alert('Không thể mở cổng Serial: ' + e.message); }
});

async function disconnectSerial(){
  if(!state.port) return;
  try{
    if(state.reader) { await state.reader.cancel(); state.reader = null; }
    await state.port.close();
    log('Serial closed');
  }catch(e){ log('Serial close error', e.message); }
  state.port = null;
  $serialStatus.textContent = 'Not connected';
  $connectBtn.textContent = 'Kết nối';
}

async function startReadLoop(port){
  try{
    const decoder = new TextDecoderStream();
    const readable = port.readable.pipeThrough(decoder);
    const reader = readable.getReader();
    state.reader = reader;
    while(true){
      const { value, done } = await reader.read();
      if(done) break;
      if(value) log('[Device]', value.trim());
    }
  }catch(e){ log('Read loop ended', e.message); }
}

// ----------------- Install / Flash (esptool.js) -----------------
$installBtn.addEventListener('click', async ()=>{
  if(!state.manifest || !state.manifest.url) return alert('No manifest');
  if(!state.port) return alert('Kết nối thiết bị trước khi nạp');
  if(!confirm('Chắc chắn muốn nạp firmware bằng esptool.js?')) return;

  try{
    $installBtn.disabled = true; $connectBtn.disabled = true; $downloadBtn.disabled = true;
    log('Starting esptool.js flashing...');

    // 1) Download firmware binary
    const resp = await fetch(state.manifest.url);
    if(!resp.ok) throw new Error('Fetch failed: ' + resp.status);
    const u8 = new Uint8Array(await resp.arrayBuffer());
    log('Firmware loaded:', u8.length, 'bytes');

    // 2) Setup esptool
    const esploader = new ESPLoader({
      transport: new ESPTransport(state.port),
      baudrate: 115200,
      debug: (msg)=>log('[ESP]', msg)
    });

    // 3) Sync
    log('Syncing with chip...');
    await esploader.main();
    const chip = esploader.chipName;
    log('Connected to', chip);

    // 4) Erase flash (optional, but safer)
    log('Erasing flash (may take 5–10s)...');
    await esploader.eraseFlash();
    log('Erase done.');

    // 5) Write firmware at 0x0
    log('Writing flash...');
    await esploader.flashData([{address: 0x0, data: u8}]);
    log('Flash complete!');
    updateProgress(100, u8.length, u8.length);

  } catch(e){
    log('Flash error (esptool):', e.message);
    alert('Error: ' + e.message);
  } finally{
    $installBtn.disabled = false; $connectBtn.disabled = false; $downloadBtn.disabled = false;
  }
});
$installBtn.addEventListener('click', async ()=>{
  if(!state.manifest || !state.manifest.url) return alert('No manifest');
  if(!state.port) return alert('Kết nối thiết bị trước khi nạp');
  if(!confirm('Chắc chắn muốn nạp firmware? Hãy đảm bảo bạn đã vào chế độ boot nếu cần.')) return;

  try{
    $installBtn.disabled = true; $connectBtn.disabled = true; $downloadBtn.disabled = true;
    log('Starting flash...');

    const resp = await fetch(state.manifest.url);
    if(!resp.ok) throw new Error('Fetch failed: ' + resp.status);
    const contentLength = resp.headers.get('Content-Length');
    const total = contentLength ? Number(contentLength) : null;
    let loaded = 0;
    const reader = resp.body.getReader();
    const chunks = [];
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      chunks.push(value);
      loaded += value.length;
      updateProgress(total ? Math.round(loaded/total*100) : null, loaded, total);
    }
    const u8 = concatChunks(chunks);
    state.bin = u8;
    log('Binary ready,', u8.length, 'bytes');
    const h = await sha256Hex(u8.buffer);
    log('SHA256', h);

    // Send chunks over serial (naive raw writer). Device must implement compatible receiver.
    await streamToSerial(u8);
    log('Upload done. Waiting for device to verify/flashing...');
    updateProgress(100, u8.length, u8.length);

  }catch(e){ log('Flash error', e.message); alert('Lỗi khi nạp: ' + e.message); }
  finally{ $installBtn.disabled = false; $connectBtn.disabled = false; $downloadBtn.disabled = false; }
});

async function streamToSerial(u8){
  if(!state.port) throw new Error('No serial port');
  const writer = state.port.writable.getWriter();
  const CHUNK = 16 * 1024;
  try{
    for(let offset = 0; offset < u8.length; offset += CHUNK){
      const slice = u8.slice(offset, Math.min(offset + CHUNK, u8.length));
      await writer.write(slice);
      const pct = Math.round((offset + slice.length) / u8.length * 100);
      updateProgress(pct, offset + slice.length, u8.length);
      await sleep(8);
    }
    log('All chunks written');
  }catch(e){ throw e; }
  finally{ await writer.releaseLock(); }
}

// ----------------- Init -----------------
(function init(){
  renderAll();
  // optional: pre-fetch manifest map to warm cache
  loadManifestMap().then(()=>log('Manifest loaded'));
})();

// Expose for debugging (optional)
window._entech = { state, renderAll, loadManifestMap };
