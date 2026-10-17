'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMember } from '@/components/auth/MemberProvider';

/** Shows its children only to staff. The database checks again on every call; this only spares others a broken page. */
export function StaffGate({ children }: { children: React.ReactNode }) {
  const { member, loading, backend } = useMember();
  const [staff, setStaff] = useState<boolean | null>(null);
  useEffect(() => {
    if (!member) return setStaff(false);
    backend.isStaff().then(setStaff).catch(() => setStaff(false));
  }, [member, backend]);
  if (loading || (member && staff === null)) return <p role="status">Loading…</p>;
  if (!member) return <section className="pv-section"><h1>Staff console</h1><p><Link className="pv-btn pv-btn--primary" href="/signin?next=/staff">Sign in</Link></p></section>;
  if (!staff) return <section className="pv-section pv-narrow"><h1>Staff only</h1><p className="pv-lead">This page is for NuTuYu staff. If you should have access, ask an existing staff member to add you.</p></section>;
  return <>{children}</>;
}
