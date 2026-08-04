"use client";

import { Suspense } from "react";
import { NavigationProgress } from "@/components/navigation-progress";

/** Suspense boundary required for useSearchParams in the progress bar. */
export function NavigationProgressHost() {
  return (
    <Suspense fallback={null}>
      <NavigationProgress />
    </Suspense>
  );
}
