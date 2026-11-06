'use client';

import { useEffect, useRef, useState } from 'react';
import { planShareUrl } from '@/lib/exportPlanPdf';

interface Props {
  planId: number;
  className: string;
}

// Copies the plan's public read-only link. The link is shown as well when the
// browser won't allow copying (clipboard access needs https or localhost).
export default function ShareLinkButton({ planId, className }: Props) {
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function share() {
    setFailed(false);
    let url: string;
    try {
      url = await planShareUrl(planId);
    } catch (e) {
      console.error(e);
      setFailed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setManualUrl(url);
    }
  }

  return (
    <>
      <button onClick={share} className={className}>
        {copied ? '✓ Link copied' : failed ? 'Share failed — retry' : '🔗 Share'}
      </button>
      {manualUrl && (
        <input
          readOnly
          value={manualUrl}
          aria-label="Public link to this plan"
          onFocus={e => e.target.select()}
          className="w-64 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
        />
      )}
    </>
  );
}
