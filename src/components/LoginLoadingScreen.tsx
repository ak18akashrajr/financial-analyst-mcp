import { useEffect, useState } from 'react';

// Cosmetic, fixed-timing stage sequence shown right after a successful
// sign-in and before we navigate into the dashboard. Deliberately NOT tied
// to usePortfolio's real fetch state — see the "cosmetic timed sequence"
// call in the login-animation work (kept simple, no risk of hitching if a
// real query is slow).
const STAGES = [
  'Entering your finance world...',
  'Pulling up your portfolio...',
  'Processing holdings...',
  'Analyzing exposure...',
] as const;

const STAGE_DURATION_MS = 550;
const TOTAL_DURATION_MS = STAGES.length * STAGE_DURATION_MS;

interface LoginLoadingScreenProps {
  onDone: () => void;
}

export const LoginLoadingScreen = ({ onDone }: LoginLoadingScreenProps) => {
  const [stageIndex, setStageIndex] = useState(0);
  // Kicks the width transition from 0 -> full on mount (see the effect below).
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Two rAFs so the browser commits width:0 before we flip it, otherwise
    // the transition never plays and the bar just snaps to full.
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setProgress(100));
    });

    const stageTimer = setInterval(() => {
      setStageIndex(i => Math.min(i + 1, STAGES.length - 1));
    }, STAGE_DURATION_MS);

    const doneTimer = setTimeout(onDone, TOTAL_DURATION_MS);

    return () => {
      cancelAnimationFrame(raf1);
      clearInterval(stageTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-xs space-y-4 text-center">
        <p
          key={stageIndex}
          className="text-sm font-medium text-muted-foreground animate-in fade-in duration-300"
        >
          {STAGES[stageIndex]}
        </p>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] ease-linear"
            style={{ width: `${progress}%`, transitionDuration: `${TOTAL_DURATION_MS}ms` }}
          />
        </div>
      </div>
    </div>
  );
};
