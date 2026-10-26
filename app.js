// Shipping Pickup Verification Engine
document.addEventListener('DOMContentLoaded', () => {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  
  // Barcode scanner character stream timer
  // Hardware barcode guns stream characters every 5ms-25ms.
  // When 65ms passes without a new character, the barcode transmission is complete.
  let streamCompletionTimer = null;
  const SCANNER_IDLE_BURST_MS = 65;

  // DOM Elements
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

  // Keep focus on input at all times for hardware scanners
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

  // Web Audio Tone Generator (No external MP3 files needed)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTone(isSuccess = true) {
    if (!soundEnabled) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (isSuccess) {
        osc.frequency.setValueAtTime(940, audioCtx.currentTime); // High crisp confirm tone
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.10);
      } else {
        osc.frequency.setValueAtTime(200, audioCtx.currentTime); // Low warning buzz
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch(e) {}
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerText = soundEnabled ? 'AUDIO: ON' : 'AUDIO: MUTED';
    barcodeInput.focus();
  });

  // BARCODE STREAM BURST DETECTION
  // Triggers as soon as the scanner finishes transmitting text
  barcodeInput.addEventListener('input', () => {
    clearTimeout(streamCompletionTimer);
    const val = barcodeInput.value.trim();

    if (val.length === 0) {
      scannerStatusBadge.innerText = 'READY';
      scannerStatusBadge.className = 'scan-status-pill';
      return;
    }

    scannerStatusBadge.innerText = 'READING...';
    scannerStatusBadge.className = 'scan-status-pill scanning';

    // Once text stops typing for 65ms, the barcode scan stream has finished
    streamCompletionTimer = setTimeout(() => {
      if (barcodeInput.value.trim().length > 0) {
        processScan(barcodeInput.value);
      }
    }, SCANNER_IDLE_BURST_MS);
  });

  // Immediate Enter key support (standard for barcode guns configured with CRLF)
  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(streamCompletionTimer);
      processScan(barcodeInput.value);
    }
  });

  // Main Scan Processing & Carrier Verification
  function processScan(rawCode) {
    clearTimeout(streamCompletionTimer);
    scannerStatusBadge.innerText = 'READY';
    scannerStatusBadge.className = 'scan-status-pill';

    const code = rawCode.trim();
    if (!code) return;

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

    // Reset input for next scan
    barcodeInput.value = '';
    barcodeInput.focus();
  }

  // ACCURATE CARRIER & SERVICE DETERMINATION
  function parseCarrierRoute(code) {
    // 1. Direct database match in labels.json
    const record = knownLabels.find(l => l.barcode.toLowerCase() === code.toLowerCase());
    if (record) {
      return {
        barcode: record.barcode,
        primaryLocation: record.destination || record.carrier,
        subNote: record.service || record.subNote || '',
        verified: true
      };
    }

    // 2. FEDEX GROUND vs FEDEX EXPRESS SEPARATION
    // A. FedEx Ground 96 barcode (GS1-128 22-digit or 34-digit format: 96...)
    if (/^96\d{20,}/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'FedEx Ground',
        subNote: 'Package Barcode (96 GS1)',
        verified: true
      };
    }

    // B. FedEx Ground Barcode (Standard 15 digits or 20 digits starting with 00, 02, 04, 15)
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'FedEx Ground',
        subNote: 'Ground Commercial / Home Delivery',
        verified: true
      };
    }

    // C. FedEx Express Barcode (Standard 12 digits: e.g. 879136980972)
    // 12-digit numeric barcodes are standard FedEx Express Form 0430/0400 airbills
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'FedEx Express',
        subNote: 'Express Air Priority / Standard',
        verified: true
      };
    }

    // 3. UPS GROUND & EXPRESS (1Z...)
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      const serviceCode = code.substring(8, 10).toUpperCase();
      let upsService = 'UPS Ground';
      let upsLocation = 'UPS Ground';

      if (['01', '13', '14'].includes(serviceCode)) {
        upsLocation = 'UPS Next Day Air';
        upsService = 'Air Express Pickup';
      } else if (['02', '59'].includes(serviceCode)) {
        upsLocation = 'UPS 2nd Day Air';
        upsService = 'Air Express Pickup';
      } else if (['03'].includes(serviceCode)) {
        upsLocation = 'UPS Ground';
        upsService = 'Ground Commercial Pickup';
      }

      return {
        barcode: code,
        primaryLocation: upsLocation,
        subNote: upsService,
        verified: true
      };
    }

    // 4. USPS POSTAL
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'USPS Mail Cage',
        subNote: 'Ground Advantage / Priority',
        verified: true
      };
    }

    // 5. INTERNAL PRODUCTION ORDERS
    if (/^JOB-\d+$/i.test(code)) {
      return {
        barcode: code,
        primaryLocation: 'Press & Bindery Lane',
        subNote: 'Internal Production Work Order',
        verified: true
      };
    }

    // Fallback unverified
    return {
      barcode: code,
      primaryLocation: 'UNREGISTERED',
      subNote: '',
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
