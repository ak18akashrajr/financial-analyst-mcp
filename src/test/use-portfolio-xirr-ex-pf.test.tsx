// Confirms usePortfolio.ts's summary.xirrExPf actually diverges from summary.xirr once a
// transaction-backed holding is tagged category 'PPF / EPF' in symbol_metadata — and that it
// stays identical when none are (today's real-world case). See the note on
// PortfolioSummary.xirrExPf in src/types/portfolio.ts and src/components/XirrDetailsCard.tsx.
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePortfolio } from '@/hooks/usePortfolio';

const { transactionRows, priceRows, metadataRows } = vi.hoisted(() => ({
  transactionRows: [] as Array<{ id: string; symbol: string; type: string; quantity: number; price: number; date: string }>,
  priceRows: [] as Array<{ symbol: string; price: number }>,
  metadataRows: [] as Array<{ symbol: string; geography: string; sector: string }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return { select: () => ({ order: () => Promise.resolve({ data: transactionRows, error: null }) }) };
      }
      if (table === 'cash_settings') {
        return {
          select: () => ({
            limit: () => ({
              single: () => Promise.resolve({
                data: { liquid_cash: 0, vault_cash: 0, pf_balance: 500000, credit_card_debt: 0 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'current_prices') {
        return { select: () => Promise.resolve({ data: priceRows, error: null }) };
      }
      if (table === 'symbol_metadata') {
        return { select: () => Promise.resolve({ data: metadataRows, error: null }) };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
  },
}));

describe('usePortfolio summary.xirrExPf', () => {
  it('equals summary.xirr when no holding is tagged PPF/EPF (today\'s real-world case)', async () => {
    transactionRows.length = 0;
    transactionRows.push({ id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2024-01-01' });
    priceRows.length = 0;
    priceRows.push({ symbol: 'TCS', price: 200 });
    metadataRows.length = 0;

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summary.xirr).not.toBeNull();
    expect(result.current.summary.xirrExPf).toBe(result.current.summary.xirr);
    // The manual PF balance (₹500,000 in cash_settings, mocked above) must not have leaked into
    // either XIRR figure — it has no transaction cash flows to contribute.
  });

  it('excludes a PPF/EPF-tagged holding from xirrExPf while xirr still includes it', async () => {
    transactionRows.length = 0;
    transactionRows.push(
      { id: '1', symbol: 'TCS', type: 'BUY', quantity: 10, price: 100, date: '2024-01-01' },
      { id: '2', symbol: 'EPFFUND', type: 'BUY', quantity: 100, price: 10, date: '2020-01-01' },
    );
    priceRows.length = 0;
    priceRows.push({ symbol: 'TCS', price: 200 }, { symbol: 'EPFFUND', price: 11 });
    metadataRows.length = 0;
    metadataRows.push({ symbol: 'EPFFUND', geography: 'India', sector: 'PPF / EPF' });

    const { result } = renderHook(() => usePortfolio());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summary.xirr).not.toBeNull();
    expect(result.current.summary.xirrExPf).not.toBeNull();
    expect(result.current.summary.xirrExPf).not.toBe(result.current.summary.xirr);
  });
});
