const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 3000;
const GOVT = 'tnurbanepay.tn.gov.in';

function httpsReq(method, path, postData, reqHeaders) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: GOVT, port: 443, path, method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...reqHeaders
      }
    };
    if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), headers: res.headers, status: res.statusCode }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function ef(html, id) {
  for (const pat of [
    new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i'),
    new RegExp(`name=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i'),
  ]) { const m = html.match(pat); if (m) return m[1]; }
  return '';
}
function es(html, id) {
  const m = html.match(new RegExp(`id=["']${id}["'][^>]*>([^<]*)`, 'i'));
  return m ? m[1].trim() : '';
}
function parseAjaxFields(ajax) {
  const fields = {};
  const re = /(\d+)\|hiddenField\|([^|]+)\|/g;
  let m;
  while ((m = re.exec(ajax)) !== null) {
    fields[m[2]] = ajax.substring(m.index + m[0].length, m.index + m[0].length + parseInt(m[1]));
  }
  return fields;
}

// ─── SERVER ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ── /view/:ref ── redirect to actual govt site with auto-fill page ────────
  if (req.method === 'GET' && pathname.startsWith('/view/')) {
    const ref = decodeURIComponent(pathname.slice(6));
    console.log('VIEW:', ref);

    // Serve a page that:
    // 1. Opens actual govt site in same tab
    // 2. Passes ref via sessionStorage (same origin won't work cross-domain)
    // Solution: serve an intermediate page that redirects to govt site
    // with the ref in the URL fragment, and a bookmarklet-style approach
    
    // The ONLY way without extension: 
    // Open govt site URL directly, user manually types ref
    // OR: use our lookup page to show details, link to govt site
    
    const safeRef = JSON.stringify(ref);
    const encodedRef = encodeURIComponent(ref);
    
    // Serve redirect page that goes to actual govt site
    // We show a loading page, then redirect browser to govt site
    // Govt site opens fresh in browser with its own session
    // We can't auto-fill without extension
    // BUT: we can show an intermediate "copy & paste" helper page
    
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>TN Property Tax — ${ref}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f0f8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:480px;width:100%;overflow:hidden}
.header{background:#2e7d32;color:#fff;padding:20px 24px;text-align:center}
.header h2{font-size:18px;font-weight:bold;margin-bottom:4px}
.header p{font-size:13px;opacity:.85}
.body{padding:24px}
.ref-box{background:#f1f8e9;border:2px solid #4caf50;border-radius:8px;padding:14px 18px;text-align:center;margin-bottom:20px}
.ref-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.ref-num{font-family:monospace;font-size:22px;font-weight:bold;color:#1b5e20;letter-spacing:.05em}
.copy-btn{display:inline-block;margin-top:8px;background:#e8f5e9;border:1px solid #4caf50;color:#2e7d32;padding:4px 14px;border-radius:20px;font-size:12px;cursor:pointer;border:none}
.copy-btn:active{background:#c8e6c9}
.step{display:flex;gap:12px;margin-bottom:16px;align-items:flex-start}
.step-num{width:28px;height:28px;background:#4caf50;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;flex-shrink:0;margin-top:1px}
.step-text{font-size:13px;color:#333;line-height:1.5}
.step-text strong{color:#1b5e20}
.divider{border:none;border-top:1px solid #eee;margin:16px 0}
.go-btn{display:block;width:100%;background:#4caf50;color:#fff;border:none;padding:14px;font-size:15px;font-weight:bold;border-radius:8px;cursor:pointer;text-decoration:none;text-align:center;margin-top:4px}
.go-btn:hover{background:#388e3c}
.note{font-size:11px;color:#999;text-align:center;margin-top:12px}
.copied{color:#4caf50;font-size:12px;display:none;margin-left:8px}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h2>🏛️ TN Property Tax Payment</h2>
    <p>Commissionerate of Municipal Administration</p>
  </div>
  <div class="body">
    <div class="ref-box">
      <div class="ref-label">Assessment Number</div>
      <div class="ref-num" id="refNum">${ref}</div>
      <button class="copy-btn" onclick="copyRef()">📋 Copy Number</button>
      <span class="copied" id="copiedMsg">✓ Copied!</span>
    </div>
    
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">கீழே <strong>"Open Payment Site"</strong> button click பண்ணுங்க — Govt site திறக்கும்</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text"><strong>Assessment Number</strong> box-ல் paste பண்ணுங்க <span style="font-family:monospace;background:#f5f5f5;padding:1px 6px;border-radius:3px">(Ctrl+V)</span></div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text"><strong>Search</strong> button click → details வரும் → <strong>Submit</strong> → Payment! ✅</div>
    </div>
    
    <hr class="divider">
    
    <a class="go-btn" href="https://tnurbanepay.tn.gov.in/PT_CPPaymentDetails.aspx" target="_blank" onclick="copyRef()">
      🔗 Open Payment Site →
    </a>
    <div class="note">* Button click-ல் number auto-copy ஆகும் — just Ctrl+V paste பண்ணுங்க</div>
  </div>
</div>

<script>
var ref = ${safeRef};

function copyRef() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(ref).then(function() {
      document.getElementById('copiedMsg').style.display = 'inline';
      setTimeout(function(){ document.getElementById('copiedMsg').style.display = 'none'; }, 2000);
    });
  } else {
    var t = document.createElement('textarea');
    t.value = ref; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
    document.getElementById('copiedMsg').style.display = 'inline';
    setTimeout(function(){ document.getElementById('copiedMsg').style.display = 'none'; }, 2000);
  }
}

// Auto copy on page load
window.addEventListener('load', function() {
  copyRef();
});
</script>
</body>
</html>`;

    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }

  // ── /api/:ref — JSON property data ───────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/api/')) {
    const ref = decodeURIComponent(pathname.slice(5));
    console.log('API:', ref);
    try {
      const session = await getSession();
      const sd = await postSearch(ref, session);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(sd));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: e.message}));
    }
    return;
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>TN Property Tax</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial;background:#f0f8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:420px;width:100%;overflow:hidden}
.hdr{background:#2e7d32;color:#fff;padding:20px;text-align:center}
.hdr h2{font-size:18px;margin-bottom:4px}
.hdr p{font-size:12px;opacity:.8}
.body{padding:24px}
label{font-size:12px;color:#555;display:block;margin-bottom:6px}
input{width:100%;border:2px solid #e0e0e0;padding:10px 14px;font-family:monospace;font-size:16px;border-radius:6px;outline:none;transition:.2s}
input:focus{border-color:#4caf50}
button{width:100%;background:#4caf50;color:#fff;border:none;padding:12px;font-size:15px;font-weight:bold;border-radius:6px;cursor:pointer;margin-top:10px}
button:hover{background:#388e3c}
</style></head>
<body><div class="card">
<div class="hdr"><h2>🏛️ TN Property Tax</h2><p>Commissionerate of Municipal Administration</p></div>
<div class="body">
<label>Assessment Number உள்ளிடுங்க</label>
<input type="text" id="r" placeholder="082/001/900540" />
<button onclick="go()">View & Pay →</button>
</div></div>
<script>
function go(){var r=document.getElementById('r').value.trim();if(r)window.location.href='/view/'+encodeURIComponent(r);}
document.getElementById('r').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
</script></body></html>`);
  });
});

async function getSession() {
  const r = await httpsReq('GET', '/PT_CPPaymentDetails.aspx', null, {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1'
  });
  const sc = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  return {
    cookieStr: sc,
    viewstate: ef(r.data.toString('utf8'), '__VIEWSTATE'),
    viewstateGen: ef(r.data.toString('utf8'), '__VIEWSTATEGENERATOR') || 'A4D7941B',
    eventValidation: ef(r.data.toString('utf8'), '__EVENTVALIDATION'),
  };
}

async function postSearch(ref, session) {
  const p = new URLSearchParams();
  p.set('ctl00$ctl31', 'ctl00$PageContent$UpdatePanel4|ctl00$PageContent$btnGetDetails');
  ['ctl00$alert_msg','ctl00$PageContent$hdnref','ctl00$PageContent$totamt_value',
   'ctl00$PageContent$HdPropertyTypeID','ctl00$PageContent$txt_OldNo',
   'ctl00$PageContent$TextBox1','ctl00$PageContent$txt_RemittersName',
   'ctl00$PageContent$txtTransactionAmount','__EVENTTARGET','__EVENTARGUMENT',
   '__LASTFOCUS','__VIEWSTATEENCRYPTED'].forEach(k => p.set(k,''));
  p.set('ctl00$PageContent$rdbulb','0');
  p.set('ctl00$PageContent$txtRefNumber', ref);
  p.set('__VIEWSTATE', session.viewstate);
  p.set('__VIEWSTATEGENERATOR', session.viewstateGen);
  p.set('__EVENTVALIDATION', session.eventValidation);
  p.set('__ASYNCPOST','true');
  p.set('ctl00$PageContent$btnGetDetails','Search');
  const r = await httpsReq('POST', '/PT_CPPaymentDetails.aspx', p.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest',
    'Origin': 'https://'+GOVT, 'Referer': 'https://'+GOVT+'/PT_CPPaymentDetails.aspx',
    'Cookie': session.cookieStr, 'Accept': '*/*',
    'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
  });
  const html = r.data.toString('utf8');
  const fields = parseAjaxFields(html);
  const sp = id => es(html, id);
  const payments = [];
  const payTbl = html.match(/<table[^>]*id="PageContent_gvLastPaymentDet"[^>]*>([\s\S]*?)<\/table>/i);
  if (payTbl) {
    (payTbl[1].match(/<tr(?!.*Gridcolor)[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
      const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[]).map(c=>c.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,'').trim());
      if (cells.length >= 8 && cells[1]) payments.push({receipt:cells[1],assessmentNo:cells[2],oldAssessmentNo:cells[3],receiptDate:cells[4],amount:cells[5],usage:cells[6],status:cells[7]});
    });
  }
  const dues = []; let dueTotal = {};
  const dueTbl = html.match(/<table[^>]*id="PageContent_gvpayment"[^>]*>([\s\S]*?)<\/table>/i);
  if (dueTbl) {
    (dueTbl[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
      if (row.includes('Gridcolor')) return;
      const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[]).map(c=>c.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,'').trim());
      if (cells.length >= 12 && cells[1] && cells[1] !== 'Total')
        dues.push({period:cells[1],taxDemand:cells[2],taxBalance:cells[6],totalBalance:cells[8],cumulativeBalance:cells[11]});
      else if (cells[1]==='Total') dueTotal={taxDemand:cells[2],totalBalance:cells[8]};
    });
  }
  return {
    ref, found: sp('PageContent_alblOwner') !== '',
    ownerName: sp('PageContent_alblOwner'),
    ownerNameTamil: sp('PageContent_alblOwnerintamil'),
    address: sp('PageContent_alblDoorNo')+' '+sp('PageContent_alblStreet1')+', '+sp('PageContent_alborganization')+' '+sp('PageContent_alblPincode'),
    assessmentType: sp('PageContent_lblasstype'),
    zone: sp('PageContent_lblZoneText'), ward: sp('PageContent_lblWardText'),
    usage: sp('PageContent_lblusage'), totalAreaSqft: sp('PageContent_Label21'),
    balanceAmt: sp('PageContent_lbl_balanceamt_view'),
    payableAmt: sp('PageContent_lblpayamt'),
    payments, dues, dueTotal,
  };
}

server.listen(PORT, () => {
  console.log('\n✅ TN Property Tax → http://localhost:' + PORT);
  console.log('  Home:  http://localhost:' + PORT);
  console.log('  View:  http://localhost:' + PORT + '/view/082%2F001%2F900540');
  console.log('  API:   http://localhost:' + PORT + '/api/082%2F001%2F900540');
});
