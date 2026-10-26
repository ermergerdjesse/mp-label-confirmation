// Shipping Pickup Verification Engine
document.addEventListener('DOMContentLoaded', () => {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  let debounceTimer = null;

  // DOM Elements
  const barcodeInput = document.getElementById('barcodeInput');
  const timerBadge = document.getElementById('timerBadge');
  const displayCard = document.getElementById('displayCard');
  const statusIcon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');
  const signSubheading = document.getElementById('signSubheading');
  const signDestination = document.getElementById('signDestination');
  const signSubdest = document.getElementById('signSubdest');
  const signBarcode = document.getElementById('signBarcode');

  // Drawer / Controls
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const historyToggleBtn = document.getElementById('historyToggleBtn');
  const logDrawer = document.getElementById('logDrawer');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const scanHistoryBody = document.getElementById('scanHistoryBody');
  const statCount = document.getElementById('statCount');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Load routing database
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = data;
    })
    .catch(() => {
      console.warn('labels.json not loaded; heuristic carrier routing active.');
    });

  // Aggressive auto-focus lock for handheld barcode scanners
  function keepInputFocused() {
    if (document.activeElement !== barcodeInput) {
      barcodeInput.focus();
    }
  }

  window.addEventListener('click', (e) => {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      barcodeInput.focus();
    }
  });

  setInterval(keepInputFocused, 1500);

  // Web Audio Alert Synthesizer
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone(isSuccess = true) {
    if (!soundEnabled) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (isSuccess) {
        osc.frequency.setValueAtTime(920, audioCtx.currentTime); // High crisp confirm tone
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } else {
        osc.frequency.setValueAtTime(200, audioCtx.currentTime); // Low buzz
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch(e) {}
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerText = soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND MUTED';
    barcodeInput.focus();
  });

  // 1-SECOND AUTO SUBMIT DEBOUNCER
  barcodeInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = barcodeInput.value.trim();

    if (val.length === 0) {
      timerBadge.innerText = 'READY';
      timerBadge.className = 'scan-status-pill';
      return;
    }

    timerBadge.innerText = 'AUTO-VERIFYING (1s)...';
    timerBadge.className = 'scan-status-pill counting';

    debounceTimer = setTimeout(() => {
      if (barcodeInput.value.trim().length > 0) {
        processScan(barcodeInput.value);
      }
    }, 1000); // 1.0 second auto-trigger
  });

  // Also support immediate Enter keypress from scanner
  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      processScan(barcodeInput.value);
    }
  });

  // Scan Processing & Routing Logic
  function processScan(rawCode) {
    clearTimeout(debounceTimer);
    timerBadge.innerText = 'READY';
    timerBadge.className = 'scan-status-pill';

    const code = rawCode.trim();
    if (!code) return;

    const timestamp = new Date().toLocaleTimeString();
    const routeInfo = resolveRoute(code);

    if (routeInfo.verified) {
      setBillboard(
        'success',
        '✓',
        'VERIFIED',
        'SCANNED & VERIFIED',
        routeInfo.primaryLocation,
        routeInfo.subLocation,
        routeInfo.barcode
      );
      playTone(true);
    } else {
      setBillboard(
        'danger',
        '✖',
        'UNKNOWN',
        'DO NOT PLACE - NOT VERIFIED',
        'UNRECOGNIZED LABEL',
        'Re-scan or take to lead clerk',
        code
      );
      playTone(false);
    }

    // Add to history
    scanHistory.unshift({
      time: timestamp,
      barcode: code,
      destination: routeInfo.primaryLocation + (routeInfo.subLocation ? ' / ' + routeInfo.subLocation : ''),
      status: routeInfo.verified ? 'VERIFIED' : 'FAILED'
    });

    statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input for next scan
    barcodeInput.value = '';
    barcodeInput.focus();
  }

  // Carrier / Pickup spot pattern resolution
  function resolveRoute(code) {
    // 1. Check database first
    const record = knownLabels.find(l => l.barcode.toLowerCase() === code.toLowerCase());
    if (record) {
      return {
        barcode: record.barcode,
        primaryLocation: record.destination || record.carrier,
        subLocation: record.subNote || '',
        verified: true
      };
    }

    // 2. FedEx (Standard 12 or 15 digit barcodes)
    if (/^\d{12}$/.test(code) || /^\d{15}$/.test(code) || /^96\d{20}$/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'FedEx Express',
        subLocation: 'or FedEx Ground',
        verified: true
      };
    }

    // 3. UPS (1Z...)
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'UPS Pickup Spot',
        subLocation: 'UPS Ground / Air Bin',
        verified: true
      };
    }

    // 4. USPS Postal barcodes (22-30 digits starting with 92, 93, 94, or 420)
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'USPS Mail Cage',
        subLocation: 'Ground Advantage / Priority',
        verified: true
      };
    }

    // 5. Internal Job Barcodes (JOB-12345)
    if (/^JOB-\d+$/i.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'Press & Bindery Lane',
        subLocation: 'Internal Routing',
        verified: true
      };
    }

    // Unmatched
    return {
      barcode: code,
      primaryLocation: 'UNREGISTERED',
      subLocation: '',
      verified: false
    };
  }

  // Update Giant Display Billboard
  function setBillboard(mode, icon, stat, subhead, mainSpot, subSpot, barcode) {
    displayCard.className = `display-card ${mode}`;
    statusIcon.innerText = icon;
    statusText.innerText = stat;
    signSubheading.innerText = subhead;
    signDestination.innerText = mainSpot;
    signSubdest.innerText = subSpot || '';
    signBarcode.innerText = barcode;
  }

  // History Drawer Controls
  historyToggleBtn.addEventListener('click', () => {
    logDrawer.classList.toggle('open');
  });

  closeDrawerBtn.addEventListener('click', () => {
    logDrawer.classList.remove('open');
    barcodeInput.focus();
  });

  function renderLog() {
    scanHistoryBody.innerHTML = scanHistory.map(item => `
      <tr>
        <td>${item.time}</td>
        <td>${item.barcode}</td>
        <td>${item.destination}</td>
        <td><span class="${item.status === 'VERIFIED' ? 'log-success' : 'log-danger'}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  clearLogBtn.addEventListener('click', () => {
    if (confirm('Clear scan history?')) {
      scanHistory = [];
      statCount.innerText = '0';
      renderLog();
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    if (!scanHistory.length) return alert('No scans to export.');
    const csv = 'Time,Barcode,Destination,Status\n' + scanHistory.map(s => `"${s.time}","${s.barcode}","${s.destination}","${s.status}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shipping-scans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  // Fullscreen Mode Toggle for overhead warehouse monitors
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      fullscreenBtn.innerText = '⛶ EXIT FULLSCREEN';
    } else {
      document.exitFullscreen().catch(() => {});
      fullscreenBtn.innerText = '⛶ FULLSCREEN';
    }
    barcodeInput.focus();
  });
});
