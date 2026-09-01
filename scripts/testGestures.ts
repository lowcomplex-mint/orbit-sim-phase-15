/**
 * Headless checks for PointerTracker pan/pinch math (Phase 14 C).
 * Does not simulate DOM touch UX — only the coordinate geometry.
 */
import { PointerTracker } from '../src/ui/CanvasGestures';

let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok  ${msg}`);
  }
}

function nearly(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

{
  const t = new PointerTracker();
  t.down(1, { x: 10, y: 20 });
  const r = t.move(1, { x: 14, y: 26 });
  assert(r.pinch === null, 'one pointer: no pinch');
  assert(r.pan !== null && r.pan.dx === 4 && r.pan.dy === 6, 'one pointer: pan delta');
  t.up(1);
  assert(t.size === 0, 'up clears the pointer');
}

{
  const t = new PointerTracker();
  t.down(1, { x: 0, y: 0 });
  t.down(2, { x: 10, y: 0 });
  const r = t.move(2, { x: 20, y: 0 });
  assert(r.pan === null, 'two pointers: no pan');
  assert(r.pinch !== null, 'two pointers: pinch present');
  assert(nearly(r.pinch!.scale, 2), `pinch scale 2, got ${r.pinch?.scale}`);
  assert(nearly(r.pinch!.midX, 10), `pinch midX 10, got ${r.pinch?.midX}`);
  assert(nearly(r.pinch!.midY, 0), `pinch midY 0, got ${r.pinch?.midY}`);
}

{
  const t = new PointerTracker();
  t.down(1, { x: 0, y: 0 });
  const ignored = t.move(99, { x: 5, y: 5 });
  assert(ignored.pan === null && ignored.pinch === null, 'unknown id is a no-op');
  t.down(2, { x: 0, y: 8 });
  const pinchIn = t.move(2, { x: 0, y: 16 });
  assert(pinchIn.pinch !== null && nearly(pinchIn.pinch.scale, 2), 'vertical pinch scale 2');
  t.up(2);
  const panAfter = t.move(1, { x: 3, y: 0 });
  assert(panAfter.pan !== null && panAfter.pan.dx === 3, 'after pinch, remaining pointer pans');
}

{
  const t = new PointerTracker();
  t.down(1, { x: 0, y: 0 });
  t.down(1, { x: 4, y: 0 }); // idempotent replace
  const r = t.move(1, { x: 10, y: 0 });
  assert(r.pan !== null && r.pan.dx === 6, 'double down replaces position');
}

if (failed > 0) {
  console.error(`\n${failed} gesture test(s) failed`);
  process.exit(1);
}
console.log('\nAll gesture tests passed.');
