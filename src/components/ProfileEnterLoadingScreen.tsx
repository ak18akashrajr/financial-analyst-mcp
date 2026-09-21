import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Cpu, LayoutDashboard, LineChart, Sparkles, type LucideIcon } from 'lucide-react';

// Cosmetic, fixed-timing stage sequence shown right after a profile is picked on the "Who's
// Watching" screen (src/pages/WhosWatching.tsx) and before we navigate into the dashboard — same
// "cosmetic timed sequence, not tied to real fetch state" approach as LoginLoadingScreen.tsx,
// just personalized with the picked name instead of generic copy.
const STAGE_DURATION_MS = 500;
const COMPLETE_DURATION_MS = 250;
const FADE_DURATION_MS = 200;

function buildStages(name: string): Array<{ text: string; Icon: LucideIcon; spin?: boolean }> {
  return [
    { text: `Hi ${name}, welcome back!`, Icon: Sparkles },
    { text: 'Setting up your dashboard...', Icon: LayoutDashboard },
    { text: 'Loading your holdings...', Icon: Cpu, spin: true },
    { text: 'Pulling up your view...', Icon: LineChart },
  ];
}

interface ProfileEnterLoadingScreenProps {
  name: string;
  onDone: () => void;
}

export const ProfileEnterLoadingScreen = ({ name, onDone }: ProfileEnterLoadingScreenProps) => {
  const stages = useMemo(() => buildStages(name), [name]);
  const stagesDurationMs = stages.length * STAGE_DURATION_MS;
  const totalDurationMs = stagesDurationMs + COMPLETE_DURATION_MS + FADE_DURATION_MS;

  const [stageIndex, setStageIndex] = useState(0);
  const [phase, setPhase] = useState<'stages' | 'complete' | 'fading'>('stages');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setProgress(100));
    });

    const stageTimer = setInterval(() => {
      setStageIndex(i => (i + 1 < stages.length ? i + 1 : i));
    }, STAGE_DURATION_MS);

    const completeTimer = setTimeout(() => setPhase('complete'), stagesDurationMs);
    const fadeTimer = setTimeout(() => setPhase('fading'), stagesDurationMs + COMPLETE_DURATION_MS);
    const doneTimer = setTimeout(onDone, totalDurationMs);

    return () => {
      cancelAnimationFrame(raf1);
      clearInterval(stageTimer);
      clearTimeout(completeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);

  const current = stages[stageIndex];

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
            style={{ width: `${progress}%`, transitionDuration: `${stagesDurationMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
};
