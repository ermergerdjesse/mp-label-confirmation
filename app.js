// =============================================================================
// MARATHON PRESS - SHIPPING VERIFICATION LOGIC (app.js)
// Now with Distinct Carrier Color Classes for Easy Visual Sorting
//
// CARRIER COLOR KEY:
//   - FedEx Express: Vivid Orange (#ff7700) -> .carrier-fedex-express
//   - FedEx Ground:  Emerald Green (#10b981) -> .carrier-fedex-ground
//   - UPS:           UPS Gold (#f59e0b)      -> .carrier-ups
//   - USPS:          Postal Blue (#3b82f6)   -> .carrier-usps
//   - DHL:           DHL Yellow (#eab308)    -> .carrier-dhl
//   - UPSMI:         Violet/Purple (#a855f7) -> .carrier-upsmi
// =============================================================================

(function() {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  let debounceTimer = null;

  // Cache HTML elements
  const inputEl = document.getElementById('barcodeInput');
  const submitBtn = document.getElementById('submitScanBtn');
  const badgeEl = document.getElementById('scannerStatusBadge');
  const cardEl = document.getElementById('displayCard');
  const statusBadgeText = document.getElementById('statusBadgeText');
  const destEl = document.getElementById('signDestination');
  const subdestEl = document.getElementById('signSubdest');
  const barcodeDisplayEl = document.getElementById('signBarcode');
  const statCount = document.getElementById('statCount');
  const historyBody = document.getElementById('scanHistoryBody');
  const soundBtn = document.getElementById('soundToggleBtn');
  const historyBtn = document.getElementById('historyToggleBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const logDrawer = document.getElementById('logDrawer');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Load static label database (labels.json) if available
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = Array.isArray(data) ? data : [];
    })
    .catch(() => {
      knownLabels = [];
    });

  // Sound Synth
  let audioCtx = null;
  function playTone(success) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (success) {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.10);
      } else {
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.30);
      }
    } catch(e) {}
  }

  // ===========================================================================
  // CARRIER & DESTINATION ROUTING ENGINE
  // Returns:
  //   - destination: Text to display in giant letters
  //   - service: Secondary explanation text
  //   - colorClass: CSS theme class for the giant background card
  // ===========================================================================
  function parseCarrierRoute(raw) {
    const code = (raw || '').replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!code) return null;

    // STEP 1: Check labels.json first for exact manual overrides
    const record = knownLabels.find(l => {
      const dbCode = (l.barcode || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return dbCode === code.toLowerCase();
    });

    if (record) {
      let cClass = 'carrier-fedex-ground';
      const destLower = (record.destination || '').toLowerCase();
      if (destLower.includes('express')) cClass = 'carrier-fedex-express';
      else if (destLower.includes('upsmi')) cClass = 'carrier-upsmi';
      else if (destLower.includes('ups')) cClass = 'carrier-ups';
      else if (destLower.includes('usps')) cClass = 'carrier-usps';
      else if (destLower.includes('dhl')) cClass = 'carrier-dhl';

      return {
        barcode: record.barcode,
        destination: record.destination || record.carrier,
        service: record.service || '',
        colorClass: cClass,
        verified: true
      };
    }

    // STEP 2: UPS MAIL INNOVATIONS (UPSMI) -> VIOLET/PURPLE
    // 18-24 digits starting with 80 or 82, or postal codes starting with 92748
    if (/^80\d{16,24}$/.test(code) || /^82\d{16,24}$/.test(code) || /^92748\d+$/.test(code)) {
      return {
        barcode: code,
        destination: 'UPSMI',
        service: 'UPS Mail Innovations',
        colorClass: 'carrier-upsmi',
        verified: true
      };
    }

    // STEP 3: DHL ECOMMERCE & EXPRESS -> DHL YELLOW
    if (/^420\d{5}(92419|93419|94419)\d+$/i.test(code) || /^(92419|93419|94419)\d{15,}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL eCommerce',
        colorClass: 'carrier-dhl',
        verified: true
      };
    }
    if (/^\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL Express',
        colorClass: 'carrier-dhl',
        verified: true
      };
    }

    // STEP 4: FEDEX GROUND & SMARTPOST -> EMERALD GREEN
    //  - 15-digit and 20-digit barcodes
    //  - 96... GS1 barcodes
    //  - 12-digit Ground & SmartPost tracking starting with 30-39 (e.g. 384322836030, 384315914220)
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code) || /^96\d{20,}/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        colorClass: 'carrier-fedex-ground',
        verified: true
      };
    }
    if (/^(30|31|32|33|34|35|36|37|38|39)\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        colorClass: 'carrier-fedex-ground',
        verified: true
      };
    }

    // STEP 5: FEDEX EXPRESS -> VIVID ORANGE
    // 12-digit Express tracking numbers (2Day, Priority, Overnight, Standard)
    // Prefixes starting with 7, 8, 9, 4, 5, 6, 1, 2 (e.g. 879136980972)
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Express',
        service: 'FedEx Express',
        colorClass: 'carrier-fedex-express',
        verified: true
      };
    }

    // STEP 6: UPS (All Ground + Air unified into "UPS") -> UPS GOLD
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return {
        barcode: code,
        destination: 'UPS',
        service: 'UPS Pickup',
        colorClass: 'carrier-ups',
        verified: true
      };
    }

    // STEP 7: USPS -> POSTAL BLUE
    // Standard 22-digit to 30-digit postal barcodes starting with 92, 93, 94, 95 or 420
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        destination: 'USPS',
        service: 'Postal Pickup',
        colorClass: 'carrier-usps',
        verified: true
      };
    }

    // STEP 8: INTERNAL PRESS / BINDERY WORK ORDERS -> MARATHON RED
    if (/^JOB/i.test(code)) {
      return {
        barcode: code,
        destination: 'Internal Job',
        service: 'Bindery / Press Staging',
        colorClass: 'carrier-internal',
        verified: true
      };
    }

    // FALLBACK: Barcode not recognized -> DANGER RED
    return {
      barcode: code,
      destination: 'Unrecognized Label',
      service: 'Check label format or route manually',
      colorClass: 'danger',
      verified: false
    };
  }

  // ===========================================================================
  // SCREEN UPDATE TRIGGER
  // ===========================================================================
  function triggerVerification() {
    clearTimeout(debounceTimer);
    const rawVal = inputEl.value;
    if (!rawVal || !rawVal.trim()) return;

    const result = parseCarrierRoute(rawVal);
    if (!result) return;

    const time = new Date().toLocaleTimeString();

    if (result.verified) {
      // Apply the specific carrier color class
      cardEl.className = 'display-panel ' + result.colorClass;
      statusBadgeText.innerText = 'Verified';
      destEl.innerText = result.destination;
      subdestEl.innerText = result.service;
      barcodeDisplayEl.innerText = result.barcode;
      playTone(true);
    } else {
      cardEl.className = 'display-panel danger';
      statusBadgeText.innerText = 'Not Recognized';
      destEl.innerText = result.destination;
      subdestEl.innerText = result.service;
      barcodeDisplayEl.innerText = result.barcode;
      playTone(false);
    }

    // Add to audit history
    scanHistory.unshift({
      time: time,
      barcode: result.barcode,
      destination: result.destination,
      service: result.service,
      colorClass: result.colorClass,
      status: result.verified ? 'Verified' : 'Failed'
    });

    if (statCount) statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input box and ensure cursor stays locked inside
    inputEl.value = '';
    if (badgeEl) {
      badgeEl.innerText = 'READY';
      badgeEl.className = 'status-indicator-pill';
    }
    inputEl.focus();
  }

  // Render scan drawer table rows
  function renderLog() {
    if (!historyBody) return;
    historyBody.innerHTML = scanHistory.map(item => {
      let tagClass = 'tag-verified';
      if (item.status === 'Failed') tagClass = 'tag-failed';
      else if (item.colorClass === 'carrier-fedex-express') tagClass = 'log-fedex-express';
      else if (item.colorClass === 'carrier-fedex-ground')  tagClass = 'log-fedex-ground';
      else if (item.colorClass === 'carrier-ups')           tagClass = 'log-ups';
      else if (item.colorClass === 'carrier-usps')          tagClass = 'log-usps';
      else if (item.colorClass === 'carrier-dhl')           tagClass = 'log-dhl';
      else if (item.colorClass === 'carrier-upsmi')         tagClass = 'log-upsmi';

      return `
        <tr>
          <td>${item.time}</td>
          <td>${item.barcode}</td>
          <td class="${tagClass}">${item.destination}</td>
          <td>${item.service}</td>
          <td><span class="${item.status === 'Verified' ? 'tag-verified' : 'tag-failed'}">${item.status}</span></td>
        </tr>
      `;
    }).join('');
  }

  // Event Listeners
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      triggerVerification();
    }
  });

  inputEl.addEventListener('keyup', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      triggerVerification();
    }
  });

  inputEl.addEventListener('paste', function() {
    setTimeout(function() {
      triggerVerification();
    }, 20);
  });

  if (submitBtn) {
    submitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      triggerVerification();
    });
  }

  inputEl.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const val = inputEl.value.trim();
    if (!val) {
      if (badgeEl) {
        badgeEl.innerText = 'READY';
        badgeEl.className = 'status-indicator-pill';
      }
      return;
    }
    if (badgeEl) {
      badgeEl.innerText = 'READING';
      badgeEl.className = 'status-indicator-pill busy';
    }

    debounceTimer = setTimeout(function() {
      if (inputEl.value.trim().length >= 8) {
        triggerVerification();
      }
    }, 400);
  });

  if (soundBtn) {
    soundBtn.addEventListener('click', function() {
      soundEnabled = !soundEnabled;
      soundBtn.innerText = soundEnabled ? 'Audio: On' : 'Audio: Off';
      inputEl.focus();
    });
  }

  if (historyBtn && logDrawer) {
    historyBtn.addEventListener('click', function() {
      logDrawer.classList.toggle('open');
    });
  }
  if (closeDrawerBtn && logDrawer) {
    closeDrawerBtn.addEventListener('click', function() {
      logDrawer.classList.remove('open');
      inputEl.focus();
    });
  }
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', function() {
      scanHistory = [];
      if (statCount) statCount.innerText = '0';
      renderLog();
    });
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', function() {
      if (!scanHistory.length) return alert('No scans to export.');
      const csv = 'Time,Barcode,Carrier,Service,Status\n' + scanHistory.map(s => `"${s.time}","${s.barcode}","${s.destination}","${s.service}","${s.status}"`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marathon-scans-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        fullscreenBtn.innerText = 'Exit Fullscreen';
      } else {
        document.exitFullscreen().catch(() => {});
        fullscreenBtn.innerText = 'Fullscreen';
      }
      inputEl.focus();
    });
  }

  window.addEventListener('click', function(e) {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      inputEl.focus();
    }
  });

  inputEl.focus();
})();
