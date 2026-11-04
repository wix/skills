'use strict';

// Interleaves a per-record producer with its dependents (media files and the products that show
// them, a parent and its children), so a dependent batch starts as soon as its own producer
// records are written instead of after the whole producer task. Pure: it reads no files and
// decides nothing about readiness; gateBatch still checks every reference key on its own.
//
// dependents: [{ sourceStableKey, needs: [producerSourceKey, ...] }] in import order.
// producerKeys: every producer key in its import order; keys no dependent needs go last.
// Returns [{ producerKeys, dependentKeys }]: write each wave's producer keys, then its dependents.
// A key two dependents share is written in the first wave that needs it. The final wave carries
// the producer keys no dependent named, with no dependents.
function planDependencyWaves({ dependents = [], producerKeys = [], waveSize = 50 } = {}) {
  if (!Array.isArray(dependents) || !Array.isArray(producerKeys) || !Number.isInteger(waveSize) || waveSize < 1) throw new Error('DEPENDENCY_WAVES_INVALID');
  const known = new Set(producerKeys), scheduled = new Set(), seen = new Set(), waves = [];
  for (let start = 0; start < dependents.length; start += waveSize) {
    const wave = { producerKeys: [], dependentKeys: [] };
    for (const dependent of dependents.slice(start, start + waveSize)) {
      if (!dependent || typeof dependent.sourceStableKey !== 'string' || seen.has(dependent.sourceStableKey) || !Array.isArray(dependent.needs)) throw new Error('DEPENDENCY_WAVES_INVALID');
      seen.add(dependent.sourceStableKey); wave.dependentKeys.push(dependent.sourceStableKey);
      // A key the producer does not have is left to the gate, which defers that dependent.
      for (const key of dependent.needs) if (known.has(key) && !scheduled.has(key)) { scheduled.add(key); wave.producerKeys.push(key); }
    }
    waves.push(wave);
  }
  const rest = producerKeys.filter(key => !scheduled.has(key));
  if (rest.length) waves.push({ producerKeys: [...new Set(rest)], dependentKeys: [] });
  return waves;
}

module.exports = { planDependencyWaves };
