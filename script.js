// State
let selectedProgram = null;
let selectedChip = null;
let selectedOled = null;
let isInstalling = false;

// Firmware data
const firmwareInfo = {
    mochinav: { version: "v2.4.1", date: "15/11/2025", size: "3.2 MB" },
    chatbot: { version: "v1.8.0", date: "14/11/2025", size: "2.8 MB" }
};

// DOM Elements
const programCards = document.querySelectorAll('[data-program]');
const chipCards = document.querySelectorAll('[data-chip]');
const oledCards = document.querySelectorAll('[data-oled]');
const installBtn = document.getElementById('installBtn');
const downloadBtn = document.getElementById('downloadBtn');
const installBtnText = document.getElementById('installBtnText');
const installProgress = document.getElementById('installProgress');
const comPort = document.getElementById('comPort');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const logsContainer = document.getElementById('logs');
const firmwareInfoCard = document.getElementById('firmwareInfo');
const fwVersion = document.getElementById('fwVersion');
const fwDate = document.getElementById('fwDate');
const fwSize = document.getElementById('fwSize');

// Program selection
programCards.forEach(card => {
    card.addEventListener('click', () => {
        programCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedProgram = card.dataset.program;
        updateButtons();
        updateFirmwareInfo();
    });
});

// Chip selection
chipCards.forEach(card => {
    card.addEventListener('click', () => {
        chipCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedChip = card.dataset.chip;
        updateButtons();
    });
});

// OLED selection
oledCards.forEach(card => {
    card.addEventListener('click', () => {
        oledCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedOled = card.dataset.oled;
        updateButtons();
    });
});

// Update buttons state
function updateButtons() {
    const canInstall = selectedProgram && selectedChip && selectedOled && !isInstalling;
    installBtn.disabled = !canInstall;
    downloadBtn.disabled = !selectedProgram || isInstalling;
}

// Update firmware info
function updateFirmwareInfo() {
    if (selectedProgram && firmwareInfo[selectedProgram]) {
        const info = firmwareInfo[selectedProgram];
        fwVersion.textContent = info.version;
        fwDate.textContent = info.date;
        fwSize.textContent = info.size;
        firmwareInfoCard.style.display = 'block';
    } else {
        firmwareInfoCard.style.display = 'none';
    }
}

// Install button handler
installBtn.addEventListener('click', handleInstall);

function handleInstall() {
    if (!selectedProgram || !selectedChip || !selectedOled || isInstalling) return;
    
    isInstalling = true;
    updateButtons();
    
    // Reset state
    logsContainer.innerHTML = '';
    logsContainer.classList.remove('logs-empty');
    progressContainer.style.display = 'block';
    comPort.textContent = 'COM3';
    
    // Installation steps
    const steps = [
        "Kết nối thiết bị...",
        "Phát hiện ESP32-S3...",
        "Xác thực chip...",
        "Nạp firmware...",
        "Xác minh...",
        "Hoàn thành!"
    ];
    
    let currentStep = 0;
    
    const interval = setInterval(() => {
        if (currentStep < steps.length) {
            const progress = ((currentStep + 1) / steps.length) * 100;
            
            // Update progress bar
            progressFill.style.width = progress + '%';
            progressPercent.textContent = Math.round(progress) + '%';
            installProgress.style.width = progress + '%';
            
            // Update button text
            installBtnText.textContent = `Đang cài... ${Math.round(progress)}%`;
            
            // Add log entry
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry' + (steps[currentStep] === "Hoàn thành!" ? ' complete' : '');
            
            const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            icon.setAttribute('class', 'icon log-icon' + (steps[currentStep] !== "Hoàn thành!" ? ' dimmed' : ''));
            icon.setAttribute('width', '16');
            icon.setAttribute('height', '16');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '2');
            
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute('d', 'M22 11.08V12a10 10 0 1 1-5.93-9.14');
            icon.appendChild(path);
            
            const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            polyline.setAttribute('points', '22 4 12 14.01 9 11.01');
            icon.appendChild(polyline);
            
            logEntry.appendChild(icon);
            
            const text = document.createElement('span');
            text.textContent = steps[currentStep];
            logEntry.appendChild(text);
            
            logsContainer.appendChild(logEntry);
            
            currentStep++;
        } else {
            clearInterval(interval);
            setTimeout(() => {
                isInstalling = false;
                updateButtons();
                installBtnText.textContent = 'Cài Đặt Ngay';
                installProgress.style.width = '0%';
            }, 1000);
        }
    }, 800);
}

// Download button handler
downloadBtn.addEventListener('click', () => {
    if (!selectedProgram) return;
    alert(`Tải firmware ${selectedProgram}.bin\n\nChức năng này sẽ được cập nhật sau.`);
});

// Initialize
updateButtons();