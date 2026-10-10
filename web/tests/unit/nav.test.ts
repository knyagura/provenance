import { describe, expect, it } from 'vitest';
import { isActive } from '@/components/ui/BottomNav';

describe('bottom bar active tab', () => {
  it('marks Home only on the home page', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/sell', '/')).toBe(false);
  });
  it('marks a section for its own pages', () => {
    expect(isActive('/inbox', '/inbox')).toBe(true);
    expect(isActive('/inbox/123', '/inbox')).toBe(true);
    expect(isActive('/inboxes', '/inbox')).toBe(false);
  });
});
