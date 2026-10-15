const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(400);
  for (const k of ['brachio', 'ankylo', 'spino']) {
    for (const [awake, placed, tag] of [[true, 8, 'skin'], [false, 5, 'bone']]) {
      await p.evaluate(([k, awake, placed]) => { const st = { version: 1, dino: { kind: k, placed, awake, chosen: true, giftGiven: true }, weekly: {} }; for (let d = 0; d < 7; d++) st.weekly[d] = [{ sid: 'book' }, { sid: 'draw' }]; localStorage.setItem('dinoPlanner', JSON.stringify(st)); }, [k, awake, placed]);
      await p.reload(); await p.waitForTimeout(1300);
      await p.screenshot({ path: `nd_${k}_${tag}.png`, clip: { x: 0, y: 0, width: 980, height: 800 } });
    }
  }
  console.log(JSON.stringify(await p.evaluate(() => window.__dino.tris())));
  console.log('errors', errs);
  await b.close();
})();
