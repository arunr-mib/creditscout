"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PIPELINE_REFRESH_MS } from "./pipelineModel";

/**
 * Re-reads the page on a timer while an investigation may be running, so a card
 * moves lanes and its steps update without a manual reload. Renders nothing;
 * the timer is cleared on unmount and the moment `active` goes false.
 */
export function PipelineAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), PIPELINE_REFRESH_MS);
    return () => clearInterval(id);
  }, [active, router]);

  return null;
}
