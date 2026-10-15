const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const ev = (f, a) => p.evaluate(f, a);
  const st = () => ev(() => { const d = __dino.state().dino; return { kind: d.kind, awake: d.awake, grow: d.grow, chosen: d.chosen, size: __dino.size(), park: __dino.state().park.length }; });
  await p.goto('http://localhost:8765/index.html#test'); await p.waitForTimeout(400);
  // 1) 새 공룡: 마지막 뼈 → 아기로 깨어남
  await ev(() => { const s = { version: 1, dino: { kind: 'spino', placed: 7, chosen: true, giftGiven: true }, weekly: {} };
    for (let d = 0; d < 7; d++) s.weekly[d] = ['dress', 'meal', 'dress', 'meal', 'dress'].map(sid => ({ sid })); localStorage.setItem('dinoPlanner', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(1500);
  await ev(() => __dino.spawnRock()); await p.waitForTimeout(1200);
  for (let i = 0; i < 6; i++) { const r = await ev(() => { const s = __dino.toScreen(__dino.ROCK_POS); return [s.x, s.y]; }); await p.mouse.click(r[0], r[1]); await p.waitForTimeout(250); }
  await p.waitForTimeout(16000);
  await p.click('#decoOk', { force: true }); await p.waitForTimeout(500); await p.click('.pkc[data-i="0"]'); await p.click('#pkOk', { force: true }); await p.waitForTimeout(3500);
  console.log('awake as baby:', JSON.stringify(await st()), 'growRow:', await ev(() => [document.body.classList.contains('growing'), document.querySelectorAll('#growRow .gs').length, document.querySelectorAll('#growRow .gs.on').length]));
  await p.screenshot({ path: 'g_0baby.png' });
  // 2) 할 일 4번 → 쑥쑥
  for (let i = 1; i <= 5; i++) {
    await p.click('#side .card:not(.done) .go'); await p.waitForTimeout(400);
    await p.click('#dDone', { force: true }); await p.waitForTimeout(i === 5 ? 1500 : 550);
    if (i === 2) await p.screenshot({ path: 'g_mid.png' });
    await p.waitForTimeout(i === 5 ? 1500 : 2600);
    const s = await st(); console.log('task', i, JSON.stringify(s), 'bar on:', await ev(() => document.querySelectorAll('#growRow .gs.on').length), 'picker:', await ev(() => document.getElementById('pick').className));
    if (i === 4) await p.screenshot({ path: 'g_4grown.png' });
  }
  await p.screenshot({ path: 'g_5park.png' });
  // 3) 예전 저장: 깨어난 공룡(grow 없음) = 다 큰 것
  await ev(() => { const s = { version: 1, dino: { kind: 'trex', placed: 8, awake: true, chosen: true, giftGiven: true, name: '쿵쿵이' }, weekly: {} };
    for (let d = 0; d < 7; d++) s.weekly[d] = [{ sid: 'dress' }]; localStorage.setItem('dinoPlanner', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(1500);
  console.log('legacy:', JSON.stringify(await st()), 'bar on:', await ev(() => document.querySelectorAll('#growRow .gs.on').length));
  await p.click('#side .card:not(.done) .go'); await p.waitForTimeout(400); await p.click('#dDone', { force: true }); await p.waitForTimeout(2000);
  console.log('legacy after task:', JSON.stringify(await st()), 'picker:', await ev(() => document.getElementById('pick').className));
  console.log('errors', errs);
  await b.close();
})();
