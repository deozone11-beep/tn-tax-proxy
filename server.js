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
      res.on('end', () => resolve({
        data: Buffer.concat(chunks),
        headers: res.headers,
        status: res.statusCode
      }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Cookie store: proxySessionId → govtCookieString
const cookieStore = {};

function getProxyId(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/tnp_sid=([^;]+)/);
  return m ? m[1] : null;
}
function getGovtCookie(cookieHeader) {
  const pid = getProxyId(cookieHeader);
  return pid ? (cookieStore[pid] || '') : '';
}
function storeGovtCookie(govtCookieStr, existingPid) {
  const pid = existingPid || Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (govtCookieStr) cookieStore[pid] = govtCookieStr;
  return pid;
}

// Merge new govt cookies into stored ones
function mergeSetCookies(setCookieArr, existingCookie) {
  const map = {};
  // Parse existing
  if (existingCookie) {
    existingCookie.split(';').map(s => s.trim()).forEach(p => {
      const [k, v] = p.split('=');
      if (k && v !== undefined) map[k.trim()] = v.trim();
    });
  }
  // Override with new
  (setCookieArr || []).forEach(c => {
    const part = c.split(';')[0].trim();
    const [k, v] = part.split('=');
    if (k && v !== undefined) map[k.trim()] = v.trim();
  });
  return Object.entries(map).map(([k,v]) => k + '=' + v).join('; ');
}

// Rewrite HTML — fix URLs to go through our proxy
function rewriteHtml(rawHtml, ref, host) {
  let html = rawHtml;
  const base = 'https://' + GOVT;
  const proxyBase = host ? 'http://' + host : '';

  // Fix script/style/image src
  html = html.replace(/\bsrc="(\.\/|(?!https?:\/\/|\/\/|data:))([^"]+)"/g,
    (m, p1, p2) => 'src="' + base + '/' + p2.replace(/^\//, '') + '"');

  // Fix link href (CSS etc) - not navigation links
  html = html.replace(/<link([^>]+)href="(\.\/|(?!https?:\/\/|\/\/|#))([^"]+)"/g,
    (m, attrs, p1, p2) => '<link' + attrs + 'href="' + base + '/' + p2.replace(/^\//, '') + '"');

  // Fix ALL form actions to go through proxy
  html = html.replace(/action="[^"]*PT_CPPaymentDetails\.aspx[^"]*"/gi,
    'action="/proxy-post"');
  html = html.replace(/action="[^"]*ConformationResponce\.aspx[^"]*"/gi,
    'action="/proxy-confirm"');

  // Fix WebResource/ScriptResource axd
  html = html.replace(/src="(\/(WebResource|ScriptResource)\.axd[^"]+)"/g,
    'src="' + base + '$1"');

  // Auto-fill ref and click search
  if (ref) {
    const script = `
<script>
(function(){
  function run(){
    var inp = document.getElementById('PageContent_txtRefNumber');
    if(!inp){ setTimeout(run, 200); return; }
    inp.value = ${JSON.stringify(ref)};
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(function(){
      var btn = document.getElementById('PageContent_btnGetDetails');
      if(btn) btn.click();
    }, 400);
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', run);
  } else { run(); }
})();
</script>`;
    html = html.replace('</body>', script + '</body>');
  }

  return html;
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const reqCookies = req.headers['cookie'] || '';
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ── /view/:ref — open property page with auto-search ─────────────────────
  if (req.method === 'GET' && pathname.startsWith('/view/')) {
    const ref = decodeURIComponent(pathname.slice(6));
    console.log('VIEW:', ref);
    try {
      // Get fresh session from govt
      const gr = await httpsReq('GET', '/PT_CPPaymentDetails.aspx', null, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1'
      });
      const newGovtCookies = mergeSetCookies(gr.headers['set-cookie'] || [], '');
      const pid = storeGovtCookie(newGovtCookies, null);
      const html = rewriteHtml(gr.data.toString('utf8'), ref, req.headers['host']);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'tnp_sid=' + pid + '; Path=/; HttpOnly; SameSite=Lax'
      });
      res.end(html);
    } catch(e) {
      console.error('VIEW error:', e.message);
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('<h2>Error: ' + e.message + '</h2>');
    }
    return;
  }

  // ── /proxy-post — proxy all POSTs to PT_CPPaymentDetails.aspx ────────────
  if (req.method === 'POST' && (pathname === '/proxy-post' || pathname === '/proxy-confirm')) {
    const govtPath = pathname === '/proxy-confirm'
      ? '/ConformationResponce.aspx'
      : '/PT_CPPaymentDetails.aspx';
    const govtCookie = getGovtCookie(reqCookies);
    const existingPid = getProxyId(reqCookies);
    let body = Buffer.alloc(0);
    req.on('data', c => { body = Buffer.concat([body, c]); });
    req.on('end', async () => {
      console.log('POST', govtPath, 'len:', body.length, 'cookie:', govtCookie.substring(0,40));
      try {
        const isAjax = (req.headers['x-microsoftajax'] || '').includes('Delta');
        const gr = await httpsReq('POST', govtPath, body, {
          'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': govtCookie,
          'Origin': 'https://' + GOVT,
          'Referer': 'https://' + GOVT + '/PT_CPPaymentDetails.aspx',
          'Accept': req.headers['accept'] || '*/*',
          'X-MicrosoftAjax': req.headers['x-microsoftajax'] || '',
          'X-Requested-With': req.headers['x-requested-with'] || '',
          'Sec-Fetch-Dest': isAjax ? 'empty' : 'document',
          'Sec-Fetch-Mode': isAjax ? 'cors' : 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': isAjax ? '' : '1',
        });

        // Update stored cookies
        const newGovtCookies = mergeSetCookies(gr.headers['set-cookie'] || [], govtCookie);
        const pid = storeGovtCookie(newGovtCookies, existingPid);

        const responseText = gr.data.toString('utf8');
        const ct = gr.headers['content-type'] || '';

        // Check for redirect in AJAX response
        if (isAjax && responseText.includes('pageRedirect')) {
          const redirMatch = responseText.match(/pageRedirect\|\|([^|]+)\|/);
          if (redirMatch) {
            const redirUrl = decodeURIComponent(redirMatch[1]);
            const govtRelPath = redirUrl.replace('https://' + GOVT, '');
            // Proxy the redirect destination
            const rr = await httpsReq('GET', govtRelPath, null, {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Cookie': newGovtCookies,
              'Referer': 'https://' + GOVT + '/PT_CPPaymentDetails.aspx',
              'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'same-origin', 'Upgrade-Insecure-Requests': '1'
            });
            const finalCookies = mergeSetCookies(rr.headers['set-cookie'] || [], newGovtCookies);
            storeGovtCookie(finalCookies, pid);
            const finalHtml = rewriteHtml(rr.data.toString('utf8'), null, req.headers['host']);
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Set-Cookie': 'tnp_sid=' + pid + '; Path=/; HttpOnly; SameSite=Lax'
            });
            res.end(finalHtml);
            return;
          }
        }

        // HTML response
        if (ct.includes('text/html')) {
          const finalHtml = rewriteHtml(responseText, null, req.headers['host']);
          res.writeHead(gr.status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': 'tnp_sid=' + pid + '; Path=/; HttpOnly; SameSite=Lax'
          });
          res.end(finalHtml);
          return;
        }

        // AJAX / plain text — pass through as-is
        res.writeHead(gr.status, {
          'Content-Type': ct,
          'Set-Cookie': 'tnp_sid=' + pid + '; Path=/; HttpOnly; SameSite=Lax'
        });
        res.end(gr.data);
      } catch(e) {
        console.error('POST error:', e.message);
        res.writeHead(500, {'Content-Type': 'text/html'});
        res.end('<h2>Error: ' + e.message + '</h2>');
      }
    });
    return;
  }

  // ── Proxy static assets ───────────────────────────────────────────────────
  if (req.method === 'GET' && (
    pathname.endsWith('.css') || pathname.endsWith('.js') ||
    pathname.endsWith('.png') || pathname.endsWith('.jpg') ||
    pathname.endsWith('.gif') || pathname.endsWith('.ico') ||
    pathname.includes('.axd') || pathname.includes('GenerateCaptcha')
  )) {
    const govtCookie = getGovtCookie(reqCookies);
    try {
      const gr = await httpsReq('GET', pathname + (url.search || ''), null, {
        'Accept': '*/*',
        'Cookie': govtCookie,
        'Referer': 'https://' + GOVT + '/'
      });
      const ct = gr.headers['content-type'] || 'application/octet-stream';
      res.writeHead(gr.status, {
        'Content-Type': ct,
        'Cache-Control': pathname.includes('Captcha') ? 'no-store' : 'public,max-age=300'
      });
      res.end(gr.data);
    } catch(e) { res.writeHead(404); res.end(''); }
    return;
  }

  // ── Home page ─────────────────────────────────────────────────────────────
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>TN Property Tax Lookup</title>
<style>
body{font-family:Arial;background:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border:2px solid #4caf50;border-radius:8px;padding:32px;max-width:420px;width:90%;text-align:center}
h2{color:#2a7a2a;margin:0 0 8px}p{color:#555;font-size:13px;margin:6px 0}
input{width:100%;border:1px solid #aaa;padding:9px 12px;font-family:monospace;font-size:15px;border-radius:4px;box-sizing:border-box;margin:10px 0}
button{width:100%;background:#4caf50;color:#fff;border:none;padding:10px;font-size:14px;font-weight:bold;border-radius:4px;cursor:pointer}
button:hover{background:#388e3c}
</style></head>
<body><div class="box">
<h2>🏛️ TN Property Tax</h2>
<p>Assessment Number உள்ளிடுங்க</p>
<input type="text" id="ref" placeholder="082/001/900540" />
<button onclick="go()">🔍 View & Pay</button>
</div>
<script>
function go(){
  var r=document.getElementById('ref').value.trim();
  if(r) window.location.href='/view/'+encodeURIComponent(r);
}
document.getElementById('ref').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
</script></body></html>`);
  });
});

server.listen(PORT, () => {
  console.log('\n✅ TN Property Tax Proxy → http://localhost:' + PORT);
  console.log('  Home:  http://localhost:' + PORT);
  console.log('  View:  http://localhost:' + PORT + '/view/082%2F001%2F900540');
});
