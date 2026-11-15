import type { ErrorEvent } from '@sentry/react-native';

import { crashReportingOn, scrubBreadcrumb, scrubEvent, stripQuery } from '../crash';

describe('crash reporting', () => {
  it('stays off without a DSN', () => {
    expect(crashReportingOn).toBe(false);
  });

  it('strips query strings and fragments', () => {
    expect(stripQuery('https://api.x/sets?day=2026-11-15&w=80#a')).toBe('https://api.x/sets');
    expect(stripQuery('https://api.x/health')).toBe('https://api.x/health');
  });

  it('drops console breadcrumbs and keeps only method, path and status of requests', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'hr 172' })).toBeNull();
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'POST', url: 'https://api.x/sets?id=9', status_code: 500, request_body: '{"weight":80}' },
    });
    expect(crumb?.data).toEqual({ method: 'POST', url: 'https://api.x/sets', status_code: 500 });
  });

  it('removes user, body, headers and query from events', () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: '42', email: 'a@b.c' },
      request: { url: 'https://api.x/me?token=t', data: '{"hr":[150]}', headers: { Authorization: 'Bearer t' },
        cookies: { s: '1' }, query_string: 'token=t' },
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: 'https://api.x/me' });
  });
});
