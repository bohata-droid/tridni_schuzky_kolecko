(async () => {
  const results = [];
  const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
  const makeModel = (rows, width = 6) => ({
    title: 'Test', fixedHeader: ['Class', 'Room', 'Teacher'],
    headerRow: ['Class', 'Room', 'Teacher', ...Array.from({ length: width }, (_, i) => String(i))],
    timelineCols: Array.from({ length: width }, (_, i) => i + 3), maxCols: width + 3,
    rowData: rows.map((meetings, r) => {
      let col = 3;
      const cards = meetings.map(([name, span = 1, locked = false], c) => {
        const card = { id: `r${r}-card${c}`, rowId: `row${r}`, rowIndex: r + 2, name, span, locked, startCol: col };
        col += span;
        return card;
      });
      while (col < width + 3) cards.push({ id: `r${r}-empty${col}`, rowId: `row${r}`, rowIndex: r + 2, name: '', span: 1, startCol: col++ });
      return { id: `row${r}`, rowIndex: r + 2, fixed: [String(r), 'x', 'y'], cards };
    })
  });
  const verify = (input, result) => {
    if (result.status !== 'solved') throw Error('Expected solution: ' + JSON.stringify(result));
    if (getConflicts(result.model).groups.length || result.model.rowData.some(hasScheduleGaps)) throw Error('Invalid solution');
    input.rowData.forEach((row, i) => {
      const signature = r => JSON.stringify(r.cards.filter(c => normalizeText(c.name)).map(c => [c.id, c.name, c.span]).sort());
      if (signature(row) !== signature(result.model.rowData[i]) || !locksPreserved(result.model.rowData[i], row)) throw Error('Meetings or locks changed');
      const cols = result.model.rowData[i].cards.flatMap(cardColumns);
      if (new Set(cols).size !== cols.length || cols.length !== input.timelineCols.length) throw Error('Overlapping or missing cells');
    });
  };
  // Independent small-instance oracle: enumerate row permutations, then combine rows.
  const oracle = model => {
    const layouts = model.rowData.map(row => {
      const cards = row.cards.filter(c => c.name);
      const answer = [];
      const visit = (todo, col, placed) => {
        if (!todo.length) { answer.push(placed); return; }
        todo.forEach((card, i) => {
          if (card.locked && card.startCol !== col) return;
          const entries = [];
          for (const teacher of card.name.split(',').map(s => s.trim().toLowerCase())) {
            for (let t = col; t < col + card.span; t++) entries.push(`${teacher}:${t}`);
          }
          visit(todo.filter((_, j) => i !== j), col + card.span, [...placed, ...entries]);
        });
      };
      visit(cards, 3, []);
      return answer;
    });
    const combine = (r, busy) => r === layouts.length || layouts[r].some(entries =>
      entries.every(key => !busy.has(key)) && combine(r + 1, new Set([...busy, ...entries])));
    return combine(0, new Set());
  };
  try {
    const input = makeModel([
      [['A', 2, true], ['B'], ['C'], ['D'], ['E']],
      [['A', 2], ['C'], ['B'], ['E'], ['D']],
      [['B'], ['C'], ['A', 2], ['D'], ['E']]
    ]);
    const original = JSON.stringify(input);
    verify(input, await generateSchedule(input));
    check(JSON.stringify(input) === original, 'Solve mixed durations, preserve locks and input');
    const overload = makeModel([[['A', 2], ['B'], ['C']], [['A', 2], ['C'], ['B']], [['B'], ['C'], ['A', 2]]]);
    check((await generateSchedule(overload)).status === 'infeasible', 'Detect teacher overload');
    const triangle = makeModel([[['A, B'], ['X']], [['B, C'], ['Y']], [['A, C'], ['Z']]], 2);
    check((await generateSchedule(triangle)).status === 'infeasible', 'Prove infeasibility even when teacher capacity fits');
    const locked = makeModel([[['A', 1, true], ['B']], [['A', 1, true], ['C']]], 2);
    check((await generateSchedule(locked)).status === 'infeasible', 'Detect conflicting locked meetings');
    check(await generateSchedule(input, { shouldCancel: () => true }) === null, 'Cancellation preserves original schedule');
    check((await generateSchedule(input, { timeLimitMs: 0 })).status === 'incomplete', 'Time limit is not reported as infeasibility');
    const fallback = makeModel([[['A', 2], ['B'], ['C']], [['A', 2], ['D'], ['E']]], 4);
    verify(fallback, await generateSchedule(fallback));
    check(true, 'Unrestricted search succeeds when shared boundaries cannot work');
    let seed = 901;
    const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    for (let sample = 0; sample < 80; sample++) {
      const rows = Array.from({ length: 2 + random(2) }, () => Array.from({ length: 2 + random(2) }, () =>
        [String.fromCharCode(65 + random(5)) + (random(8) === 0 ? ', F' : ''), 1 + random(2), random(10) === 0]));
      const model = makeModel(rows);
      const expected = oracle(model);
      const result = await generateSchedule(model);
      if (expected !== (result.status === 'solved')) throw Error(`Oracle mismatch ${sample}: ${JSON.stringify(model)} ${JSON.stringify(result)}`);
      if (expected) verify(model, result);
    }
    check(true, '80 mixed small cases match independent exhaustive oracle');
    const rows = Array.from({ length: 17 }, (_, r) => {
      const cards = Array.from({ length: 10 }, (_, t) => [`T${(r + t) % 17}`, 1]);
      for (let i = cards.length - 1; i > 0; i--) { const j = random(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      return cards;
    });
    const large = makeModel(rows, 10);
    const began = performance.now();
    const result = await generateSchedule(large, { timeLimitMs: 20000 });
    verify(large, result);
    check(true, `17 classes / 10 slots solved: ${result.nodes} nodes, ${Math.round(performance.now() - began)} ms`);
    const mixedRows = Array.from({ length: 17 }, (_, r) => {
      let col = 0;
      const cards = [2, 1, 2, 1, 2, 2].map(span => { const card = [`T${(r + col) % 17}`, span]; col += span; return card; });
      for (let i = cards.length - 1; i > 0; i--) { const j = random(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      return cards;
    });
    const mixedLarge = makeModel(mixedRows, 10);
    const mixedBegan = performance.now();
    const mixedResult = await generateSchedule(mixedLarge, { timeLimitMs: 20000 });
    verify(mixedLarge, mixedResult);
    check(true, `17 classes / 10 slots mixed durations solved: ${mixedResult.nodes} nodes, ${Math.round(performance.now() - mixedBegan)} ms`);
    const longModel = makeModel([[...Array.from({ length: 20 }, (_, i) => [`L${i}`, 2])]], 40);
    longModel.rowData[0].cards.forEach(card => { card.startCol = 3 + (card.startCol - 3 + 2) % 40; });
    verify(longModel, await generateSchedule(longModel));
    check(true, 'Bit masks handle schedules longer than 32 slots');
    let cancelled = false;
    const cancelModel = deepClone(large);
    const cancelSnapshot = JSON.stringify(cancelModel);
    check(await generateSchedule(cancelModel, { shouldCancel: () => cancelled, onProgress: () => { cancelled = true; } }) === null &&
      JSON.stringify(cancelModel) === cancelSnapshot, 'Cancellation during active search preserves input');
    state.model = triangle;
    const snapshot = JSON.stringify(state.model);
    await runGenerator();
    check(JSON.stringify(state.model) === snapshot && state.message.type === 'warn', 'UI keeps original schedule when infeasible');
    state.model = input;
    await runGenerator();
    check(evaluateConflictScore(state.model) === 0 && state.message.type === 'ok', 'UI installs only a conflict-free result');
    document.body.innerHTML = '<pre id="test-result">' + escapeHtml(JSON.stringify({ ok: true, results })) + '</pre>';
  } catch (error) {
    document.body.innerHTML = '<pre id="test-result">' + escapeHtml(JSON.stringify({ ok: false, error: error.stack, results })) + '</pre>';
  }
})();
