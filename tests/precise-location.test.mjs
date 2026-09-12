import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./load-source.mjs";
const { usableGPS } = await sourceLoader(process.cwd())("src/lib/coordinates.ts");

test("automatic GPS acceptance requires reported accuracy within 25 metres", () => {
  const now = Date.now();
  const fix = (accuracy) => ({
    timestamp: now,
    coords: { latitude: 9.9816, longitude: 76.2999, accuracy },
  });
  for (const accuracy of [5, 12, 25]) assert.equal(usableGPS(fix(accuracy), now), true);
  for (const accuracy of [25.01, 50, 100, 2500, null, undefined, NaN, -1])
    assert.equal(usableGPS(fix(accuracy), now), false);
  assert.equal(usableGPS({ ...fix(5), timestamp: now - 31000 }, now), false);
});
