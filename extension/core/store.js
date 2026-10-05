/**
 * What the background last learned about one provider. The background is the
 * only writer; the popup and every page HUD read it and listen for changes.
 *
 * @typedef {object} Snapshot
 * @property {string} provider
 * @property {'ok'|'signed_out'|'unreachable'|'no_data'} status
 * @property {import('./gauges.js').Meter[]} meters  Last known meters, kept when a refresh fails.
 * @property {string|null} plan                      Plan id from the provider, e.g. "max_20x".
 * @property {number|null} fetchedAt                 Epoch ms of the last successful refresh.
 * @property {number} attemptedAt                    Epoch ms of the last attempt.
 */

const PREFIX = 'snapshot:';

export function snapshotKey(providerId) {
  return PREFIX + providerId;
}

/** The provider id a storage key belongs to, or null for other keys. */
export function providerIdOfKey(key) {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
}

/** @returns {Promise<Record<string, Snapshot|null>>} */
export async function readSnapshots(providerIds) {
  const data = await chrome.storage.local.get(providerIds.map(snapshotKey));
  return Object.fromEntries(providerIds.map(id => [id, data[snapshotKey(id)] ?? null]));
}

/** @returns {Promise<Snapshot|null>} */
export async function readSnapshot(providerId) {
  return (await readSnapshots([providerId]))[providerId];
}

export async function writeSnapshot(providerId, snapshot) {
  await chrome.storage.local.set({ [snapshotKey(providerId)]: snapshot });
}
