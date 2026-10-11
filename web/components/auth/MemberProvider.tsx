'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { sellingBackend, type Member, type SellingBackend } from '@/lib/selling';

interface MemberState {
  member: Member | null;
  /** True until we know whether someone is signed in. */
  loading: boolean;
  backend: SellingBackend;
  /** Re-reads the member, e.g. after a username change. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<MemberState | null>(null);

/** Who is signed in, for every page. The session lives in this browser (Supabase keeps it in local storage). */
export function MemberProvider({ children }: { children: React.ReactNode }) {
  const backend = useMemo(() => sellingBackend(), []);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    backend.member().then((m) => {
      if (live) {
        setMember(m);
        setLoading(false);
      }
    }).catch(() => live && setLoading(false));
    const off = backend.onMemberChange((m) => live && setMember(m));
    return () => {
      live = false;
      off();
    };
  }, [backend]);
  const refresh = useMemo(() => async () => setMember(await backend.member()), [backend]);
  return <Ctx.Provider value={{ member, loading, backend, refresh }}>{children}</Ctx.Provider>;
}

export function useMember(): MemberState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMember must be used inside MemberProvider');
  return v;
}
