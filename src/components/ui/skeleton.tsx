import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // A highlight band sweeps across the block (the ::before) rather than the whole thing
        // pulsing, which reads as "loading" instead of "disabled". Under prefers-reduced-motion
        // the global rule in index.css stops the sweep and it's a plain muted block.
        "relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.07] before:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
