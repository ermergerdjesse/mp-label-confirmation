// Shipping Pickup Verification Engine - Clean & Scaled
(function() {
  let knownLabels = [];
  let scanHistory = [];
  let soundEnabled = true;
  let debounceTimer = null;

  // Cache elements
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

  // Load labels.json safely
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
        osc.frequency.setValueAtTime(940, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } else {
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch(e) {}
  }

  // CARRIER & SERVICE DETERMINATION
  function parseCarrierRoute(raw) {
    const code = (raw || '').replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!code) return null;

    // 1. Direct database match in labels.json
    const record = knownLabels.find(l => {
      const dbCode = (l.barcode || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return dbCode === code.toLowerCase();
    });

    if (record) {
      return {
        barcode: record.barcode,
        destination: record.destination || record.carrier,
        service: record.service || record.subNote || '',
        verified: true
      };
    }

    // 2. UPS Mail Innovations (UPSMI)
    // 18-24 digits starting with 80 or 82, or starting with 92748
    if (/^80\d{16,24}$/.test(code) || /^82\d{16,24}$/.test(code) || /^92748\d+$/.test(code)) {
      return {
        barcode: code,
        destination: 'UPSMI',
        service: 'UPS Mail Innovations',
        verified: true
      };
    }

    // 3. DHL eCommerce / Express
    // GS1-128 postal routing code starting with 420[ZIP]92419... / 93419...
    if (/^420\d{5}(92419|93419|94419)\d+$/i.test(code) || /^(92419|93419|94419)\d{15,}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL eCommerce',
        verified: true
      };
    }
    // DHL Express Airway bill (10 digits)
    if (/^\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL Express',
        service: 'DHL Express Airway Bill',
        verified: true
      };
    }

    // 4. FEDEX GROUND / SMARTPOST
    // A. 15-digit or 20-digit barcodes
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code) || /^96\d{20,}/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'Ground Commercial / Home Delivery',
        verified: true
      };
    }

    // B. 12-digit FedEx Ground / SmartPost (prefixes 38..., 39..., 30..., 31...)
    // Example: 384322836030 (FedEx Ground), 384315914220 (FedEx SmartPost)
    if (/^(30|31|32|33|34|35|36|37|38|39)\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'Ground / SmartPost',
        verified: true
      };
    }

    // 5. FEDEX EXPRESS
    // 12-digit Express tracking numbers (prefixes starting with 7, 8, 9, 4, 5, 6, 1, 2)
    // Example: 879136980972 (FedEx 2Day / Express)
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Express',
        service: 'Express Priority / 2Day',
        verified: true
      };
    }

    // 6. UPS Ground / Air (1Z...)
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      const sc = code.substring(8, 10).toUpperCase();
      let loc = 'UPS Ground';
      let srv = 'Ground Commercial';
      if (['01', '13', '14'].includes(sc)) {
        loc = 'UPS Next Day Air';
        srv = 'Air Express Pickup';
      } else if (['02', '59'].includes(sc)) {
        loc = 'UPS 2nd Day Air';
        srv = 'Air Express Pickup';
      }
      return {
        barcode: code,
        destination: loc,
        service: srv,
        verified: true
      };
    }

    // 7. USPS Postal
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        destination: 'USPS Mail Cage',
        service: 'Ground Advantage / Priority',
        verified: true
      };
    }

    // 8. Internal job
    if (/^JOB/i.test(code)) {
      return {
        barcode: code,
        destination: 'Press & Bindery Lane',
        service: 'Internal Work Order',
        verified: true
      };
    }

    // Fallback unverified
    return {
      barcode: code,
      destination: 'UNREGISTERED',
      service: 'Unrecognized Barcode',
      verified: false
    };
  }

  // Core execution function
  function triggerVerification() {
    clearTimeout(debounceTimer);
    const rawVal = inputEl.value;
    if (!rawVal || !rawVal.trim()) return;

    const result = parseCarrierRoute(rawVal);
    if (!result) return;

    const time = new Date().toLocaleTimeString();

    if (result.verified) {
      cardEl.className = 'display-card success';
      statusBadgeText.innerText = 'VERIFIED';
      destEl.innerText = result.destination;
      subdestEl.innerText = result.service;
      barcodeDisplayEl.innerText = result.barcode;
      playTone(true);
    } else {
      cardEl.className = 'display-card danger';
      statusBadgeText.innerText = 'UNKNOWN';
      destEl.innerText = 'UNRECOGNIZED BARCODE';
      subdestEl.innerText = 'Re-scan or set aside for review';
      barcodeDisplayEl.innerText = result.barcode;
      playTone(false);
    }

    // History log
    scanHistory.unshift({
      time: time,
      barcode: result.barcode,
      destination: result.destination,
      service: result.service,
      status: result.verified ? 'VERIFIED' : 'FAILED'
    });

    if (statCount) statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input
    inputEl.value = '';
    if (badgeEl) {
      badgeEl.innerText = 'READY';
      badgeEl.className = 'scan-status-pill';
    }
    inputEl.focus();
  }

  function renderLog() {
    if (!historyBody) return;
    historyBody.innerHTML = scanHistory.map(item => `
      <tr>
        <td>${item.time}</td>
        <td>${item.barcode}</td>
        <td>${item.destination}</td>
        <td>${item.service}</td>
        <td><span class="${item.status === 'VERIFIED' ? 'log-success' : 'log-danger'}">${item.status}</span></td>
      </tr>
    `).join('');
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  // Enter key via keydown
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      triggerVerification();
    }
  });

  // Enter key via keyup
  inputEl.addEventListener('keyup', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      triggerVerification();
    }
  });

  // Instant trigger on PASTE
  inputEl.addEventListener('paste', function() {
    setTimeout(function() {
      triggerVerification();
    }, 20);
  });

  // Manual "ENTER / VERIFY" Button Click
  if (submitBtn) {
    submitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      triggerVerification();
    });
  }

  // Hardware scanner rapid stream auto-trigger
  inputEl.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const val = inputEl.value.trim();
    if (!val) {
      if (badgeEl) {
        badgeEl.innerText = 'READY';
        badgeEl.className = 'scan-status-pill';
      }
      return;
    }
    if (badgeEl) {
      badgeEl.innerText = 'TYPING...';
      badgeEl.className = 'scan-status-pill scanning';
    }

    debounceTimer = setTimeout(function() {
      if (inputEl.value.trim().length >= 8) {
        triggerVerification();
      }
    }, 400);
  });

  // Sound toggle
  if (soundBtn) {
    soundBtn.addEventListener('click', function() {
      soundEnabled = !soundEnabled;
      soundBtn.innerText = soundEnabled ? 'AUDIO: ON' : 'AUDIO: MUTED';
      inputEl.focus();
    });
  }

  // Log drawer
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
      const csv = 'Time,Barcode,Destination,Service,Status\n' + scanHistory.map(s => `"${s.time}","${s.barcode}","${s.destination}","${s.service}","${s.status}"`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `shipping-scans-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  }

  // Fullscreen
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        fullscreenBtn.innerText = 'EXIT FULLSCREEN';
      } else {
        document.exitFullscreen().catch(() => {});
        fullscreenBtn.innerText = 'FULLSCREEN';
      }
      inputEl.focus();
    });
  }

  // Auto-focus input
  window.addEventListener('click', function(e) {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      inputEl.focus();
    }
  });

  inputEl.focus();
})();
