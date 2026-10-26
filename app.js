// ScanHub Barcode & Label Engine
document.addEventListener('DOMContentLoaded', () => {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  let codeReader = null;
  let cameraActive = false;
  let debounceTimer = null;

  // DOM Elements
  const barcodeInput = document.getElementById('barcodeInput');
  const scanForm = document.getElementById('scanForm');
  const timerHint = document.getElementById('timerHint');
  
  // Hero Display Elements
  const scanFeedback = document.getElementById('scanFeedback');
  const feedbackIcon = document.getElementById('feedbackIcon');
  const feedbackTitle = document.getElementById('feedbackTitle');
  const feedbackBarcode = document.getElementById('feedbackBarcode');
  const feedbackDetail = document.getElementById('feedbackDetail');

  // Stats Elements
  const statScanCount = document.getElementById('statScanCount');
  const statValidCount = document.getElementById('statValidCount');
  const statErrorCount = document.getElementById('statErrorCount');

  // Table & Controls
  const scanLogBody = document.getElementById('scanLogBody');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const videoPreview = document.getElementById('videoPreview');

  // Load database
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = data;
    })
    .catch(err => {
      console.warn('labels.json not found or unreadable, format heuristics will run.', err);
    });

  // Always keep input focused for fast scanning
  window.addEventListener('click', (e) => {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      barcodeInput.focus();
    }
  });

  // Sound Synth via Web Audio API (No audio files needed)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playBeep(success = true) {
    if (!soundEnabled) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (success) {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch A5
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } else {
        osc.frequency.setValueAtTime(220, audioCtx.currentTime); // Low warning buzz
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      }
    } catch(e) {}
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerText = soundEnabled ? '🔊' : '🔇';
  });

  // 1-SECOND AUTO-ENTER DEBOUNCING MECHANISM
  barcodeInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const currentVal = barcodeInput.value.trim();

    if (currentVal.length === 0) {
      timerHint.innerText = '⚡ Ready. Auto-submits 1.0s after final character';
      return;
    }

    timerHint.innerText = '⏳ Auto-submitting in 1 second...';

    debounceTimer = setTimeout(() => {
      if (barcodeInput.value.trim().length > 0) {
        handleScan(barcodeInput.value);
      }
    }, 1000); // exactly 1 second auto-trigger
  });

  // Main Scan Processing Engine
  function handleScan(rawVal) {
    clearTimeout(debounceTimer);
    timerHint.innerText = '⚡ Ready. Auto-submits 1.0s after final character';

    const val = rawVal.trim();
    if (!val) return;

    const timestamp = new Date().toLocaleTimeString();
    const parsed = identifyBarcode(val);

    // Update Stats
    statScanCount.innerText = parseInt(statScanCount.innerText) + 1;

    if (parsed.valid) {
      statValidCount.innerText = parseInt(statValidCount.innerText) + 1;
      setHugeDisplay('success', 'SCANNED & VERIFIED', parsed.barcode, `${parsed.type} • ${parsed.destination || 'Ready for Next Step'}`);
      playBeep(true);
    } else {
      statErrorCount.innerText = parseInt(statErrorCount.innerText) + 1;
      setHugeDisplay('danger', 'INVALID / UNRECOGNIZED', parsed.barcode, 'Barcode does not match expected format or records');
      playBeep(false);
    }

    // Add to audit table
    scanHistory.unshift({
      time: timestamp,
      barcode: parsed.barcode,
      type: parsed.type,
      status: parsed.valid ? 'VERIFIED' : 'FAILED'
    });

    renderTable();

    // Reset input and refocus immediately
    barcodeInput.value = '';
    barcodeInput.focus();
  }

  // Barcode pattern recognition logic
  function identifyBarcode(code) {
    // 1. Direct database match
    const matched = knownLabels.find(l => l.barcode.toLowerCase() === code.toLowerCase());
    if (matched) {
      return { ...matched, valid: true };
    }

    // 2. Common carrier / production formats
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return { barcode: code, type: 'UPS Ground Tracking', destination: 'UPS Commercial Hub', valid: true };
    } else if (/^94\d{20}$/.test(code) || /^92\d{20}$/.test(code) || /^420\d{27}$/.test(code)) {
      return { barcode: code, type: 'USPS Ground Advantage', destination: 'USPS Postal System', valid: true };
    } else if (/^\d{12}$/.test(code) || /^\d{15}$/.test(code)) {
      return { barcode: code, type: 'FedEx Express / Ground', destination: 'FedEx Hub', valid: true };
    } else if (/^JOB-\d+$/i.test(code)) {
      return { barcode: code, type: 'Internal Production Job', destination: 'Press & Bindery Workflow', valid: true };
    }

    // 3. Fallback unverified
    return {
      barcode: code,
      type: 'Unknown Format',
      destination: 'Unregistered',
      valid: false
    };
  }

  // Update Giant Verification Banner
  function setHugeDisplay(state, title, barcode, subtitle) {
    scanFeedback.className = `hero-feedback ${state}`;
    feedbackIcon.innerText = state === 'success' ? '✔ VERIFIED' : '✖ FAILED';
    feedbackTitle.innerText = title;
    feedbackBarcode.innerText = barcode;
    feedbackDetail.innerText = subtitle;
  }

  function renderTable() {
    scanLogBody.innerHTML = scanHistory.map(item => `
      <tr>
        <td>${item.time}</td>
        <td>${item.barcode}</td>
        <td>${item.type}</td>
        <td><span class="${item.status === 'VERIFIED' ? 'tag-success' : 'tag-danger'}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  // Form Enter Key Handler
  scanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleScan(barcodeInput.value);
  });

  // Table Actions
  clearLogBtn.addEventListener('click', () => {
    if (confirm('Clear all scan logs?')) {
      scanHistory = [];
      renderTable();
      statScanCount.innerText = '0';
      statValidCount.innerText = '0';
      statErrorCount.innerText = '0';
      scanFeedback.className = 'hero-feedback idle';
      feedbackIcon.innerText = 'READY';
      feedbackTitle.innerText = 'READY TO SCAN';
      feedbackBarcode.innerText = '—';
      feedbackDetail.innerText = 'Scan barcode or label to verify';
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    if (!scanHistory.length) {
      alert('No scans to export.');
      return;
    }
    const headers = 'Time,Barcode,Carrier/Type,Status\n';
    const rows = scanHistory.map(s => `"${s.time}","${s.barcode}","${s.type}","${s.status}"`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Camera Scanning Support
  toggleCameraBtn.addEventListener('click', () => {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  closeCameraBtn.addEventListener('click', stopCamera);

  function startCamera() {
    if (typeof ZXing === 'undefined') {
      alert('Barcode camera library loading, please try again.');
      return;
    }
    codeReader = new ZXing.BrowserMultiFormatReader();
    cameraContainer.style.display = 'block';
    cameraActive = true;
    toggleCameraBtn.innerText = 'Stop Camera';

    codeReader.decodeFromVideoDevice(null, videoPreview, (result) => {
      if (result) {
        handleScan(result.getText());
      }
    });
  }

  function stopCamera() {
    if (codeReader) {
      codeReader.reset();
      codeReader = null;
    }
    cameraContainer.style.display = 'none';
    cameraActive = false;
    toggleCameraBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
      </svg>
      <span>Camera Scan</span>
    `;
    barcodeInput.focus();
  }
});
