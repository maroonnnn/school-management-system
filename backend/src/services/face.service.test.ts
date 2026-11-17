import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.FACE_KEY = crypto.randomBytes(32).toString("hex");
const { encryptVector, decryptVector, cosine } = await import("./face.service.js");

const unit = (n: number, seed: number) => {
  const v = Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + seed) * 43758.5453 % 1);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
};

test("vector survives encrypt → decrypt (float32 precision)", () => {
  const v = unit(128, 1);
  const { ciphertext, iv, authTag } = encryptVector(v);
  const back = decryptVector(ciphertext, iv, authTag);
  assert.equal(back.length, 128);
  v.forEach((x, i) => assert.ok(Math.abs(x - (back[i] ?? 0)) < 1e-6));
});

test("ciphertext does not contain the raw vector bytes and IVs differ (NFR-06)", () => {
  const v = unit(128, 2);
  const a = encryptVector(v);
  const b = encryptVector(v);
  assert.notDeepEqual(a.ciphertext, Buffer.from(new Float32Array(v).buffer));
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test("tampered ciphertext is rejected (GCM auth tag)", () => {
  const { ciphertext, iv, authTag } = encryptVector(unit(128, 3));
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
  assert.throws(() => decryptVector(ciphertext, iv, authTag));
});

test("cosine: identical = 1, opposite = −1, orthogonal ≈ 0", () => {
  const v = unit(128, 4);
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-9);
  assert.ok(Math.abs(cosine(v, v.map((x) => -x)) + 1) < 1e-9);
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.equal(cosine(a, b), 0);
});
