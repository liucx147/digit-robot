const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm', '.css':'text/css', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.wav':'audio/wav' };

// One local resource server and Chrome configuration for the three public suites.
async function publicBrowser(webRoot) {
  const server = http.createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(webRoot, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(webRoot + path.sep)) throw Error('invalid path');
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const close = async () => { try { await browser?.close(); } finally { await new Promise(resolve => server.close(resolve)); } };
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless:true, args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
    return { browser, baseURL:`http://127.0.0.1:${server.address().port}`, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { publicBrowser };
