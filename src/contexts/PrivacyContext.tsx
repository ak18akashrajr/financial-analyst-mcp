import { createContext, useContext, useState, type ReactNode } from 'react';

interface PrivacyContextType {
  hidden: boolean;
  toggle: () => void;
  mask: (value: string) => string;
}

const PrivacyContext = createContext<PrivacyContextType>({ hidden: false, toggle: () => {}, mask: (v) => v });

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const mask = (value: string) => (hidden ? '••••••' : value);
  return (
    <PrivacyContext.Provider value={{ hidden, toggle: () => setHidden((h) => !h), mask }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export const usePrivacy = () => useContext(PrivacyContext);
