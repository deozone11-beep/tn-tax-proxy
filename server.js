const http = require('http');
const puppeteer = require('puppeteer');
const PORT = process.env.PORT || 3000;

// Browser instance pool — reuse for speed
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });
  }
  return browserInstance;
}

// Load property page and return HTML + screenshot
async function loadProperty(ref) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Go to govt site
    await page.goto('https://tnurbanepay.tn.gov.in/PT_CPPaymentDetails.aspx', {
      waitUntil: 'networkidle2', timeout: 30000
    });

    // Fill assessment number
    await page.waitForSelector('#PageContent_txtRefNumber', { timeout: 10000 });
    await page.evaluate((refNum) => {
      var inp = document.getElementById('PageContent_txtRefNumber');
      inp.value = refNum;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, ref);

    // Click Search
    await page.click('#PageContent_btnGetDetails');

    // Wait for results
    await page.waitForFunction(() => {
      var owner = document.getElementById('PageContent_alblOwner');
      return owner && owner.textContent.trim().length > 0;
    }, { timeout: 15000 }).catch(() => {});

    // Get page data
    const data = await page.evaluate(() => {
      const g = (id) => {
        var el = document.getElementById(id);
        return el ? el.textContent.trim() : '';
      };
      // Get due table rows
      const dues = [];
      var rows = document.querySelectorAll('#PageContent_gvpayment tr');
      rows.forEach(function(row) {
        var cells = row.querySelectorAll('td');
        if (cells.length >= 12 && cells[1] && cells[1].textContent.trim() !== 'Total') {
          dues.push({
            period: cells[1].textContent.trim(),
            taxDemand: cells[2].textContent.trim(),
            taxBalance: cells[6].textContent.trim(),
            totalBalance: cells[8].textContent.trim(),
            cumBalance: cells[11].textContent.trim()
          });
        }
      });
      // Last payment
      const lastPay = [];
      var payRows = document.querySelectorAll('#PageContent_gvLastPaymentDet tr');
      payRows.forEach(function(row) {
        var cells = row.querySelectorAll('td');
        if (cells.length >= 8 && cells[1]) {
          lastPay.push({
            receipt: cells[1].textContent.trim(),
            assNo: cells[2].textContent.trim(),
            date: cells[4].textContent.trim(),
            amount: cells[5].textContent.trim(),
            status: cells[7].textContent.trim()
          });
        }
      });
      // Hidden fields for submit
      var vs = document.getElementById('__VIEWSTATE');
      var ev = document.getElementById('__EVENTVALIDATION');
      var vsg = document.getElementById('__VIEWSTATEGENERATOR');
      var hdnref = document.getElementById('PageContent_hdnref');
      var totamt = document.getElementById('PageContent_totamt_value');
      var propTypeId = document.getElementById('PageContent_HdPropertyTypeID');
      return {
        ownerName: g('PageContent_alblOwner'),
        ownerNameTamil: g('PageContent_alblOwnerintamil'),
        assessmentNo: g('PageContent_alblAssesmentnoText'),
        oldAssessmentNo: g('PageContent_alblOldAssesmentnoText'),
        address: (g('PageContent_alblDoorNo') + ' ' + g('PageContent_alblStreet1') + ', ' + g('PageContent_alborganization') + ' ' + g('PageContent_alblPincode')).trim(),
        addressTamil: (g('PageContent_alblDoorNot') + ' ' + g('PageContent_alblStreet1ll') + ', ' + g('PageContent_alborganizationLL') + ' ' + g('PageContent_alblPincodell')).trim(),
        assessmentType: g('PageContent_lblasstype'),
        zone: g('PageContent_lblZoneText'),
        ward: g('PageContent_lblWardText'),
        usage: g('PageContent_lblusage'),
        totalAreaSqft: g('PageContent_Label21'),
        annualRentalValue: g('PageContent_albl_netannualvalue'),
        halfYearlyTax: g('PageContent_albl_halfyeartax'),
        assessmentStatus: g('PageContent_lblflag'),
        balanceAmt: g('PageContent_lbl_balanceamt_view'),
        advanceAmt: g('PageContent_lbl_advanceamt_view'),
        payableAmt: g('PageContent_lblpayamt'),
        dues, lastPay,
        // Hidden fields for submit
        viewstate: vs ? vs.value : '',
        eventValidation: ev ? ev.value : '',
        viewstateGen: vsg ? vsg.value : 'A4D7941B',
        hdnref: hdnref ? hdnref.value : '',
        totamt: totamt ? totamt.value : '',
        propTypeId: propTypeId ? propTypeId.value : '1',
      };
    });

    // Get cookies for submit
    const cookies = await page.cookies('https://tnurbanepay.tn.gov.in');
    const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');

    await page.close();
    return { ...data, cookieStr, found: data.ownerName !== '' };

  } catch(e) {
    await page.close();
    throw e;
  }
}

// Submit payment using puppeteer (same browser session)
async function submitPayment(ref, amount) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto('https://tnurbanepay.tn.gov.in/PT_CPPaymentDetails.aspx', {
      waitUntil: 'networkidle2', timeout: 30000
    });

    await page.waitForSelector('#PageContent_txtRefNumber');
    await page.evaluate((refNum) => {
      document.getElementById('PageContent_txtRefNumber').value = refNum;
      document.getElementById('PageContent_txtRefNumber').dispatchEvent(new Event('change', {bubbles:true}));
    }, ref);

    await page.click('#PageContent_btnGetDetails');

    await page.waitForFunction(() => {
      var el = document.getElementById('PageContent_alblOwner');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 15000 });

    // Fill payment amount
    await page.waitForSelector('#PageContent_txtTransactionAmount');
    await page.evaluate((amt) => {
      document.getElementById('PageContent_txtTransactionAmount').value = amt;
    }, String(amount));

    // Click Submit
    await page.click('#PageContent_btnSubmit');

    // Wait for ConformationResponce page
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });

    // Get confirmation page HTML
    const confirmHtml = await page.content();
    const confirmUrl = page.url();

    // Extract key fields
    const confirmData = await page.evaluate(() => {
      const g = id => { var e = document.getElementById(id); return e ? e.textContent.trim() : ''; };
      return {
        serviceName: g('lblPaymentHead'),
        municipality: g('lblMuncipality'),
        ownerName: g('lblapplicantname'),
        assessmentNo: g('lblReferenceNo'),
        totalAmount: g('lblTotalamt'),
        url: window.location.href
      };
    });

    // Screenshot of confirmation page
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    await page.close();
    return { ...confirmData, screenshot, confirmUrl };

  } catch(e) {
    await page.close();
    throw e;
  }
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── GET /view/:ref — Beautiful property details page ─────────────────────
  if (req.method === 'GET' && pathname.startsWith('/view/')) {
    const ref = decodeURIComponent(pathname.slice(6));
    console.log('\nVIEW:', ref);
    try {
      const data = await loadProperty(ref);
      if (!data.found) {
        res.writeHead(404, {'Content-Type':'text/html'});
        res.end(errorPage('Property not found: ' + ref));
        return;
      }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(propertyPage(data, ref));
    } catch(e) {
      console.error(e.message);
      res.writeHead(500, {'Content-Type':'text/html'});
      res.end(errorPage(e.message));
    }
    return;
  }

  // ── POST /submit — Submit payment via puppeteer ───────────────────────────
  if (req.method === 'POST' && pathname === '/submit') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body); } catch(e) { res.writeHead(400); res.end('{}'); return; }
      const { ref, amount } = payload;
      console.log('\nSUBMIT:', ref, 'amount:', amount);
      try {
        const result = await submitPayment(ref, amount);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true, ...result }));
      } catch(e) {
        console.error(e.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(homePage());
  });
});

// ─── HTML TEMPLATES ──────────────────────────────────────────────────────────
function homePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TN Property Tax</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#e8f5e9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12);max-width:440px;width:100%;overflow:hidden}
.hdr{background:#2e7d32;color:#fff;padding:24px;text-align:center}
.hdr img{width:48px;height:48px;background:#fff;border-radius:50%;margin-bottom:8px}
.hdr h1{font-size:18px;font-weight:bold;margin-bottom:4px}
.hdr p{font-size:12px;opacity:.85}
.body{padding:28px}
label{font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:8px}
input{width:100%;border:2px solid #e0e0e0;padding:12px 14px;font-family:monospace;font-size:16px;border-radius:8px;outline:none;transition:.2s;letter-spacing:.05em}
input:focus{border-color:#4caf50;box-shadow:0 0 0 3px rgba(76,175,80,.15)}
.btn{width:100%;background:#2e7d32;color:#fff;border:none;padding:14px;font-size:15px;font-weight:bold;border-radius:8px;cursor:pointer;margin-top:12px;transition:.2s}
.btn:hover{background:#1b5e20}
.hint{font-size:11px;color:#aaa;text-align:center;margin-top:10px}
.spinner{display:none;text-align:center;padding:20px;color:#555}
</style></head>
<body>
<div class="card">
  <div class="hdr">
    <h1>🏛️ TN Property Tax</h1>
    <p>Commissionerate of Municipal Administration<br>நகராட்சி நிர்வாக ஆணையரகம்</p>
  </div>
  <div class="body">
    <label>Assessment Number</label>
    <input type="text" id="ref" placeholder="082/001/900540" autocomplete="off" />
    <button class="btn" onclick="go()">🔍 View Details & Pay</button>
    <div class="spinner" id="spin">⏳ Loading... please wait</div>
    <div class="hint">Enter assessment number and click to view property details</div>
  </div>
</div>
<script>
function go(){
  var r=document.getElementById('ref').value.trim();
  if(!r){alert('Assessment number enter பண்ணுங்க');return;}
  document.getElementById('spin').style.display='block';
  window.location.href='/view/'+encodeURIComponent(r);
}
document.getElementById('ref').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
</script>
</body></html>`;
}

function propertyPage(d, ref) {
  const dueRows = (d.dues || []).map((r, i) => `
    <tr style="background:${i%2===0?'#fff':'#f9f9f9'}">
      <td>${i+1}</td><td>${r.period}</td>
      <td align="right">${r.taxDemand}</td>
      <td align="right">${r.taxBalance}</td>
      <td align="right">${r.totalBalance}</td>
      <td align="right"><strong>${r.cumBalance}</strong></td>
    </tr>`).join('');

  const lastPayRows = (d.lastPay || []).map((p, i) => `
    <tr>
      <td>${i+1}</td><td>${p.receipt}</td><td>${p.assNo}</td>
      <td>${p.date}</td><td align="right">${p.amount}</td>
      <td style="color:${p.status==='SUCCESS'?'#2a7a2a':'#c00'};font-weight:bold">${p.status}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TN Tax — ${ref}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f5f5f5;color:#222}
.topbar{background:#1b5e20;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:99}
.topbar h2{font-size:14px;flex:1}
.topbar .ref{font-family:monospace;font-size:13px;background:rgba(255,255,255,.2);padding:3px 10px;border-radius:20px}
.wrap{max-width:1000px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);margin-bottom:14px;overflow:hidden}
.card-hdr{background:#2e7d32;color:#fff;padding:10px 16px;font-size:13px;font-weight:bold}
.card-body{padding:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
.field{padding:5px 0;border-bottom:1px solid #f0f0f0}
.field-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
.field-value{font-size:13px;color:#222;font-weight:500}
.field-value.blue{color:#1565c0;font-weight:bold}
.field-value.green{color:#2e7d32;font-weight:bold}
.amount-box{background:#e8f5e9;border:2px solid #4caf50;border-radius:8px;padding:14px;text-align:center;margin-bottom:14px}
.amount-label{font-size:12px;color:#555;margin-bottom:4px}
.amount-value{font-size:28px;font-weight:bold;color:#1b5e20}
.pay-input{display:flex;gap:8px;align-items:center;margin-top:10px}
.pay-input input{flex:1;border:2px solid #4caf50;padding:10px 12px;font-size:16px;border-radius:6px;outline:none}
.pay-btn{background:#2e7d32;color:#fff;border:none;padding:10px 20px;font-size:14px;font-weight:bold;border-radius:6px;cursor:pointer;white-space:nowrap}
.pay-btn:hover{background:#1b5e20}
.pay-btn:disabled{background:#aaa;cursor:not-allowed}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#4682B4;color:#fff;padding:7px 8px;text-align:center}
td{border:1px solid #e0e0e0;padding:6px 8px;text-align:center}
.status-ok{color:#2a7a2a;font-weight:bold}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;align-items:center;justify-content:center}
.modal.show{display:flex}
.modal-box{background:#fff;border-radius:12px;max-width:500px;width:92%;overflow:hidden}
.modal-hdr{background:#2e7d32;color:#fff;padding:14px 18px;font-weight:bold;font-size:15px}
.modal-body{padding:20px;text-align:center}
.modal-body img{max-width:100%;border-radius:6px;margin-top:10px}
.spinner-modal{font-size:14px;color:#555;padding:20px}
.close-btn{background:#ccc;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;margin-top:12px;font-size:13px}
.confirm-field{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
.confirm-field span:first-child{color:#666}
.confirm-field span:last-child{font-weight:bold}
</style>
</head>
<body>

<div class="topbar">
  <h2>🏛️ TN Property Tax</h2>
  <span class="ref">${ref}</span>
  <a href="/" style="color:#fff;font-size:12px;text-decoration:none">← Back</a>
</div>

<div class="wrap">
  <!-- Amount & Pay -->
  <div class="card">
    <div class="card-hdr">💰 Payment Details</div>
    <div class="card-body">
      <div class="amount-box">
        <div class="amount-label">Payable Amount</div>
        <div class="amount-value">₹ ${d.payableAmt || '—'}</div>
      </div>
      <div class="pay-input">
        <input type="number" id="payAmt" placeholder="Amount" value="${d.payableAmt || ''}" />
        <button class="pay-btn" id="payBtn" onclick="doSubmit()">💳 Pay Now</button>
      </div>
      <div style="font-size:11px;color:#888;margin-top:6px">Balance: ₹${d.balanceAmt || '0'} | Advance: ₹${d.advanceAmt || '0'}</div>
    </div>
  </div>

  <!-- Assessee Details -->
  <div class="card">
    <div class="card-hdr">👤 Property Tax Assessee Details</div>
    <div class="card-body">
      <div class="grid">
        <div class="field"><div class="field-label">Owner Name</div><div class="field-value">${d.ownerName}</div></div>
        <div class="field"><div class="field-label">உரிமையாளர் பெயர்</div><div class="field-value">${d.ownerNameTamil}</div></div>
        <div class="field"><div class="field-label">Assessment No</div><div class="field-value">${d.assessmentNo}</div></div>
        <div class="field"><div class="field-label">Old Assessment No</div><div class="field-value">${d.oldAssessmentNo}</div></div>
        <div class="field"><div class="field-label">Address</div><div class="field-value">${d.address}</div></div>
        <div class="field"><div class="field-label">முகவரி</div><div class="field-value">${d.addressTamil}</div></div>
        <div class="field"><div class="field-label">Assessment Type</div><div class="field-value blue">${d.assessmentType}</div></div>
        <div class="field"><div class="field-label">Zone</div><div class="field-value">${d.zone}</div></div>
        <div class="field"><div class="field-label">Ward</div><div class="field-value">${d.ward}</div></div>
        <div class="field"><div class="field-label">Usage</div><div class="field-value blue">${d.usage}</div></div>
        <div class="field"><div class="field-label">Annual Rental Value</div><div class="field-value">₹ ${d.annualRentalValue}</div></div>
        <div class="field"><div class="field-label">Half Yearly Tax</div><div class="field-value">₹ ${d.halfYearlyTax}</div></div>
        <div class="field"><div class="field-label">Assessment Status</div><div class="field-value green">${d.assessmentStatus}</div></div>
        <div class="field"><div class="field-label">Total Area (Sqft)</div><div class="field-value blue">${d.totalAreaSqft}</div></div>
      </div>
    </div>
  </div>

  <!-- Last Payment -->
  ${lastPayRows ? `<div class="card">
    <div class="card-hdr">🧾 Property Tax Last Payment Details</div>
    <div class="card-body" style="overflow-x:auto">
      <table>
        <thead><tr><th>S.No</th><th>Receipt No</th><th>Assessment No</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${lastPayRows}</tbody>
      </table>
    </div>
  </div>` : ''}

  <!-- Due Details -->
  ${dueRows ? `<div class="card">
    <div class="card-hdr">📋 Property Tax Due Details</div>
    <div class="card-body" style="overflow-x:auto">
      <table>
        <thead><tr><th>S.No</th><th>Period</th><th>Tax Demand</th><th>Tax Balance</th><th>Total Balance</th><th>Cumulative</th></tr></thead>
        <tbody>${dueRows}</tbody>
      </table>
    </div>
  </div>` : ''}
</div>

<!-- Payment Modal -->
<div class="modal" id="modal">
  <div class="modal-box">
    <div class="modal-hdr">💳 Payment Confirmation</div>
    <div class="modal-body" id="modalBody">
      <div class="spinner-modal">⏳ Processing payment... please wait</div>
    </div>
  </div>
</div>

<script>
var REF = ${JSON.stringify(ref)};

function doSubmit() {
  var amt = document.getElementById('payAmt').value.trim();
  if (!amt || isNaN(amt) || parseFloat(amt) <= 0) {
    alert('Valid amount enter பண்ணுங்க');
    return;
  }
  document.getElementById('payBtn').disabled = true;
  document.getElementById('payBtn').textContent = '⏳ Processing...';
  document.getElementById('modal').classList.add('show');
  document.getElementById('modalBody').innerHTML = '<div class="spinner-modal">⏳ Govt site-ல் submit பண்றோம்...<br>சிறிது நேரம் பொறுங்க (10-20 seconds)</div>';

  fetch('/submit', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ref: REF, amount: amt})
  })
  .then(function(r){ return r.json(); })
  .then(function(d) {
    if (d.success) {
      var html = '<div style="color:#2a7a2a;font-size:16px;font-weight:bold;margin-bottom:14px">✅ Payment Initiated!</div>';
      if (d.ownerName) html += '<div class="confirm-field"><span>Owner</span><span>'+d.ownerName+'</span></div>';
      if (d.assessmentNo) html += '<div class="confirm-field"><span>Assessment No</span><span>'+d.assessmentNo+'</span></div>';
      if (d.totalAmount) html += '<div class="confirm-field"><span>Amount</span><span style="color:#1b5e20;font-size:16px">₹'+d.totalAmount+'</span></div>';
      html += '<br><div style="font-size:13px;color:#555">Captcha-வை govt site-ல் enter பண்ணி Confirm பண்ணுங்க</div>';
      if (d.screenshot) html += '<img src="data:image/png;base64,'+d.screenshot+'" />';
      html += '<br><button class="close-btn" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">Close</button>';
      document.getElementById('modalBody').innerHTML = html;
    } else {
      document.getElementById('modalBody').innerHTML = '<div style="color:#c00">❌ Error: '+(d.error||'Unknown')+'</div><br><button class="close-btn" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">Close</button>';
    }
    document.getElementById('payBtn').disabled = false;
    document.getElementById('payBtn').textContent = '💳 Pay Now';
  })
  .catch(function(e) {
    document.getElementById('modalBody').innerHTML = '<div style="color:#c00">❌ '+e.message+'</div><br><button class="close-btn" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">Close</button>';
    document.getElementById('payBtn').disabled = false;
    document.getElementById('payBtn').textContent = '💳 Pay Now';
  });
}
</script>
</body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head>
<body style="font-family:Arial;padding:40px;text-align:center">
<h2 style="color:#c00">❌ Error</h2><p>${msg}</p>
<a href="/" style="color:#2e7d32">← Back to Home</a>
</body></html>`;
}

server.listen(PORT, () => {
  console.log('\n✅ TN Property Tax (Puppeteer) → http://localhost:' + PORT);
});
