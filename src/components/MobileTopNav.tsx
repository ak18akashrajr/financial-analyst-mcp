import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, LogOut, Landmark } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { FamilyMemberSwitcher } from '@/components/FamilyMemberSwitcher';
import { getVisibleNavGroups } from '@/components/navConfig';
import { useActiveMemberRelationship } from '@/hooks/useActiveMemberRelationship';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export function MobileTopNav() {
  const { signOut } = useAuth();
  const navGroups = getVisibleNavGroups(useActiveMemberRelationship());
  const [open, setOpen] = useState(false);
  const logout = () => {
    signOut();
  };

  return (
    <header className="md:hidden sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open navigation menu"
                className="flex items-center justify-center h-9 w-9 -ml-1.5 rounded-md text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] max-w-xs flex flex-col p-0">
              <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-left">
                <SheetTitle asChild>
                  <Link
                    to="/overview"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 min-w-0"
                  >
                    <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
                      <Landmark className="w-4 h-4" />
                    </div>
                    <span className="flex flex-col leading-tight min-w-0">
                      <span className="text-sm font-semibold truncate">Blackcrest Capital Holdings</span>
                      <span className="text-[10px] italic text-muted-foreground font-normal truncate">
                        Preserving Capital. Building Legacy.
                      </span>
                    </span>
                  </Link>
                </SheetTitle>
              </SheetHeader>

              <nav className="flex-1 overflow-y-auto px-3 py-3">
                {navGroups.map((group, gi) => (
                  <div key={group.label ?? `group-${gi}`} className={gi > 0 ? 'mt-3 pt-3 border-t border-border/60' : undefined}>
                    {group.label && (
                      <p className="px-3 mb-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/70">
                        {group.label}
                      </p>
                    )}
                    <div className="flex flex-col gap-1">
                      {group.items.map((t) => {
                        const Icon = t.icon;
                        return (
                          <NavLink
                            key={t.to}
                            to={t.to}
                            end={t.to === '/overview'}
                            onClick={() => setOpen(false)}
                            className={({ isActive }) =>
                              `flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                  ? 'bg-foreground text-background'
                                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`
                            }
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{t.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <Link to="/overview" className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0">
              <Landmark className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[11px] font-semibold truncate">Blackcrest Capital Holdings</span>
              <span className="text-[9px] italic text-muted-foreground -mt-0.5 truncate">Preserving Capital. Building Legacy.</span>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-20 min-w-0">
            <FamilyMemberSwitcher />
          </div>
          <ThemeToggle />
          <button
            onClick={logout}
            aria-label="Log out"
            className="flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
