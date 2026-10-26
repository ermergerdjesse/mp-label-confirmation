// Marathon Press Dispatch & Verification Console
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

  // CARRIER & SERVICE DETERMINATION - STRICT CLEAN ROUTING
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
        service: record.service || '',
        verified: true
      };
    }

    // 2. UPS MAIL INNOVATIONS (UPSMI)
    if (/^80\d{16,24}$/.test(code) || /^82\d{16,24}$/.test(code) || /^92748\d+$/.test(code)) {
      return {
        barcode: code,
        destination: 'UPSMI',
        service: 'UPS Mail Innovations',
        verified: true
      };
    }

    // 3. DHL ECOMMERCE / EXPRESS
    if (/^420\d{5}(92419|93419|94419)\d+$/i.test(code) || /^(92419|93419|94419)\d{15,}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL eCommerce',
        verified: true
      };
    }
    if (/^\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'DHL',
        service: 'DHL Express',
        verified: true
      };
    }

    // 4. FEDEX GROUND (Consolidated Ground & SmartPost)
    // 15-digit, 20-digit, 96... GS1 barcodes
    if (/^\d{15}$/.test(code) || /^00\d{18}$/.test(code) || /^96\d{20,}/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        verified: true
      };
    }
    // 12-digit FedEx Ground / SmartPost (prefixes 30... through 39...)
    if (/^(30|31|32|33|34|35|36|37|38|39)\d{10}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Ground',
        service: 'FedEx Ground',
        verified: true
      };
    }

    // 5. FEDEX EXPRESS (Express 2Day, Priority, Standard)
    if (/^\d{12}$/.test(code)) {
      return {
        barcode: code,
        destination: 'FedEx Express',
        service: 'FedEx Express',
        verified: true
      };
    }

    // 6. UPS (All UPS Ground & Air consolidated into one "UPS")
    if (/^1Z[0-9A-Z]{16}$/i.test(code)) {
      return {
        barcode: code,
        destination: 'UPS',
        service: 'UPS Pickup',
        verified: true
      };
    }

    // 7. USPS (Strictly displays "USPS" - NO "Mail Cage")
    // Barcodes starting with 92, 93, 94, 95 or 420 (e.g. 9400150105800133120300)
    if (/^9[2-5]\d{20}/.test(code) || /^420\d{27}/.test(code)) {
      return {
        barcode: code,
        destination: 'USPS',
        service: 'Postal Pickup',
        verified: true
      };
    }

    // 8. Internal job
    if (/^JOB/i.test(code)) {
      return {
        barcode: code,
        destination: 'Internal Job',
        service: 'Bindery / Press Staging',
        verified: true
      };
    }

    // Fallback unverified
    return {
      barcode: code,
      destination: 'Unrecognized Label',
      service: 'Check label format or route manually',
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
      cardEl.className = 'display-panel success';
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

    // History log
    scanHistory.unshift({
      time: time,
      barcode: result.barcode,
      destination: result.destination,
      service: result.service,
      status: result.verified ? 'Verified' : 'Failed'
    });

    if (statCount) statCount.innerText = scanHistory.length;
    renderLog();

    // Reset input
    inputEl.value = '';
    if (badgeEl) {
      badgeEl.innerText = 'Active';
      badgeEl.className = 'status-indicator-pill';
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
        <td><span class="${item.status === 'Verified' ? 'tag-verified' : 'tag-failed'}">${item.status}</span></td>
      </tr>
    `).join('');
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
        badgeEl.innerText = 'Active';
        badgeEl.className = 'status-indicator-pill';
      }
      return;
    }
    if (badgeEl) {
      badgeEl.innerText = 'Reading';
      badgeEl.className = 'status-indicator-pill busy';
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
      soundBtn.innerText = soundEnabled ? 'Audio: On' : 'Audio: Off';
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
      const csv = 'Time,Barcode,Carrier,Service,Status\n' + scanHistory.map(s => `"${s.time}","${s.barcode}","${s.destination}","${s.service}","${s.status}"`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marathon-scans-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    });
  }

  // Fullscreen
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

  // Auto-focus input
  window.addEventListener('click', function(e) {
    if (!['BUTTON', 'A'].includes(e.target.tagName)) {
      inputEl.focus();
    }
  });

  inputEl.focus();
})();
