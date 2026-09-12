import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./load-source.mjs";
const { acquireCurrentPosition } = await sourceLoader(process.cwd())("src/lib/acquire-location.ts");

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let receive,
    reject,
    starts = 0,
    stops = 0,
    options;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        watchPosition(onPosition, onError, opts) {
          receive = onPosition;
          reject = onError;
          starts++;
          options = opts;
          return 4;
        },
        clearWatch(id) {
          assert.equal(id, 4);
          stops++;
        },
      },
    },
  });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  });
  return {
    emit: (p) => receive(p),
    error: (code) => reject({ code }),
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
    get options() {
      return options;
    },
  };
}
const fix = (accuracy, lat = 9.9816, timestamp = Date.now()) => ({
  timestamp,
  coords: { latitude: lat, longitude: 76.2999, accuracy },
});

test("refinement chooses the best recent sample, preserving its coordinates and capture time", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  env.emit(fix(800));
  env.emit(fix(18));
  t.mock.timers.tick(1000);
  const best = fix(8, 9.9817);
  env.emit(best);
  t.mock.timers.tick(1000);
  env.emit(fix(23, 9.9818));
  assert.equal(env.stops, 0);
  t.mock.timers.tick(1000);
  assert.equal(await pending, best);
  assert.equal(env.stops, 1);
  assert.equal(env.options.enableHighAccuracy, true);
  assert.equal(env.options.maximumAge, 0);
});

test("the deadline never accepts the coarse best-so-far fallback from the shared example", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  const checked = assert.rejects(pending, /required 25 m accuracy/);
  env.emit(fix(800));
  t.mock.timers.tick(20000);
  await checked;
  assert.equal(env.stops, 1);
});

test("a qualifying fix arriving near the deadline can complete without exceeding the deadline", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  t.mock.timers.tick(19000);
  const good = fix(12);
  env.emit(good);
  t.mock.timers.tick(1000);
  assert.equal(await pending, good);
  t.mock.timers.tick(5000);
  assert.equal(env.stops, 1);
});

test("an older best fix cannot beat a still-fresh later reading", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  env.emit(fix(5, 9.98, Date.now() - 3000));
  t.mock.timers.tick(1000);
  const current = fix(15, 9.99);
  env.emit(current);
  t.mock.timers.tick(2000);
  assert.equal(await pending, current);
});

test("stale and invalid readings cannot be selected", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  const checked = assert.rejects(pending, /timed out/);
  env.emit(fix(5, 9.98, Date.now() - 6000));
  env.emit(fix(NaN));
  env.emit(fix(5, 100));
  t.mock.timers.tick(20000);
  await checked;
});

test("cancellation during refinement clears the watch and cannot resolve a late sample", async (t) => {
  const env = setup(t);
  const controller = new AbortController();
  const pending = acquireCurrentPosition({ signal: controller.signal });
  const checked = assert.rejects(pending, { name: "AbortError" });
  env.emit(fix(12));
  controller.abort();
  env.emit(fix(5));
  t.mock.timers.tick(30000);
  await checked;
  assert.equal(env.stops, 1);
});

test("transient unavailability can recover but permission denial stops immediately", async (t) => {
  const env = setup(t);
  const pending = acquireCurrentPosition();
  env.error(2);
  env.emit(fix(12));
  t.mock.timers.tick(3000);
  await pending;
  const denied = acquireCurrentPosition();
  const checked = assert.rejects(denied, /access is blocked/);
  env.error(1);
  await checked;
  assert.equal(env.stops, 2);
});

test("a shared subscription avoids opening a duplicate device watch", async (t) => {
  const env = setup(t);
  let receive,
    stop = 0;
  const pending = acquireCurrentPosition({
    subscribe(callback) {
      receive = callback;
      return () => stop++;
    },
  });
  receive(fix(12));
  t.mock.timers.tick(3000);
  await pending;
  assert.equal(env.starts, 0);
  assert.equal(stop, 1);
});
