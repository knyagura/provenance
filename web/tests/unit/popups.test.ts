import { describe, expect, it } from 'vitest';
import { choosePopup, dismissKey, onPage } from '@/components/popups/choose';
import { stepsToText, textToSteps } from '@/components/staff/PopupEditor';
import { SEED_POPUPS } from '@/lib/selling/examplePopups';

describe('popups', () => {
  it('matches pages: / is the home page only, others are prefixes, * is everywhere', () => {
    expect(onPage('/', '/')).toBe(true);
    expect(onPage('/', '/search')).toBe(false);
    expect(onPage('/,/item/', '/item/example-1')).toBe(true);
    expect(onPage('*', '/basket')).toBe(true);
  });
  it('picks the highest priority popup for the person and page that they haven’t closed', () => {
    const offer = { ...SEED_POPUPS[1], active: true, pages: '*' };
    const all = [offer, SEED_POPUPS[0]];
    const never = () => false;
    expect(choosePopup(all, { pathname: '/', signedIn: false, seen: never })?.key).toBe('how-it-works');
    expect(choosePopup(all, { pathname: '/search', signedIn: false, seen: never })?.key).toBe('welcome-offer');
    expect(choosePopup(all, { pathname: '/search', signedIn: true, seen: never })).toBeNull();
    const closed = new Set([dismissKey(SEED_POPUPS[0])]);
    expect(choosePopup(all, { pathname: '/', signedIn: false, seen: (k) => closed.has(k) })?.key).toBe('welcome-offer');
    expect(dismissKey({ key: 'x', version: 2 })).toBe('pv-popup-seen:x:2');
  });
  it('turns steps into lines and back', () => {
    const text = stepsToText(SEED_POPUPS[0].steps);
    expect(textToSteps(text)).toEqual(SEED_POPUPS[0].steps);
    expect(textToSteps('One - first\n\nTwo – second')).toEqual([{ title: 'One', note: 'first' }, { title: 'Two', note: 'second' }]);
  });
});
