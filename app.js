// Shipping Pickup Verification Engine
document.addEventListener('DOMContentLoaded', () => {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  
  // Timer for automatic scan detection
  let completionTimer = null;
  const COMPLETION_DELAY_MS = 250;

  // DOM Elements
  const scanForm = document.getElementById('scanForm');
  const barcodeInput = document.getElementById('barcodeInput');
  const scannerStatusBadge = document.getElementById('scannerStatusBadge');
  const displayCard = document.getElementById('displayCard');
  const statusBadgeText = document.getElementById('statusBadgeText');
  const signSubheading = document.getElementById('signSubheading');
  const signDestination = document.getElementById('signDestination');
  const signSubdest = document.getElementById('signSubdest');
  const signBarcode = document.getElementById('signBarcode');

  // Controls & Drawer
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const historyToggleBtn = document.getElementById('historyToggleBtn');
  const logDrawer = document.getElementById('logDrawer');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const scanHistoryBody = document.getElementById('scanHistoryBody');
  const statCount = document.getElementById('statCount');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Load database
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = data;
    })
    .catch(() => {
      console.warn('labels.json not loaded; carrier heuristic routing active.');
    });

  // Keep input focused automatically
  function forceFocus() {
    if (document.activeElement !== barcodeInput && !logDrawer.classList.contains('open')) {
      barcodeInput.focus();
    }
  }

  window.addEventListener('click', (e) => {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      barcodeInput.focus();
    }
  });

  setInterval(forceFocus, 1000);

  // Web Audio Tone Synthesizer
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(isSuccess = true) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (isSuccess) {
        osc.frequency.setValueAtTime(940, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } else {
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch(e) {
      console.warn('Audio tone could not play', e);
    }
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerText = soundEnabled ? 'AUDIO: ON' : 'AUDIO: MUTED';
    barcodeInput.focus();
  });

  // Form Submit Handler
  scanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(completionTimer);
    executeCurrentScan();
  });

  // Direct Enter Keypress Trap
  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      clearTimeout(completionTimer);
      executeCurrentScan();
    }
  });

  // Automatic input stream debounce
  barcodeInput.addEventListener('input', () => {
    clearTimeout(completionTimer);
    const val = barcodeInput.value.trim();

    if (val.length === 0) {
      scannerStatusBadge.innerText = 'READY';
      scannerStatusBadge.className = 'scan-status-pill';
      return;
    }

    scannerStatusBadge.innerText = 'READING...';
    scannerStatusBadge.className = 'scan-status-pill scanning';

    completionTimer = setTimeout(() => {
      executeCurrentScan();
    }, COMPLETION_DELAY_MS);
  });

  function executeCurrentScan() {
    clearTimeout(completionTimer);
    const raw = barcodeInput.value;
    processScan(raw);
  }

  // Main Scan Processing & Carrier Verification
  function processScan(rawCode) {
    const code = (rawCode || '').trim();
    if (!code) {
      scannerStatusBadge.innerText = 'READY';
      scannerStatusBadge.className = 'scan-status-pill';
      return;
    }

    scannerStatusBadge.innerText = 'PROCESSING...';

    const timestamp = new Date().toLocaleTimeString();
    const routeInfo = parseCarrierRoute(code);

    if (routeInfo.verified) {
      setBillboard(
        'success',
        'VERIFIED',
        'SCANNED & VERIFIED',
        routeInfo.primaryLocation,
        routeInfo.subNote,
        routeInfo.barcode
      );
      playTone(true);
    } else {
      setBillboard(
        'danger',
        'UNKNOWN',
        'DO NOT PLACE - NOT VERIFIED',
        'UNRECOGNIZED BARCODE',
        'Re-scan or set aside for review',
        code
      );
      playTone(false);
    }

    // Add to history log
    scanHistory.unshift({
      time: timestamp,
      barcode: code,
      destination: routeInfo.primaryLocation,
      service: routeInfo.subNote || 'Standard',
      status: routeInfo.verified ? 'VERIFIED' : 'FAILED'
    });

    statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input and refocus immediately
    barcodeInput.value = '';
    scannerStatusBadge.innerText = 'READY';
    scannerStatusBadge.className = 'scan-status-pill';
    barcodeInput.focus();
  }

  // ACCURATE CARRIER & SERVICE DETERMINATION (Including DHL & UPSMI)
  function parseCarrierRoute(raw) {
    const code = raw.replace(/[^a-zA-Z0-9]/g, '').trim();

    // 1. Direct database match in labels.json
    const record = knownLabels.find(l => {
      const cleanDB = (l.barcode || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return cleanDB === code.toLowerCase();
    });

    if (record) {
      return {
        barcode: record.barcode,
        primaryLocation: record.destination || record.carrier,
        subNote: record.service || record.subNote || '',
        verified: true
      };
    }

    // 2. UPS MAIL INNOVATIONS (UPSMI)
    // Format: 18-34 digits starting with 80, 82, or 92748 (e.g. 803364829621565082)
    if (/^80\d{16,24}$/.test(code) || /^82\d{16,24}$/.test(code) || /^92748\d+$/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'UPSMI',
        subNote: 'UPS Mail Innovations (Postal Delivery)',
        verified: true
      };
    }

    // 3. DHL ECOMMERCE / DHL PARCEL
    // Format: GS1-128 postal routing code starting with 420[ZIP]92419... / 93419... or 420 followed by 92419
    // DHL eCommerce Mailer ID is typically 92419 or 93419
    if (/^420\d{5}(92419|93419|94419)\d+$/i.test(code) || /^(92419|93419|94419)\d{15,}$/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'DHL',
        subNote: 'DHL eCommerce Pickup',
        verified: true
      };
    }

    // Standard DHL Express format (10 digits)
    if (/^\d{10}$/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'DHL Express',
        subNote: 'DHL Express Airway Bill',
        verified: true
      };
    }

    // 4. FEDEX GROUND vs FEDEX EXPRESS
    // A. FedEx Ground 96 GS1 barcode (20+ digits starting with 96)
    if (/^96\d{20,}/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'FedEx Ground',
        subNote: 'Package Barcode (96 GS1)',
        verified: true
      };
    }

    // B. FedEx Ground Barcode (Standard 15 digits or 20 digits starting with 00, 02, 04, 15)
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'FedEx Ground',
        subNote: 'Ground Commercial / Home Delivery',
        verified: true
      };
    }

    // C. FedEx Express Barcode (Standard 12 digits: e.g. 879136980972)
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'FedEx Express',
        subNote: 'Express Air Priority / Standard',
        verified: true
      };
    }

    // 5. UPS STANDARD & AIR (1Z...)
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      const serviceCode = code.substring(8, 10).toUpperCase();
      let upsService = 'Ground Commercial Pickup';
      let upsLocation = 'UPS Ground';

      if (['01', '13', '14'].includes(serviceCode)) {
        upsLocation = 'UPS Next Day Air';
        upsService = 'Air Express Pickup';
      } else if (['02', '59'].includes(serviceCode)) {
        upsLocation = 'UPS 2nd Day Air';
        upsService = 'Air Express Pickup';
      }

      return {
        barcode: raw,
        primaryLocation: upsLocation,
        subNote: upsService,
        verified: true
      };
    }

    // 6. USPS POSTAL
    // USPS barcodes typically start with 92, 93, 94, 95 or 420[ZIP]9... (excluding DHL 92419 above)
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: raw,
        primaryLocation: 'USPS Mail Cage',
        subNote: 'Ground Advantage / Priority',
        verified: true
      };
    }

    // 7. INTERNAL PRODUCTION ORDERS
    if (/^JOB\d+$/i.test(code) || /^JOB-\d+$/i.test(raw)) {
      return {
        barcode: raw,
        primaryLocation: 'Press & Bindery Lane',
        subNote: 'Internal Production Work Order',
        verified: true
      };
    }

    // Fallback unverified
    return {
      barcode: raw,
      primaryLocation: 'UNREGISTERED',
      subNote: 'Unrecognized Barcode',
      verified: false
    };
  }

  // Update Billboard Screen
  function setBillboard(mode, statText, subhead, mainSpot, subSpot, barcode) {
    displayCard.className = `display-card ${mode}`;
    statusBadgeText.innerText = statText;
    signSubheading.innerText = subhead;
    signDestination.innerText = mainSpot;
    signSubdest.innerText = subSpot || '';
    signBarcode.innerText = barcode;
  }

  // Log Drawer Controls
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
        <td>${item.service}</td>
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
    const csv = 'Time,Barcode,Destination,Service,Status\n' + scanHistory.map(s => `"${s.time}","${s.barcode}","${s.destination}","${s.service}","${s.status}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shipping-scans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  // Fullscreen Mode Toggle
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      fullscreenBtn.innerText = 'EXIT FULLSCREEN';
    } else {
      document.exitFullscreen().catch(() => {});
      fullscreenBtn.innerText = 'FULLSCREEN';
    }
    barcodeInput.focus();
  });
});
