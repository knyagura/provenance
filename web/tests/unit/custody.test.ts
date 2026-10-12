import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalEvent,
  canonicalEvidence,
  custodyHeadline,
  evidenceProblems,
  hashEvent,
  isMyTurn,
  normaliseSeal,
  planFor,
  PLANS,
  progressOf,
  stagesFor,
  SEAL_CODE,
  stepCopy,
  type StepDef,
} from '@/lib/domain/custody';

const fixture = JSON.parse(readFileSync(new URL('../../../backend/fixtures/custody_plans.json', import.meta.url), 'utf8'));
const tiers = ['enhanced', 'verified', 'luxury', 'ultraLuxury'] as const;

describe('custody plans', () => {
  it.each(tiers)('%s matches the shared fixture exactly', (tier) => {
    expect(PLANS[tier]).toEqual(fixture[tier]);
  });

  it.each(tiers)('%s: every step has words, keys are unique, and it ends with the buyer confirming', (tier) => {
    const plan = planFor(tier);
    expect(new Set(plan.map((p) => p.key)).size).toBe(plan.length);
    for (const step of plan) expect(stepCopy(step, tier).title).not.toBe(step.key);
    expect(plan.at(-1)).toEqual({ key: 'confirm', actor: 'buyer', needs: [] });
  });

  it.each(tiers)('%s: every seal checked was applied earlier in the same order', (tier) => {
    const applied = new Set<string>();
    for (const step of planFor(tier)) {
      if (step.sealMode === 'apply') applied.add(step.seal!);
      if (step.sealMode === 'check') expect(applied.has(step.seal!)).toBe(true);
    }
  });

  it('every challenge step also needs a video, so the code is said on camera', () => {
    for (const tier of tiers) for (const step of planFor(tier)) if (step.needs.includes('code')) expect(step.needs).toContain('video');
  });

  it('a courier witnesses packing and opening from £75, and a hub authenticates from £500', () => {
    expect(planFor('enhanced').some((p) => p.actor === 'courier')).toBe(false);
    expect(planFor('verified').filter((p) => p.actor === 'courier').map((p) => p.key)).toEqual(['courier_pickup', 'courier_delivery', 'witness_opening']);
    expect(planFor('verified').some((p) => p.actor === 'hub')).toBe(false);
    expect(planFor('luxury').some((p) => p.key === 'hub_authenticate')).toBe(true);
    expect(planFor('luxury').some((p) => p.actor === 'hub2')).toBe(false);
    expect(planFor('ultraLuxury').some((p) => p.actor === 'hub2')).toBe(true);
  });
});

describe('the hash chain', () => {
  const ex = fixture.hash_example;
  const link = {
    prev: ex.prev,
    orderId: ex.order_id,
    seq: ex.seq,
    step: ex.step,
    actorRole: ex.actor_role,
    actorId: ex.actor_id,
    evidence: ex.evidence,
    at: ex.at,
  };

  it('writes evidence in byte-counted, sorted form', () => {
    expect(canonicalEvidence({ b: 'x', a: 12 })).toBe('a=2:12;b=1:x');
    expect(canonicalEvidence({ note: 'é' })).toBe('note=2:é');
    expect(canonicalEvidence({})).toBe('');
  });

  it('a value containing the separators cannot pass for two fields', () => {
    expect(canonicalEvidence({ a: '1;b=1:2' })).not.toBe(canonicalEvidence({ a: '1', b: '2' }));
  });

  it('matches the fixture the database is tested against', async () => {
    expect(canonicalEvent(link)).toBe(ex.canonical);
    expect(await hashEvent(link)).toBe(ex.hash);
  });

  it('any change to any part changes the hash', async () => {
    const base = await hashEvent(link);
    expect(await hashEvent({ ...link, evidence: { ...link.evidence, grams: 813 } })).not.toBe(base);
    expect(await hashEvent({ ...link, prev: 'f'.repeat(64) })).not.toBe(base);
    expect(await hashEvent({ ...link, at: '2026-10-11T20:15:03.124Z' })).not.toBe(base);
    expect(await hashEvent({ ...link, actorId: 'someone-else' })).not.toBe(base);
  });
});

describe('evidence checks before sending', () => {
  const step = (key: string, tier: (typeof tiers)[number] = 'luxury'): StepDef => planFor(tier).find((p) => p.key === key)!;

  it('names everything missing, and nothing once complete', () => {
    expect(evidenceProblems(step('handover_code'), {})).toEqual(['Start recording to get your code.', 'Add the video.']);
    expect(evidenceProblems(step('handover_code'), { code: '123456', media: 'o/x.mp4', media_kind: 'video' })).toEqual([]);
    expect(evidenceProblems(step('handover_code'), { code: '123456', media: 'o/x.jpg', media_kind: 'photo' })).toEqual(['Add the video.']);
    expect(evidenceProblems(step('hub_reseal'), { seal: 'PB-7K2M-9QXD', grams: 640 })).toEqual([]);
    expect(evidenceProblems(step('hub_reseal'), { seal: 'nonsense', grams: 0 })).toHaveLength(2);
    expect(evidenceProblems(step('courier_pickup'), { attest: true, carrier: 'DPD', tracking: '15501234567890' })).toEqual([]);
    expect(evidenceProblems(step('courier_pickup'), { attest: false, carrier: '', tracking: 'x' })).toHaveLength(3);
    expect(evidenceProblems(step('hub_authenticate'), { result: 'maybe' })).toEqual(['Choose pass or fail.']);
    expect(evidenceProblems(step('confirm'), {})).toEqual([]);
  });

  it('accepts weights in whole grams only, within reason', () => {
    const w = step('handover_weight');
    expect(evidenceProblems(w, { grams: 812 })).toEqual([]);
    expect(evidenceProblems(w, { grams: 81.5 })).toHaveLength(1);
    expect(evidenceProblems(w, { grams: 100_001 })).toHaveLength(1);
  });

  it('tidies seal codes as typed or scanned', () => {
    expect(normaliseSeal('ps 7k2m 9qxd')).toBe('PS-7K2M-9QXD');
    expect(normaliseSeal('PB-7K2M-9QXD')).toBe('PB-7K2M-9QXD');
    expect(SEAL_CODE.test('PS-7K2M-9QXD')).toBe(true);
    // Crockford base32: no I, L, O or U, so codes can be read aloud without confusion.
    expect(SEAL_CODE.test('PS-7K2M-9QXO')).toBe(false);
  });
});

describe('whose turn it is', () => {
  const plan = planFor('verified');
  it('is the person who holds the current step’s role', () => {
    expect(isMyTurn({ state: 'in_progress', current: plan[0], myRoles: ['seller'] })).toBe(true);
    expect(isMyTurn({ state: 'in_progress', current: plan[0], myRoles: ['buyer'] })).toBe(false);
    expect(isMyTurn({ state: 'disputed', current: plan[0], myRoles: ['seller'] })).toBe(false);
    expect(isMyTurn({ state: 'confirmed', current: null, myRoles: ['buyer'] })).toBe(false);
  });
  it('lists read plainly', () => {
    expect(custodyHeadline({ state: 'in_progress', current: plan[0], myRoles: ['seller'], tier: 'verified' })).toBe('Your turn: start recording and read the code aloud');
    expect(custodyHeadline({ state: 'in_progress', current: plan[5], myRoles: ['buyer'], tier: 'verified' })).toMatch(/^Waiting for the courier/);
    expect(custodyHeadline({ state: 'disputed', current: plan[5], myRoles: ['buyer'], tier: 'verified' })).toMatch(/On hold/);
  });
});

describe('stages', () => {
  it('group every step, in order, without losing any', () => {
    for (const tier of tiers) {
      const stages = stagesFor(tier);
      expect(stages.flatMap((st) => st.steps)).toEqual(planFor(tier));
      expect(new Set(stages.map((st) => st.key)).size).toBe(stages.length);
      expect(stages.at(-1)?.key).toBe('complete');
    }
  });
  it('only tiers with a hub have an authentication stage, and only witnessed tiers a door stage', () => {
    expect(stagesFor('enhanced').map((s) => s.key)).toEqual(['handover', 'complete']);
    expect(stagesFor('verified').map((s) => s.key)).toEqual(['handover', 'door', 'complete']);
    expect(stagesFor('luxury').map((s) => s.key)).toEqual(['handover', 'hub', 'door', 'complete']);
  });
  it('measures progress from what has been recorded', () => {
    const plan = planFor('verified');
    const ev = (step: string) => ({ seq: 1, step, actorRole: 'seller' as const, at: '', mine: false, evidence: {}, hash: '' });
    expect(progressOf({ tier: 'verified', events: [], state: 'in_progress', current: plan[0] })).toEqual({ done: 0, total: 12, stage: 'handover' });
    expect(progressOf({ tier: 'verified', events: plan.slice(0, 7).map((p) => ev(p.key)), state: 'in_progress', current: plan[7] })).toEqual({ done: 7, total: 12, stage: 'door' });
    expect(progressOf({ tier: 'verified', events: plan.map((p) => ev(p.key)), state: 'confirmed', current: null })).toEqual({ done: 12, total: 12, stage: 'complete' });
  });
});
