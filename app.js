// =============================================================================
// MARATHON PRESS - SHIPPING VERIFICATION LOGIC (app.js)
// Handheld barcode scanner listeners, carrier color coding, and pattern matching.
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

  // Load manual overrides from labels.json
  fetch('labels.json')
    .then(r => r.json())
    .then(data => {
      knownLabels = Array.isArray(data) ? data : [];
    })
    .catch(() => {
      knownLabels = [];
    });

  // Audio confirmation tone
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

  // Helper: map carrier destination to its color theme class in style.css
  function getThemeClass(destination) {
    const d = (destination || '').toLowerCase();
    if (d.includes('fedex ground')) return 'carrier-fedex-ground';
    if (d.includes('fedex express')) return 'carrier-fedex-express';
    if (d === 'ups') return 'carrier-ups';
    if (d === 'usps') return 'carrier-usps';
    if (d === 'dhl') return 'carrier-dhl';
    if (d === 'upsmi') return 'carrier-upsmi';
    if (d.includes('internal')) return 'carrier-internal';
    return 'carrier-fedex-ground';
  }

  // ===========================================================================
  // CARRIER & DESTINATION ROUTING ENGINE
  // ===========================================================================
  function parseCarrierRoute(raw) {
    const code = (raw || '').replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!code) return null;

    // 1. Check labels.json manual overrides first
    const record = knownLabels.find(l => {
      const dbCode = (l.barcode || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return dbCode === code.toLowerCase();
    });

    if (record) {
      return {
        barcode: record.barcode,
        destination: record.destination || record.carrier,
        service: record.service || '',
        theme: getThemeClass(record.destination || record.carrier),
        verified: true
      };
    }

    // 2. UPS MAIL INNOVATIONS (UPSMI) -> Violet Theme
    // 18-24 digits starting with 80 or 82, or postal codes starting with 92748
    if (/^80\d{16,24}$/.test(code) || /^82\d{16,24}$/.test(code) || /^92748\d+$/.test(code)) {
      return {
        barcode: code,
        destination: 'UPSMI',
        service: 'UPS Mail Innovations',
        theme: 'carrier-upsmi',
        verified: true
      };
    }

    // 3. DHL ECOMMERCE & EXPRESS -> Canary Yellow Theme
    if (/^420\d{5}(92419|93419|94419)\d+$/i.test(code) || /^(92419|93419|94419)\d{15,}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL eCommerce',
        theme: 'carrier-dhl',
        verified: true
      };
    }
    if (/^\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL Express',
        theme: 'carrier-dhl',
        verified: true
      };
    }

    // 4. FEDEX GROUND & SMARTPOST -> Emerald Green Theme
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code) || /^96\d{20,}/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        theme: 'carrier-fedex-ground',
        verified: true
      };
    }
    if (/^(30|31|32|33|34|35|36|37|38|39)\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        theme: 'carrier-fedex-ground',
        verified: true
      };
    }

    // 5. FEDEX EXPRESS -> Electric Orange Theme
    // 12-digit Express tracking numbers (2Day, Priority, Overnight, Standard)
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Express',
        service: 'FedEx Express',
        theme: 'carrier-fedex-express',
        verified: true
      };
    }

    // 6. UPS (All Ground + Air unified into "UPS") -> Warm Amber Theme
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return {
        barcode: code,
        destination: 'UPS',
        service: 'UPS Pickup',
        theme: 'carrier-ups',
        verified: true
      };
    }

    // 7. USPS -> Postal Blue Theme (Displays strictly "USPS")
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        destination: 'USPS',
        service: 'Postal Pickup',
        theme: 'carrier-usps',
        verified: true
      };
    }

    // 8. INTERNAL PRODUCTION ORDERS -> Marathon Red Theme
    if (/^JOB/i.test(code)) {
      return {
        barcode: code,
        destination: 'Internal Job',
        service: 'Bindery / Press Staging',
        theme: 'carrier-internal',
        verified: true
      };
    }

    // FALLBACK: Barcode not recognized
    return {
      barcode: code,
      destination: 'Unrecognized Label',
      service: 'Check label format or route manually',
      theme: 'danger',
      verified: false
    };
  }

  // Screen update trigger
  function triggerVerification() {
    clearTimeout(debounceTimer);
    const rawVal = inputEl.value;
    if (!rawVal || !rawVal.trim()) return;

    const result = parseCarrierRoute(rawVal);
    if (!result) return;

    const time = new Date().toLocaleTimeString();

    if (result.verified) {
      // Set panel to the specific carrier color class
      cardEl.className = 'display-panel ' + result.theme;
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
      status: result.verified ? 'Verified' : 'Failed'
    });

    if (statCount) statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input box
    inputEl.value = '';
    if (badgeEl) {
      badgeEl.innerText = 'READY';
      badgeEl.className = 'status-indicator-pill';
    }
    inputEl.focus();
  }

  // Render scan drawer table
  function renderLog() {
    if (!historyBody) return;
    historyBody.innerHTML = scanHistory.map(item => `
      <tr>
        <td>${item.time}</td>
        <td>${item.barcode}</td>
        <td>${item.destination}</td>
        <td>${item.service}</td>
        <td><span class="${item.status === 'Verified' ? 'tag-verified' : 'tag-failed'}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  // Event Listeners: Enter keydown & keyup
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

  // Instant clipboard paste
  inputEl.addEventListener('paste', function() {
    setTimeout(function() {
      triggerVerification();
    }, 20);
  });

  // Manual verify button
  if (submitBtn) {
    submitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      triggerVerification();
    });
  }

  // Scanner rapid stream auto-trigger
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

  // Sound, Drawer, CSV Export, Fullscreen controls
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

  // Keep input focused automatically
  window.addEventListener('click', function(e) {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      inputEl.focus();
    }
  });

  inputEl.focus();
})();
