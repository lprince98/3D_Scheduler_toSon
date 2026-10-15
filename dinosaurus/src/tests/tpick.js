const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, n] of [[1280, 800, 'l'], [1024, 600, 's'], [800, 1280, 'p']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(400);
    await p.evaluate(() => { const st = { version: 1, dino: { kind: 'trex', placed: 0, chosen: false, giftGiven: true }, weekly: {},
      park: ['trex', 'tricera', 'stego'].map(k => ({ kind: k, name: '', look: null, thumb: '', doneAt: '2026-10-01' })) };
      for (let d = 0; d < 7; d++) st.weekly[d] = [{ sid: 'book' }]; localStorage.setItem('dinoPlanner', JSON.stringify(st)); });
    await p.reload(); await p.waitForTimeout(2500);
    const info = await p.evaluate(() => { const cs = [...document.querySelectorAll('#pkCards .pkc')].map(c => c.getBoundingClientRect()); const ok = document.getElementById('pkOk').getBoundingClientRect();
      return { open: document.getElementById('pick').className, cards: cs.length, stars: document.querySelectorAll('#pkCards .got').length, bottom: Math.round(Math.max(...cs.map(r => r.bottom))), top: Math.round(Math.min(...cs.map(r => r.top))), okBottom: Math.round(ok.bottom) }; });
    console.log(n, w, h, JSON.stringify(info));
    await p.click('#pkCards .pkc:nth-child(4)'); await p.waitForTimeout(300);
    await p.screenshot({ path: `pk_${n}.png` });
    await p.click('#pkOk', { force: true }); await p.waitForTimeout(1200);
    console.log(n, 'chosen:', await p.evaluate(() => window.__dino.state().dino.kind));
    await p.screenshot({ path: `pk_${n}_after.png` });
    console.log(n, 'errors', errs); await p.close();
  }
  await b.close();
})();
