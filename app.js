// ScanHub Barcode & Label Engine
document.addEventListener('DOMContentLoaded', () => {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  let codeReader = null;
  let cameraActive = false;

  // DOM Elements
  const barcodeInput = document.getElementById('barcodeInput');
  const scanForm = document.getElementById('scanForm');
  const scanFeedback = document.getElementById('scanFeedback');
  const feedbackIcon = document.getElementById('feedbackIcon');
  const feedbackTitle = document.getElementById('feedbackTitle');
  const feedbackDetail = document.getElementById('feedbackDetail');
  
  // Stats
  const statScanCount = document.getElementById('statScanCount');
  const statValidCount = document.getElementById('statValidCount');
  const statErrorCount = document.getElementById('statErrorCount');

  // Breakdown Inspector
  const labelFormatBadge = document.getElementById('labelFormatBadge');
  const insBarcode = document.getElementById('insBarcode');
  const insType = document.getElementById('insType');
  const insJobId = document.getElementById('insJobId');
  const insDest = document.getElementById('insDest');
  const insService = document.getElementById('insService');
  const insStatus = document.getElementById('insStatus');

  // Table & Controls
  const scanLogBody = document.getElementById('scanLogBody');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const videoPreview = document.getElementById('videoPreview');

  // Load sample label database
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = data;
    })
    .catch(err => {
      console.warn('Could not load labels.json, fallback parsing enabled.', err);
    });

  // Keep scanner focused on click anywhere on page
  window.addEventListener('click', (e) => {
    if (!['BUTTON', 'A', 'INPUT'].includes(e.target.tagName)) {
      barcodeInput.focus();
    }
  });

  // Sound Synth via Web Audio API (No external sound files required)
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
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
      } else {
        osc.frequency.setValueAtTime(220, audioCtx.currentTime); // Low buzz
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      }
    } catch(e) {}
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerText = soundEnabled ? '🔊' : '🔇';
  });

  // Process Raw Barcode Scan
  function handleScan(rawVal) {
    const val = rawVal.trim();
    if (!val) return;

    const timestamp = new Date().toLocaleTimeString();
    
    // Pattern identification & database lookup
    const parsed = identifyBarcode(val);
    
    // Update Stats
    statScanCount.innerText = parseInt(statScanCount.innerText) + 1;
    if (parsed.valid) {
      statValidCount.innerText = parseInt(statValidCount.innerText) + 1;
      setFeedback('success', '✓ Scanned & Verified', `${parsed.type}: ${parsed.barcode}`);
      playBeep(true);
    } else {
      statErrorCount.innerText = parseInt(statErrorCount.innerText) + 1;
      setFeedback('danger', '⚠ Unrecognized / Invalid Barcode', `Value: ${val}`);
      playBeep(false);
    }

    // Populate Inspector
    labelFormatBadge.innerText = parsed.type;
    insBarcode.innerText = parsed.barcode;
    insType.innerText = parsed.type;
    insJobId.innerText = parsed.jobId || 'N/A';
    insDest.innerText = parsed.destination || 'Unspecified';
    insService.innerText = parsed.service || 'Standard';
    insStatus.innerHTML = parsed.valid 
      ? '<span class="tag-success">MATCH / VERIFIED</span>' 
      : '<span class="tag-danger">UNREGISTERED</span>';

    // Log to table
    scanHistory.unshift({
      time: timestamp,
      barcode: parsed.barcode,
      type: parsed.type,
      status: parsed.valid ? 'VERIFIED' : 'UNKNOWN'
    });

    renderTable();

    // Clear input and keep focused
    barcodeInput.value = '';
    barcodeInput.focus();
  }

  // Barcode pattern recognition logic
  function identifyBarcode(code) {
    // Check local database first
    const matched = knownLabels.find(l => l.barcode.toLowerCase() === code.toLowerCase());
    if (matched) {
      return { ...matched, valid: true };
    }

    // Heuristics for standard logistics barcodes
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return { barcode: code, type: 'UPS Tracking', jobId: 'EXT-UPS', destination: 'Domestic UPS', service: 'Ground', valid: true };
    } else if (/^94\d{20}$/.test(code) || /^92\d{20}$/.test(code) || /^420\d{27}$/.test(code)) {
      return { barcode: code, type: 'USPS Ground Advantage', jobId: 'USPS-POST', destination: 'USPS Base/Domestic', service: 'Priority / Ground', valid: true };
    } else if (/^\d{12}$/.test(code) || /^\d{15}$/.test(code)) {
      return { barcode: code, type: 'FedEx Express', jobId: 'FEDEX-EXP', destination: 'FedEx Hub', service: 'Standard Overnight', valid: true };
    } else if (/^JOB-\d+$/i.test(code)) {
      return { barcode: code, type: 'Internal Production Job', jobId: code, destination: 'Bindery / Press', service: 'Internal Work Order', valid: true };
    }

    // Unmatched fallback
    return {
      barcode: code,
      type: 'Custom / Unknown',
      jobId: '—',
      destination: 'Unknown Destination',
      service: 'General Scan',
      valid: false
    };
  }

  function setFeedback(state, title, detail) {
    scanFeedback.className = `feedback-banner ${state}`;
    feedbackIcon.innerText = state === 'success' ? '✔' : '✖';
    feedbackTitle.innerText = title;
    feedbackDetail.innerText = detail;
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

  // Handle Form Submission
  scanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleScan(barcodeInput.value);
  });

  // Fast typing buffer detection (typical for handheld hardware scanners)
  let scanBuffer = '';
  let lastKeyTime = Date.now();

  window.addEventListener('keydown', (e) => {
    const currentTime = Date.now();
    // Fast consecutive characters (< 40ms) usually denote a hardware scanner
    if (e.key === 'Enter') {
      if (scanBuffer.length > 2) {
        handleScan(scanBuffer);
        scanBuffer = '';
      }
    } else if (e.key.length === 1) {
      if (currentTime - lastKeyTime > 100) {
        scanBuffer = '';
      }
      scanBuffer += e.key;
      lastKeyTime = currentTime;
    }
  });

  // Clear History
  clearLogBtn.addEventListener('click', () => {
    if (confirm('Clear all scan history logs?')) {
      scanHistory = [];
      renderTable();
      statScanCount.innerText = '0';
      statValidCount.innerText = '0';
      statErrorCount.innerText = '0';
    }
  });

  // Export CSV
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

  // Camera Barcode Scanning (ZXing Library)
  toggleCameraBtn.addEventListener('click', async () => {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  closeCameraBtn.addEventListener('click', stopCamera);

  function startCamera() {
    if (typeof ZXing === 'undefined') {
      alert('Barcode library loading, please try again in a moment.');
      return;
    }
    codeReader = new ZXing.BrowserMultiFormatReader();
    cameraContainer.style.display = 'block';
    cameraActive = true;
    toggleCameraBtn.innerText = 'Stop Camera';

    codeReader.decodeFromVideoDevice(null, videoPreview, (result, err) => {
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
