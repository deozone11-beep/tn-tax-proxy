const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 3000;
const GOVT = 'tnurbanepay.tn.gov.in';

// Generic HTTPS request
function httpsReq(method, path, postData, headers) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: GOVT, port: 443, path, method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
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

// Same as httpsReq but does NOT follow redirects
function httpsReqNoRedirect(method, path, postData, reqHeaders) {
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

// Session cache per browser cookie
const sessions = {};

async function getGovtSession(browserCookie) {
  const r = await httpsReq('GET', '/PT_CPPaymentDetails.aspx', null, {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1',
    ...(browserCookie ? {'Cookie': browserCookie} : {})
  });
  const html = r.data.toString('utf8');
  const setCookie = r.headers['set-cookie'] || [];
  const cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
  const sessionId = (cookieStr.match(/ASP\.NET_SessionId=([^;]+)/) || [])[1] || '';
  const antiXsrf  = (cookieStr.match(/__AntiXsrfToken=([^;]+)/)   || [])[1] || '';
  return {
    sessionId, antiXsrf,
    cookieStr: cookieStr || browserCookie || '',
    setCookieHeaders: setCookie,
    viewstate:       ef(html, '__VIEWSTATE'),
    viewstateGen:    ef(html, '__VIEWSTATEGENERATOR') || 'A4D7941B',
    eventValidation: ef(html, '__EVENTVALIDATION'),
    html
  };
}

// Rewrite HTML for proxy: fix URLs, strip CSP, fix form actions
function rewriteHtml(html, refToAutoSearch) {
  let out = html
    // Fix asset URLs
    .replace(/src="(?!http|data:|\/\/)(\.\/)?/g, 'src="https://' + GOVT + '/')
    .replace(/href="(?!http|#|javascript|data:|\/\/)(\.\/)?(?!PT_CP)/g, 'href="https://' + GOVT + '/')
    // Fix form action to point back to our proxy
    .replace(/action="(?:\.\/)?PT_CPPaymentDetails\.aspx"/g, 'action="/pt"')
    .replace(/action="(?:\.\/)?ConformationResponce\.aspx"/g, 'action="/confirm"');

  // Auto-fill and search if ref provided
  if (refToAutoSearch) {
    const autoFill = '<script>'
      + 'window.addEventListener("load",function(){'
      + '  var inp = document.getElementById("PageContent_txtRefNumber");'
      + '  if(inp){ inp.value=' + JSON.stringify(refToAutoSearch) + '; }'
      + '  var btn = document.getElementById("PageContent_btnGetDetails");'
      + '  if(btn){ setTimeout(function(){ btn.click(); },300); }'
      + '});'
      + '</script>';
    out = out.replace('</head>', autoFill + '</head>');
  }

  return out;
}

// Cookie jar per session
const cookieJar = {};

function getProxyCookie(req) {
  const c = req.headers['cookie'] || '';
  const m = c.match(/tn_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function buildSetCookie(govtCookieStr, sessionId) {
  // Store govt cookie mapped to a proxy session id
  const proxyId = sessionId || Math.random().toString(36).slice(2);
  cookieJar[proxyId] = govtCookieStr;
  return { proxyId, setCookie: 'tn_sid=' + encodeURIComponent(proxyId) + '; Path=/; HttpOnly' };
}

function getGovtCookie(req) {
  const proxyId = getProxyCookie(req);
  return proxyId ? (cookieJar[proxyId] || '') : '';
}

// ─── SERVER ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ── /view/:ref  → load PT page with auto-search ──────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/view/')) {
    const ref = decodeURIComponent(pathname.replace('/view/', ''));
    console.log('\n=== VIEW:', ref);
    try {
      const govtCookie = getGovtCookie(req);
      const session = await getGovtSession(govtCookie);
      // Store session cookie for subsequent requests
      const { proxyId, setCookie } = buildSetCookie(session.cookieStr, null);
      cookieJar[proxyId] = session.cookieStr;
      const html = rewriteHtml(session.html, ref);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': setCookie
      });
      res.end(html);
    } catch(e) {
      console.error(e.message);
      res.writeHead(500, {'Content-Type':'text/html'});
      res.end('<h2>Error: ' + e.message + '</h2>');
    }
    return;
  }

  // ── /pt  → proxy PT_CPPaymentDetails.aspx POST ───────────────────────────
  if (pathname === '/pt' || pathname === '/confirm') {
    let body = Buffer.alloc(0);
    req.on('data', c => { body = Buffer.concat([body, c]); });
    req.on('end', async () => {
      const govtPath = pathname === '/confirm' ? '/ConformationResponce.aspx' : '/PT_CPPaymentDetails.aspx';
      const govtCookie = getGovtCookie(req);
      console.log('Proxy POST:', govtPath, 'cookie:', govtCookie.substring(0,30));
      try {
        // Use followRedirects=false so we can handle 302 → BillDesk redirect
        const r = await httpsReqNoRedirect(req.method, govtPath, body, {
          'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
          'Cookie': govtCookie,
          'Origin': 'https://' + GOVT,
          'Referer': 'https://' + GOVT + (pathname === '/confirm' ? '/ConformationResponce.aspx' : '/PT_CPPaymentDetails.aspx'),
          'X-MicrosoftAjax': req.headers['x-microsoftajax'] || '',
          'X-Requested-With': req.headers['x-requested-with'] || '',
          'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': '1',
        });

        // Update stored cookie
        const newCookies = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        if (newCookies) {
          const proxyId = getProxyCookie(req);
          if (proxyId) cookieJar[proxyId] = mergeSetCookies(r.headers['set-cookie'] || [], govtCookie);
        }

        // 302 redirect → could be BillDesk or another page
        if (r.status === 302 || r.status === 301) {
          const location = r.headers['location'] || '';
          console.log('Redirect to:', location);
          if (location.includes('billdesk.com') || location.includes('pay.') || location.startsWith('http')) {
            // External redirect (BillDesk) — send browser directly there
            res.writeHead(302, { 'Location': location });
            res.end();
          } else {
            // Internal redirect — proxy it
            res.writeHead(302, { 'Location': location });
            res.end();
          }
          return;
        }

        const ct = r.headers['content-type'] || '';
        const responseText = r.data.toString('utf8');

        if (ct.includes('text/html')) {
          const html = rewriteHtml(responseText, null);
          res.writeHead(r.status, {'Content-Type': 'text/html; charset=utf-8'});
          res.end(html);
        } else {
          res.writeHead(r.status, {'Content-Type': ct});
          res.end(r.data);
        }
      } catch(e) {
        console.error(e.message);
        res.writeHead(500); res.end('Proxy error: ' + e.message);
      }
    });
    return;
  }

  // ── /fetch-property  → JSON API for lookup tool ──────────────────────────
  if (req.method === 'POST' && pathname === '/fetch-property') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let ref;
      try { ref = JSON.parse(body).ref; } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:'Send: {"ref":"082/001/900540"}'})); return; }
      try {
        const session = await getGovtSession('');
        const p = new URLSearchParams();
        p.set('ctl00$ctl31', 'ctl00$PageContent$UpdatePanel4|ctl00$PageContent$btnGetDetails');
        ['ctl00$alert_msg','ctl00$PageContent$hdnref','ctl00$PageContent$totamt_value',
         'ctl00$PageContent$HdPropertyTypeID','ctl00$PageContent$txt_OldNo',
         'ctl00$PageContent$TextBox1','ctl00$PageContent$txt_RemittersName',
         'ctl00$PageContent$txtTransactionAmount','__EVENTTARGET','__EVENTARGUMENT','__LASTFOCUS',
         '__VIEWSTATEENCRYPTED'].forEach(k => p.set(k, ''));
        p.set('ctl00$PageContent$rdbulb', '0');
        p.set('ctl00$PageContent$txtRefNumber', ref);
        p.set('__VIEWSTATE', session.viewstate);
        p.set('__VIEWSTATEGENERATOR', session.viewstateGen);
        p.set('__EVENTVALIDATION', session.eventValidation);
        p.set('__ASYNCPOST', 'true');
        p.set('ctl00$PageContent$btnGetDetails', 'Search');
        const sr = await httpsReq('POST', '/PT_CPPaymentDetails.aspx', p.toString(), {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://' + GOVT, 'Referer': 'https://' + GOVT + '/PT_CPPaymentDetails.aspx',
          'Cookie': session.cookieStr, 'Accept': '*/*',
          'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
        });
        const html = sr.data.toString('utf8');
        const fields = parseAjaxFields(html);
        const sp = id => es(html, id);
        const hdnref = ef(html, 'PageContent_hdnref');
        const payableAmt = sp('PageContent_lblpayamt');
        const ownerName = sp('PageContent_alblOwner');
        const encoded = encodeURIComponent(ref);
        const result = {
          ref, found: ownerName !== '',
          assessee: {
            ownerName, ownerNameTamil: sp('PageContent_alblOwnerintamil'),
            assessmentNo: sp('PageContent_alblAssesmentnoText'),
            oldAssessmentNo: sp('PageContent_alblOldAssesmentnoText'),
            doorNo: sp('PageContent_alblDoorNo'), street: sp('PageContent_alblStreet1'),
            city: sp('PageContent_alborganization'), pincode: sp('PageContent_alblPincode'),
            doorNoTamil: sp('PageContent_alblDoorNot'), streetTamil: sp('PageContent_alblStreet1ll'),
            cityTamil: sp('PageContent_alborganizationLL'), pincodeTamil: sp('PageContent_alblPincodell'),
            assessmentType: sp('PageContent_lblasstype'), zone: sp('PageContent_lblZoneText'),
            ward: sp('PageContent_lblWardText'), annualRentalValue: sp('PageContent_albl_netannualvalue'),
            halfYearlyTax: sp('PageContent_albl_halfyeartax'), assessmentStatus: sp('PageContent_lblflag'),
            usage: sp('PageContent_lblusage'), totalAreaSqft: sp('PageContent_Label21'),
          },
          balanceAmt: sp('PageContent_lbl_balanceamt_view'),
          advanceAmt: sp('PageContent_lbl_advanceamt_view'),
          payableAmt,
          payments: [],
          dues: [],
          dueTotal: {},
          _urls: {
            view: 'http://localhost:' + PORT + '/view/' + encoded,
          }
        };
        // Parse last payments
        const payTbl = html.match(/<table[^>]*id="PageContent_gvLastPaymentDet"[^>]*>([\s\S]*?)<\/table>/i);
        if (payTbl) {
          (payTbl[1].match(/<tr(?!.*Gridcolor)[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
            const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[]).map(c=>c.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,'').trim());
            if (cells.length >= 8 && cells[1]) result.payments.push({sno:cells[0],receipt:cells[1],assessmentNo:cells[2],oldAssessmentNo:cells[3],receiptDate:cells[4],amount:cells[5],usage:cells[6],status:cells[7]});
          });
        }
        // Parse dues
        const dueTbl = html.match(/<table[^>]*id="PageContent_gvpayment"[^>]*>([\s\S]*?)<\/table>/i);
        if (dueTbl) {
          (dueTbl[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)||[]).forEach(row => {
            if (row.includes('Gridcolor')) return;
            const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi)||[]).map(c=>c.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,'').trim());
            if (cells.length >= 12 && cells[1] && cells[1] !== 'Total')
              result.dues.push({sno:cells[0],period:cells[1],taxDemand:cells[2],penaltyDemand:cells[3],taxCollected:cells[4],penaltyCollected:cells[5],taxBalance:cells[6],balancePenalty:cells[7],totalBalance:cells[8],delayPenalty:cells[9],incentive:cells[10],cumulativeBalance:cells[11]});
            else if (cells[1]==='Total') result.dueTotal={taxDemand:cells[2],penaltyDemand:cells[3],taxCollected:cells[4],penaltyCollected:cells[5],taxBalance:cells[6],balancePenalty:cells[7],totalBalance:cells[8]};
          });
        }
        console.log('✓ Owner:"' + ownerName + '" payable:' + payableAmt);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify(result));
      } catch(e) { console.error(e.message); res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  // ── Proxy all other govt assets (CSS, JS, images) ────────────────────────
  if (pathname.match(/\.(css|js|png|jpg|gif|ico|axd|aspx)/) && !pathname.startsWith('/view') && !pathname.startsWith('/fetch')) {
    const govtCookie = getGovtCookie(req);
    try {
      const r = await httpsReq('GET', pathname + (url.search || ''), null, {
        'Accept': '*/*',
        'Cookie': govtCookie,
        'Referer': 'https://' + GOVT + '/',
      });
      const ct = r.headers['content-type'] || 'application/octet-stream';
      res.writeHead(r.status, {'Content-Type': ct, 'Cache-Control': 'public, max-age=60'});
      res.end(r.data);
    } catch(e) { res.writeHead(404); res.end(''); }
    return;
  }

  // ── Default ───────────────────────────────────────────────────────────────
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end('<html><body style="font-family:Arial;padding:40px">'
      + '<h2>TN Property Tax Proxy</h2><ul>'
      + '<li><a href="/view/082%2F001%2F900540">/view/082%2F001%2F900540</a> — Property page</li>'
      + '<li>POST /fetch-property {"ref":"082/001/900540"} — JSON data</li>'
      + '</ul></body></html>');
  });
});

server.listen(PORT, () => {
  console.log('\n✅ TN Property Tax Reverse Proxy → http://localhost:' + PORT);
  console.log('  View: http://localhost:' + PORT + '/view/082%2F001%2F900540');
});
