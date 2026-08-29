import { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, DoorOpen, LineChart, Search, type LucideIcon } from 'lucide-react';

// Cosmetic, fixed-timing stage sequence shown right after a successful
// sign-in and before we navigate into the dashboard. Deliberately NOT tied
// to usePortfolio's real fetch state — see the "cosmetic timed sequence"
// call in the login-animation work (kept simple, no risk of hitching if a
// real query is slow).
const STAGES: Array<{ text: string; Icon: LucideIcon; spin?: boolean }> = [
  { text: 'Entering your finance world...', Icon: DoorOpen },
  { text: 'Pulling up your portfolio...', Icon: LineChart },
  { text: 'Processing holdings...', Icon: Cpu, spin: true },
  { text: 'Analyzing exposure...', Icon: Search },
];

const STAGE_DURATION_MS = 500;
const STAGES_DURATION_MS = STAGES.length * STAGE_DURATION_MS;
const COMPLETE_DURATION_MS = 250;
const FADE_DURATION_MS = 200;
const TOTAL_DURATION_MS = STAGES_DURATION_MS + COMPLETE_DURATION_MS + FADE_DURATION_MS;

interface LoginLoadingScreenProps {
  onDone: () => void;
}

export const LoginLoadingScreen = ({ onDone }: LoginLoadingScreenProps) => {
  const [stageIndex, setStageIndex] = useState(0);
  // 'stages' cycles STAGES; 'complete' shows a brief checkmark flourish;
  // 'fading' opacity-transitions the whole overlay out before onDone fires,
  // so the handoff to whatever mounts underneath reads as a crossfade
  // rather than an abrupt cut.
  const [phase, setPhase] = useState<'stages' | 'complete' | 'fading'>('stages');
  // Kicks the progress-bar width transition from 0 -> full on mount (see
  // the effect below).
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Two rAFs so the browser commits width:0 before we flip it, otherwise
    // the transition never plays and the bar just snaps to full.
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setProgress(100));
    });

    const stageTimer = setInterval(() => {
      setStageIndex(i => (i + 1 < STAGES.length ? i + 1 : i));
    }, STAGE_DURATION_MS);

    const completeTimer = setTimeout(() => setPhase('complete'), STAGES_DURATION_MS);
    const fadeTimer = setTimeout(() => setPhase('fading'), STAGES_DURATION_MS + COMPLETE_DURATION_MS);
    const doneTimer = setTimeout(onDone, TOTAL_DURATION_MS);

    return () => {
      cancelAnimationFrame(raf1);
      clearInterval(stageTimer);
      clearTimeout(completeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = STAGES[stageIndex];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4 transition-opacity ease-in"
      style={{ opacity: phase === 'fading' ? 0 : 1, transitionDuration: `${FADE_DURATION_MS}ms` }}
    >
      <div className="w-full max-w-xs space-y-4 text-center">
        {phase === 'complete' ? (
          <div className="flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-300">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium text-foreground">You're in.</p>
          </div>
        ) : (
          <div key={stageIndex} className="flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-300">
            <current.Icon className={`h-5 w-5 text-muted-foreground ${current.spin ? 'animate-spin' : ''}`} />
            <p className="text-sm font-medium text-muted-foreground">{current.text}</p>
          </div>
        )}
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] ease-linear"
            style={{ width: `${progress}%`, transitionDuration: `${STAGES_DURATION_MS}ms` }}
          />
        </div>
      </div>
    </div>
  );
};
