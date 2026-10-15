const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const ev = (f, a) => p.evaluate(f, a);
  await p.goto('http://localhost:8765/index.html#test'); await p.waitForTimeout(400);
  for (const k of ['brachio', 'ankylo', 'spino']) {
    await ev(k => { const st = { version: 1, dino: { kind: k, placed: 7, chosen: true, giftGiven: true }, weekly: {} }; for (let d = 0; d < 7; d++) st.weekly[d] = [{ sid: 'book' }]; localStorage.setItem('dinoPlanner', JSON.stringify(st)); }, k);
    await p.reload(); await p.waitForTimeout(1500);
    // 마지막 뼈: 바위 → 톡톡톡 → 저절로 붙음 → 깨어남
    await ev(() => __dino.spawnRock()); await p.waitForTimeout(1200);
    for (let i = 0; i < 6; i++) { const r = await ev(() => { const s = __dino.toScreen(__dino.ROCK_POS); return [s.x, s.y]; }); await p.mouse.click(r[0], r[1]); await p.waitForTimeout(250); }
    await p.waitForTimeout(16000);   // 자동 붙이기(5초) + 깨어남 연출
    const deco = await ev(() => document.body.classList.contains('decoOn'));
    await p.screenshot({ path: `fl_${k}_deco.png` });
    if (deco) { await p.click('#decoOk', { force: true }); await p.waitForTimeout(500); await p.click('.pkc[data-i="1"]'); await p.click('#pkOk', { force: true }); await p.waitForTimeout(1500); }
    const d = await ev(() => { const s = __dino.state().dino; return { kind: s.kind, placed: s.placed, awake: s.awake, name: s.name, thumb: (s.thumb || '').length }; });
    console.log(k, 'deco shown:', deco, JSON.stringify(d));
    await p.screenshot({ path: `fl_${k}_awake.png` });
  }
  // 공원에 새 공룡 칸이 있는지
  await p.click('#parkBtn'); await p.waitForTimeout(500);
  console.log('park cells:', await ev(() => [document.querySelectorAll('#parkGrid .pc').length, document.querySelectorAll('#parkGrid .pc.unknown').length]));
  await p.screenshot({ path: 'fl_park.png' });
  console.log('errors', errs);
  await b.close();
})();
