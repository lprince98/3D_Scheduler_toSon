// 보너스: 기준 시각 전에 오늘 할 일을 다 하면 뼈 1개 더 (쌓인 뼈로 이어서 바위가 나옴). 기준 시각이 지났으면 없음
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/vibrate/.test(m.text())) errs.push(m.text()); });
  const ev = (f, a) => p.evaluate(f, a);
  await p.goto('http://localhost:8765/index.html#test'); await p.waitForTimeout(400);
  const tapRock = async () => { for (let i = 0; i < 6; i++) { const r = await ev(() => { const s = __dino.toScreen(__dino.ROCK_POS); return [s.x, s.y]; }); await p.mouse.click(r[0], r[1]); await p.waitForTimeout(250); } };
  for (const [label, bonusMin] of [['기준 전(24:00)', 24 * 60], ['기준 지남(17:00)', 17 * 60]]) {
    await ev(bonusMin => {
      const d = new Date(), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const st = { version: 1, settings: { bonus: true, bonusMin }, dino: { kind: 'trex', placed: 2, chosen: true, giftGiven: true }, weekly: {},
        days: { [k]: { missions: [{ id: 'd1', sid: 'brush', status: 'done', doneAt: Date.now() }, { id: 'd2', sid: 'book', status: 'todo' }], cheered: false } } };
      for (let i = 0; i < 7; i++) st.weekly[i] = [{ sid: 'brush' }, { sid: 'book' }];
      localStorage.setItem('dinoPlanner', JSON.stringify(st));
    }, bonusMin);
    await p.reload(); await p.waitForTimeout(1500);
    await p.click('.card:not(.done) .go', { force: true }); await p.waitForTimeout(1500);
    await p.click('#dDone', { force: true }); await p.waitForTimeout(1500);
    const after = await ev(() => { const s = __dino.state(), k = Object.keys(s.days).pop(); return { phase: __dino.phase(), pending: s.dino.pending, bonus: !!s.days[k].bonus }; });
    await tapRock(); await p.waitForTimeout(8000);   // 자동 붙이기(5초)
    const second = await ev(() => ({ phase: __dino.phase(), placed: __dino.state().dino.placed, pending: __dino.state().dino.pending }));
    if (second.phase === 'rock') { await tapRock(); await p.waitForTimeout(8000); }
    const end = await ev(() => ({ phase: __dino.phase(), placed: __dino.state().dino.placed, pending: __dino.state().dino.pending }));
    console.log(label, '완료 직후', JSON.stringify(after), '| 뼈 1개 뒤', JSON.stringify(second), '| 끝', JSON.stringify(end));
  }
  console.log('errors', errs);
  await b.close();
})();
