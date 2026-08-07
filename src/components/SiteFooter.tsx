import { Link } from 'react-router-dom';

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="max-w-6xl mx-auto px-4 pt-20 pb-10">
        <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-6">
          A Note From Dad
        </p>
        <p
          className="text-muted-foreground/40 leading-[1.05] tracking-tight"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 'clamp(2rem, 6vw, 4.5rem)',
          }}
        >
          "Son, you must become the most handsome, jacked, and richest man your
          bloodline has ever seen."
        </p>

        <div className="mt-16 pt-5 border-t border-border flex items-center justify-between text-xs">
          <span className="font-mono text-muted-foreground">
            Akash's Networth Over Time
          </span>
          <Link
            to="/updates"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Changelog →
          </Link>
        </div>
      </div>
    </footer>
  );
}
