// script.js — MakerSG ESP32 Pro Flasher
// Supports: manifest.json, esptool-js (if available), Web Serial auto-boot via setSignals
// Fallback: raw stream (requires device-side minimal receiver)
// Author: ChatGPT (as Embedded Firmware Expert helper for MakerSG)

const MANIFEST_URL = './manifest.json'; // change to your API endpoint or CDN
const CHUNK_SIZE = 16 * 1024; // 16KB chunks for streaming
const AUTO_BOOT_SIGNALS = true; // toggle RTS/DTR toggling to try entering bootloader

// UI refs
const $programs = document.getElementById('programs');
const $chips = document.getElementById('chips');
const $oleds = document.getElementById('oleds');
const $connectBtn = document.getElementById('connect-btn');
const $installBtn = document.getElementById('install-btn');
const $downloadBtn = document.getElementById('download-btn');
const $serialStatus = document.getElementById('serial-status');
const $progressBar = document.getElementById('progress-bar');
const $progressText = document.getElementById('progress-text');
const $log = document.getElementById('log');
const $fwVersion = document.getElementById('fw-version');
const $fwSize = document.getElementById('fw-size');
const $fwSha = document.getElementById('fw-sha');

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

// sample local option lists (you can generate these from manifest too)
const programs = [
  { id: 'mochinav', label: 'MochiNav (Paid)', meta: 'Navigation module' },
  { id: 'chatbot', label: 'ChatBot AI (Free)', meta: 'AI assistant' }
];
const chips = [
  { id: 'ESP32-S3-M16R8', label: 'ESP32-S3 M16R8' },
  { id: 'ESP32-S3-SUPER', label: 'ESP32-S3 Super' },
  { id: 'ESP32-S3-ZERO', label: 'ESP32-S3 Zero' }
];
const oleds = [
  { id: 'OLED-0.91', label: 'OLED 0.91"' },
  { id: 'OLED-0.96', label: 'OLED 0.96"' },
  { id: 'OLED-1.3', label: 'OLED 1.3"' }
];

function log(...args){
  const t = new Date().toLocaleTimeString();
  $log.classList.remove('logs-empty');
  $log.textContent += `\n[${t}] ${args.join(' ')}`;
  $log.scrollTop = $log.scrollHeight;
}

function humanSize(bytes){
  if(!bytes) return '—';
  const units = ['B','KB','MB','GB'];
  let i=0; let v = bytes;
  while(v >= 1024 && i < units.length-1){ v/=1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

async function sha256Hex(buffer){
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
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

// Render options to DOM
function makeOption(item, group){
  const el = document.createElement('div');
  el.className = 'card card-clickable';
  el.tabIndex = 0;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${item.label}</strong><div style="font-size:0.85rem;color:var(--muted-fg)">${item.meta||''}</div></div></div>`;
  el.addEventListener('click', ()=> onOptionClick(item, el, group));
  el.addEventListener('keydown', e=> { if(e.key === 'Enter') onOptionClick(item, el, group); });
  return el;
}

function onOptionClick(item, el, group){
  if(group === 'program'){ state.program = item.id; Array.from($programs.children).forEach(n=>n.classList.remove('card-selected')); el.classList.add('card-selected'); }
  if(group === 'chip'){ state.chip = item.id; Array.from($chips.children).forEach(n=>n.classList.remove('card-selected')); el.classList.add('card-selected'); }
  if(group === 'oled'){ state.oled = item.id; Array.from($oleds.children).forEach(n=>n.classList.remove('card-selected')); el.classList.add('card-selected'); }
  onSelectionChanged();
}

function renderAll(){
  $programs.innerHTML = ''; programs.forEach(p=> $programs.appendChild(makeOption(p,'program')));
  $chips.innerHTML = ''; chips.forEach(c=> $chips.appendChild(makeOption(c,'chip')));
  $oleds.innerHTML = ''; oleds.forEach(o=> $oleds.appendChild(makeOption(o,'oled')));

  // default selects
  if($programs.children[0]) $programs.children[0].click();
  if($chips.children[0]) $chips.children[0].click();
  if($oleds.children[0]) $oleds.children[0].click();
}

// load manifest.json (map)
async function loadManifest(){
  try{
    const res = await fetch(MANIFEST_URL + '?_=' + Date.now());
    if(!res.ok) throw new Error('Manifest fetch ' + res.status);
    manifestMap = await res.json();
    log('Manifest loaded');
    return manifestMap;
  }catch(e){
    log('Manifest load failed:', e.message);
    // fallback: empty map
    manifestMap = {};
    return manifestMap;
  }
}

async function onSelectionChanged(){
  if(!state.program || !state.chip || !state.oled) return;
  // build key convention: Program|Chip|OLED
  const progKey = state.program === 'chatbot' ? 'ChatBotAI' : 'MochiNav';
  const key = `${progKey}|${state.chip}|${state.oled}`;
  log('Selected', key);
  if(!manifestMap) await loadManifest();
  const entry = manifestMap[key] || null;
  state.manifest = entry;
  if(entry){
    $fwVersion.textContent = entry.version || '—';
    $fwSize.textContent = entry.size ? humanSize(entry.size) : '—';
    $fwSha.textContent = entry.sha256 || '—';
    $downloadBtn.disabled = false;
    $installBtn.disabled = false;
  } else {
    $fwVersion.textContent = 'Không có firmware';
    $fwSize.textContent = '—';
    $fwSha.textContent = '—';
    $downloadBtn.disabled = true;
    $installBtn.disabled = true;
  }
}

// Connect / Disconnect serial
$connectBtn.addEventListener('click', async ()=>{
  if(state.port){
    await disconnectSerial();
    return;
  }
  if(!('serial' in navigator)){ alert('Web Serial API không được hỗ trợ. Dùng Chrome/Edge mới nhất.'); return; }
  try{
    log('Requesting serial port...');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.port = port;
    $serialStatus.textContent = 'Connected';
    $connectBtn.textContent = 'Disconnect';
    log('Serial opened');
    // optional: set signals (DTR/RTS) to attempt auto-boot into bootloader
    if(AUTO_BOOT_SIGNALS && port.setSignals){
      try{
        log('Toggling DTR/RTS to enter bootloader (if supported)...');
        // Typical ESP enter bootloader sequence: toggle DTR/RTS combination.
        // We'll attempt a safe sequence: set DTR=false, RTS=true -> wait -> DTR=true -> wait -> clear
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await sleep(80);
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
        await sleep(80);
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
        await sleep(50);
        log('Signal toggle done (may or may not enter bootloader depending on board).');
      }catch(e){ log('Signal toggle failed:', e.message); }
    }
    startReadLoop(port);
  }catch(e){
    log('Serial open failed', e.message);
    alert('Không thể mở cổng Serial: ' + e.message);
  }
});

async function disconnectSerial(){
  if(!state.port) return;
  try{
    if(state.reader){ await state.reader.cancel(); state.reader = null; }
    if(state.writer){ try{ await state.writer.close(); }catch(_){} state.writer = null; }
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
    const inputDone = port.readable.pipeTo(decoder.writable);
    const inputStream = decoder.readable;
    const reader = inputStream.getReader();
    state.reader = reader;
    while(true){
      const { value, done } = await reader.read();
      if(done) break;
      if(value) log('[Device]', value.trim());
    }
  }catch(e){ log('Read loop ended', e.message); }
}

// Download firmware (save to user device)
$downloadBtn.addEventListener('click', async ()=>{
  if(!state.manifest || !state.manifest.url) return alert('Không có URL firmware');
  try{
    $downloadBtn.disabled = true;
    log('Downloading', state.manifest.url);
    const res = await fetch(state.manifest.url);
    if(!res.ok) throw new Error('Fetch failed: ' + res.status);
    const blob = await res.blob();
    const fname = state.manifest.filename || `firmware-${Date.now()}.bin`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    log('Downloaded', blob.size, 'bytes');
    $fwSize.textContent = humanSize(blob.size);
    const buf = await blob.arrayBuffer();
    const h = await sha256Hex(buf);
    $fwSha.textContent = h;
    log('SHA256', h);
  }catch(e){ log('Download error', e.message); alert('Lỗi khi tải firmware: ' + e.message); }
  finally{ $downloadBtn.disabled = false; }
});

// Install (flash) button
$installBtn.addEventListener('click', async ()=>{
  if(!state.manifest || !state.manifest.url) return alert('Không có manifest');
  if(!state.port) return alert('Kết nối thiết bị trước khi nạp');
  if(!confirm('Chắc chắn muốn nạp firmware? Hãy đảm bảo thiết bị ở chế độ boot nếu cần.')) return;

  // disable UI
  $installBtn.disabled = true; $downloadBtn.disabled = true; $connectBtn.disabled = true;
  try{
    log('Fetching firmware...');
    const resp = await fetch(state.manifest.url);
    if(!resp.ok) throw new Error('Fetch failed ' + resp.status);
    const total = resp.headers.get('Content-Length') ? Number(resp.headers.get('Content-Length')) : null;
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
    const bin = concatChunks(chunks);
    log('Firmware fetched', bin.length, 'bytes');
    const sha = await sha256Hex(bin.buffer);
    log('SHA256', sha);

    // If esptool-js available, use it (preferred)
    if(window.ESPLoader && window.ESPTransport){
      try{
        log('esptool.js detected — using ESPLoader path.');
        // Create transport from WebSerial port
        const transport = new ESPTransport(state.port);
        const esploader = new ESPLoader({ transport, baudrate: 115200, debug: (m)=>log('[esptool]', m) });
        state.esploader = esploader;
        log('Syncing with chip (esptool) — this may take a few seconds...');
        await esploader.main(); // performs sync and chip detection
        log('Detected chip:', esploader.chipName || 'unknown');
        // Optional: erase flash first if entry requests
        if(state.manifest.erase_before_write){
          log('Erasing flash...');
          await esploader.eraseFlash();
          log('Erase complete.');
        }
        // Determine partitions from manifest (array of {address, url/filename/data})
        if(state.manifest.parts && Array.isArray(state.manifest.parts)){
          // write each part
          for(const part of state.manifest.parts){
            const addr = Number(part.address);
            let data = null;
            if(part.data_base64){
              const raw = atob(part.data_base64);
              const u8 = new Uint8Array(raw.length);
              for(let i=0;i<raw.length;i++) u8[i] = raw.charCodeAt(i);
              data = u8;
            } else if(part.url){
              log('Fetching part', part.url);
              const r = await fetch(part.url);
              const b = await r.arrayBuffer();
              data = new Uint8Array(b);
            } else {
              throw new Error('Part has no data/url');
            }
            log(`Flashing part @ 0x${addr.toString(16)} size=${data.length}`);
            await esploader.flashData([{ address: addr, data }]);
            log('Part flashed');
          }
        } else {
          // simplest: write whole bin at address from manifest or 0x10000
          const addr = state.manifest.address ? Number(state.manifest.address) : 0x10000;
          log(`Flashing binary @ 0x${addr.toString(16)} (length=${bin.length})`);
          await esploader.flashData([{ address: addr, data: bin }]);
          log('Flash complete (esptool path).');
        }
        updateProgress(100, bin.length, bin.length);
        log('Flashing finished. Reboot device if needed.');
        // cleanup
        try{ await esploader.transport.close(); } catch(_) {}
      }catch(e){
        log('esptool flashing failed:', e.message);
        // fallback to raw stream
        log('Attempting fallback raw serial streaming...');
        await fallbackRawStream(bin);
      }
    } else {
      log('esptool.js not available — using fallback raw streaming (device must support it).');
      await fallbackRawStream(bin);
    }

  }catch(e){
    log('Install failed:', e.message);
    alert('Lỗi khi nạp: ' + e.message);
  } finally {
    $installBtn.disabled = false; $downloadBtn.disabled = false; $connectBtn.disabled = false;
  }
});

// fallbackRawStream: send raw binary chunks to device over Serial
async function fallbackRawStream(u8){
  if(!state.port) throw new Error('No serial port');
  // open writer
  const writer = state.port.writable.getWriter();
  state.writer = writer;
  try{
    const total = u8.length;
    for(let offset=0; offset<total; offset += CHUNK_SIZE){
      const slice = u8.slice(offset, Math.min(offset+CHUNK_SIZE, total));
      await writer.write(slice);
      const pct = Math.round((offset + slice.length) / total * 100);
      updateProgress(pct, offset + slice.length, total);
      await sleep(20); // tiny pause to avoid overwhelming USB-Serial bridge
    }
    log('All chunks written (raw stream). Waiting for device to finalize.');
    updateProgress(100, u8.length, u8.length);
  }catch(e){
    throw e;
  }finally{
    try{ await writer.releaseLock(); } catch(_) {}
    state.writer = null;
  }
}

// helpers
function concatChunks(chunks){
  let total = 0;
  for(const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for(const c of chunks){ out.set(c, offset); offset += c.length; }
  return out;
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// init
(async function init(){
  renderAll();
  await loadManifest();
  log('UI ready.');
})();
