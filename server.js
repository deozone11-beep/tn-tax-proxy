const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 3000;
const GOVT = 'tnurbanepay.tn.gov.in';

function req(method, path, body, hdrs) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: GOVT, port: 443, path, method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', ...hdrs }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks).toString('utf8'), buf: Buffer.concat(chunks), headers: res.headers, status: res.statusCode }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function reqBuf(method, path, body, hdrs) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: GOVT, port: 443, path, method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', ...hdrs }
    };
    if (body) opts.headers['Content-Length'] = body.length;
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), data: Buffer.concat(chunks).toString('utf8'), headers: res.headers, status: res.statusCode }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function ef(html, id) {
  for (const p of [new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`,'i'), new RegExp(`name=["']${id}["'][^>]*value=["']([^"']*)["']`,'i')]) { const m = html.match(p); if (m) return m[1]; }
  return '';
}
function es(html, id) { const m = html.match(new RegExp(`id=["']${id}["'][^>]*>([^<]*)`, 'i')); return m ? m[1].trim() : ''; }
function parseAjax(ajax) {
  const f = {}; const re = /(\d+)\|hiddenField\|([^|]+)\|/g; let m;
  while ((m = re.exec(ajax)) !== null) f[m[2]] = ajax.substring(m.index + m[0].length, m.index + m[0].length + parseInt(m[1]));
  return f;
}

const store = {}; // sessionKey → { cookieStr, confirmHtml }

async function getSession() {
  const r = await req('GET', '/PT_CPPaymentDetails.aspx', null, {
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1'
  });
  const sc = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  return { cookieStr: sc, vs: ef(r.data,'__VIEWSTATE'), vsg: ef(r.data,'__VIEWSTATEGENERATOR')||'A4D7941B', ev: ef(r.data,'__EVENTVALIDATION') };
}

async function search(ref, s) {
  const p = new URLSearchParams();
  ['ctl00$alert_msg','ctl00$PageContent$hdnref','ctl00$PageContent$totamt_value','ctl00$PageContent$HdPropertyTypeID',
   'ctl00$PageContent$txt_OldNo','ctl00$PageContent$TextBox1','ctl00$PageContent$txt_RemittersName',
   'ctl00$PageContent$txtTransactionAmount','__EVENTTARGET','__EVENTARGUMENT','__LASTFOCUS','__VIEWSTATEENCRYPTED'].forEach(k=>p.set(k,''));
  p.set('ctl00$ctl31','ctl00$PageContent$UpdatePanel4|ctl00$PageContent$btnGetDetails');
  p.set('ctl00$PageContent$rdbulb','0'); p.set('ctl00$PageContent$txtRefNumber',ref);
  p.set('__VIEWSTATE',s.vs); p.set('__VIEWSTATEGENERATOR',s.vsg); p.set('__EVENTVALIDATION',s.ev);
  p.set('__ASYNCPOST','true'); p.set('ctl00$PageContent$btnGetDetails','Search');
  const r = await req('POST', '/PT_CPPaymentDetails.aspx', p.toString(), {
    'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-MicrosoftAjax':'Delta=true','X-Requested-With':'XMLHttpRequest',
    'Origin':'https://'+GOVT,'Referer':'https://'+GOVT+'/PT_CPPaymentDetails.aspx','Cookie':s.cookieStr,
    'Accept':'*/*','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'
  });
  const f = parseAjax(r.data);
  return { html:r.data, hdnref:ef(r.data,'PageContent_hdnref'), totamt:ef(r.data,'PageContent_totamt_value'),
    propTypeId:ef(r.data,'PageContent_HdPropertyTypeID')||'1',
    newVS:f['__VIEWSTATE']||s.vs, newVSG:f['__VIEWSTATEGENERATOR']||s.vsg, newEV:f['__EVENTVALIDATION']||s.ev };
}

async function submit(ref, amount, s, sd) {
  const p = new URLSearchParams();
  ['ctl00$alert_msg','ctl00$PageContent$txt_OldNo','ctl00$PageContent$TextBox1',
   'ctl00$PageContent$txt_RemittersName','__EVENTTARGET','__EVENTARGUMENT','__LASTFOCUS','__VIEWSTATEENCRYPTED'].forEach(k=>p.set(k,''));
  p.set('ctl00$ctl31','ctl00$PageContent$UpdatePanel1|ctl00$PageContent$btnSubmit');
  p.set('ctl00$PageContent$hdnref',sd.hdnref); p.set('ctl00$PageContent$totamt_value',sd.totamt);
  p.set('ctl00$PageContent$HdPropertyTypeID',sd.propTypeId); p.set('ctl00$PageContent$rdbulb','0');
  p.set('ctl00$PageContent$txtRefNumber',ref); p.set('ctl00$PageContent$txtTransactionAmount',String(amount));
  p.set('__VIEWSTATE',sd.newVS); p.set('__VIEWSTATEGENERATOR',sd.newVSG); p.set('__EVENTVALIDATION',sd.newEV);
  p.set('__ASYNCPOST','true'); p.set('ctl00$PageContent$btnSubmit','Submit');
  return req('POST', '/PT_CPPaymentDetails.aspx', p.toString(), {
    'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-MicrosoftAjax':'Delta=true','X-Requested-With':'XMLHttpRequest',
    'Origin':'https://'+GOVT,'Referer':'https://'+GOVT+'/PT_CPPaymentDetails.aspx','Cookie':s.cookieStr,
    'Accept':'*/*','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'
  });
}

function fixHtml(html, sessionKey) {
  const base = 'https://'+GOVT;
  let out = html
    .replace(/src=["']\.\/([^"']+)["']/g,'src="'+base+'/$1"')
    .replace(/href=["']\.\/([^"']+)["']/g,'href="'+base+'/$1"')
    .replace(/src=["'](?!http|data:|\/)([^"']+)["']/g,'src="'+base+'/$1"');
  // Point form to our confirm-submit
  out = out.replace(/action=["'][^"']*ConformationResponce\.aspx[^"']*["']/gi,'action="/confirm-submit"');
  // Proxy captcha
  if (sessionKey) {
    out = out.replace(/src=["'][^"']*GenerateCaptcha\.aspx[^"']*["']/g,'src="/captcha/'+sessionKey+'"');
    out = out.replace(/id="imgCaptcha"[^>]*src="[^"]*"/g,'id="imgCaptcha" src="/captcha/'+sessionKey+'"');
    out = out.replace(/<input[^>]*id="idview"[^>]*>/g,
      '<button type="button" onclick="document.getElementById(\'imgCaptcha\').src=\'/captcha/'+sessionKey+'?r=\'+Date.now()" style="border:2px solid green;border-radius:20px;background:#fff;cursor:pointer;padding:2px 8px;margin-left:4px">&#x1F504;</button>');
  }
  return out;
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin','*');
  if (request.method === 'OPTIONS') { response.writeHead(200); response.end(); return; }
  const u = new URL(request.url, 'http://localhost');
  const p = u.pathname;

  // Captcha proxy
  if (p.startsWith('/captcha/')) {
    const key = p.slice(9);
    const s = store[key];
    if (!s) { response.writeHead(404); response.end('expired'); return; }
    try {
      const r = await reqBuf('GET', '/GenerateCaptcha.aspx?'+Date.now(), null, {
        'Cookie':s.cookieStr,'Referer':'https://'+GOVT+'/ConformationResponce.aspx','Accept':'image/*'
      });
      response.writeHead(200,{'Content-Type':r.headers['content-type']||'image/png','Cache-Control':'no-store'});
      response.end(r.buf);
    } catch(e) { response.writeHead(500); response.end(''); }
    return;
  }

  // GET /view/:ref — auto-search on govt site
  if (request.method === 'GET' && p.startsWith('/view/')) {
    const ref = decodeURIComponent(p.slice(6));
    console.log('\nVIEW:', ref);
    try {
      const s = await getSession();
      const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Loading '+ref+'...</title>'
        +'<style>body{font-family:Arial;text-align:center;padding:80px;background:#f0f8f0}'
        +'.box{background:#fff;border:2px solid #4caf50;border-radius:10px;padding:40px;max-width:400px;margin:auto}'
        +'h2{color:#2a7a2a}.ref{font-family:monospace;font-size:20px;font-weight:bold;background:#f0f0f0;padding:8px 16px;border-radius:4px;display:inline-block;margin:12px 0}'
        +'.sp{width:36px;height:36px;border:3px solid #ddd;border-top-color:#4caf50;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}'
        +'@keyframes spin{to{transform:rotate(360deg)}}</style></head>'
        +'<body><div class="box"><div class="sp"></div><h2>&#x1F3DB; TN Property Tax</h2>'
        +'<div class="ref">'+ref+'</div><p style="color:#555">Loading...</p></div>'
        +'<form id="gf" method="POST" action="https://'+GOVT+'/PT_CPPaymentDetails.aspx" style="display:none">'
        +'<input name="__EVENTTARGET" value=""><input name="__EVENTARGUMENT" value=""><input name="__LASTFOCUS" value="">'
        +'<input name="__VIEWSTATE" value="'+s.vs.replace(/"/g,'&quot;')+'">'
        +'<input name="__VIEWSTATEGENERATOR" value="'+s.vsg+'"><input name="__VIEWSTATEENCRYPTED" value="">'
        +'<input name="__EVENTVALIDATION" value="'+s.ev.replace(/"/g,'&quot;')+'">'
        +'<input name="ctl00$alert_msg" value=""><input name="ctl00$PageContent$hdnref" value="">'
        +'<input name="ctl00$PageContent$totamt_value" value=""><input name="ctl00$PageContent$HdPropertyTypeID" value="">'
        +'<input name="ctl00$PageContent$rdbulb" value="0"><input name="ctl00$PageContent$txtRefNumber" value="'+ref+'">'
        +'<input name="ctl00$PageContent$txt_OldNo" value=""><input name="ctl00$PageContent$TextBox1" value="">'
        +'<input name="ctl00$PageContent$txt_RemittersName" value=""><input name="ctl00$PageContent$txtTransactionAmount" value="">'
        +'<input type="submit" name="ctl00$PageContent$btnGetDetails" value="Search"></form>'
        +'<script>setTimeout(function(){document.getElementById("gf").submit();},600);</script>'
        +'</body></html>';
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      response.end(html);
    } catch(e) { response.writeHead(500,{'Content-Type':'text/html'}); response.end('<h2>'+e.message+'</h2>'); }
    return;
  }

  // GET /pay/:ref?amount=X — submit & show confirmation page
  if (request.method === 'GET' && p.startsWith('/pay/')) {
    const ref = decodeURIComponent(p.slice(5));
    const amount = u.searchParams.get('amount') || '0';
    console.log('\nPAY:', ref, amount);
    try {
      const s = await getSession();
      const sd = await search(ref, s);
      if (!sd.hdnref) throw new Error('Property not found: '+ref);
      const submitR = await submit(ref, amount, s, sd);
      console.log('  Submit:', submitR.status, submitR.data.substring(0,100));
      const confirmR = await req('GET', '/ConformationResponce.aspx', null, {
        'Accept':'text/html,application/xhtml+xml,*/*;q=0.8',
        'Referer':'https://'+GOVT+'/PT_CPPaymentDetails.aspx','Cookie':s.cookieStr,
        'Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'same-origin','Upgrade-Insecure-Requests':'1'
      });
      const sessionKey = (s.cookieStr.match(/ASP\.NET_SessionId=([^;]+)/)||['','x'])[1].substring(0,16);
      store[sessionKey] = s;
      setTimeout(()=>delete store[sessionKey], 15*60*1000);
      const fixed = fixHtml(confirmR.data, sessionKey);
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'tnp='+sessionKey+'; Path=/; HttpOnly; SameSite=Lax'});
      response.end(fixed);
    } catch(e) { console.error(e.message); response.writeHead(500,{'Content-Type':'text/html'}); response.end('<h2>'+e.message+'</h2><a href="/">Back</a>'); }
    return;
  }

  // POST /confirm-submit — forward Confirm button POST to govt with stored session
  if (request.method === 'POST' && p === '/confirm-submit') {
    const chunks = [];
    request.on('data', c => chunks.push(Buffer.from(c)));
    request.on('end', async () => {
      const body = Buffer.concat(chunks);
      const ck = request.headers['cookie'] || '';
      const km = ck.match(/tnp=([^;]+)/);
      const s = km ? store[km[1]] : null;
      if (!s) { response.writeHead(400,'text/html'); response.end('<h2>Session expired. <a href="/">Try again</a></h2>'); return; }
      console.log('\nCONFIRM-SUBMIT session:', s.cookieStr.substring(0,60));
      try {
        const r = await reqBuf('POST', '/ConformationResponce.aspx', body, {
          'Content-Type': request.headers['content-type']||'application/x-www-form-urlencoded',
          'Cookie': s.cookieStr,
          'Origin': 'https://'+GOVT,
          'Referer': 'https://'+GOVT+'/ConformationResponce.aspx',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'same-origin','Upgrade-Insecure-Requests':'1'
        });
        console.log('  Confirm status:', r.status, 'Location:', r.headers['location']||'none');
        if ((r.status===302||r.status===301) && r.headers['location']) {
          // BillDesk or external payment redirect — send browser there
          response.writeHead(302,{'Location': r.headers['location']});
          response.end();
          return;
        }
        const html = fixHtml(r.data, null);
        response.writeHead(r.status,{'Content-Type':'text/html; charset=utf-8'});
        response.end(html);
      } catch(e) { console.error(e); response.writeHead(500); response.end(e.message); }
    });
    return;
  }

  // Home
  const b = [];
  request.on('data', c => b.push(c));
  request.on('end', () => {
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TN Property Tax</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial;background:#1b5e20;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:12px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.3)}
.hdr{background:#2e7d32;padding:20px;text-align:center;color:#fff}.hdr h1{font-size:18px;margin-bottom:4px}.hdr p{font-size:12px;opacity:.8}
.body{padding:24px}label{font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:8px}
input{width:100%;border:2px solid #e0e0e0;padding:12px;font-family:monospace;font-size:16px;border-radius:8px;outline:none}input:focus{border-color:#4caf50}
.btn{width:100%;background:#2e7d32;color:#fff;border:none;padding:13px;font-size:15px;font-weight:bold;border-radius:8px;cursor:pointer;margin-top:10px}.btn:hover{background:#1b5e20}</style></head>
<body><div class="card"><div class="hdr"><h1>&#x1F3DB; TN Property Tax</h1><p>Commissionerate of Municipal Administration</p></div>
<div class="body"><label>Assessment Number</label><input type="text" id="r" placeholder="082/001/900540"/>
<button class="btn" onclick="go()">View &amp; Pay &#x2192;</button></div></div>
<script>function go(){var r=document.getElementById('r').value.trim();if(r)window.location.href='/view/'+encodeURIComponent(r);}
document.getElementById('r').addEventListener('keydown',function(e){if(e.key==='Enter')go();});</script></body></html>`);
  });
});

server.listen(PORT, () => {
  console.log('\n✅ TN Property Tax → http://localhost:' + PORT);
  console.log('  /view/082%2F001%2F900540  — view property');
  console.log('  /pay/082%2F001%2F900540?amount=1011  — payment page');
});
