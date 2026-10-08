import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RouteTitle } from '@/components/RouteTitle';
import { DEFAULT_TITLE, PAGE_TITLES, titleForPath } from '@/lib/pageTitles';
import { navGroups } from '@/components/navConfig';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteTitle />
    </MemoryRouter>,
  );

describe('route document titles', () => {
  it('sets a page-specific tab title', () => {
    renderAt('/taxes');
    expect(document.title).toBe('Tax Report · Blackcrest');
  });

  it('ignores query strings and trailing slashes', () => {
    expect(titleForPath('/dev-zone/')).toBe('Dev Zone · Blackcrest');
    renderAt('/dev-zone?tab=security');
    expect(document.title).toBe('Dev Zone · Blackcrest');
  });

  it('falls back to the default title for the landing page and unknown routes', () => {
    renderAt('/');
    expect(document.title).toBe(DEFAULT_TITLE);
    renderAt('/nope');
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it('has a title for every route in the nav, so a new page cannot silently ship without one', () => {
    for (const item of navGroups.flatMap((g) => g.items)) {
      expect(PAGE_TITLES[item.to], item.to).toBeTruthy();
    }
  });
});
