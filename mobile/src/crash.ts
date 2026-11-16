// Crash and error reporting. Off unless the build sets EXPO_PUBLIC_SENTRY_DSN, so dev builds and
// forks send nothing. Like the backend (knightfall/observability.py), nothing that can carry health
// data leaves the phone: no request bodies, no query strings, no console output, no user identity.
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Drops the query string and fragment: ids and dates in URLs stay on the phone. */
export function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, '');
}

/** Console lines may print sets, weights or heart rates; network crumbs keep only method, path and status. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;
  if ((crumb.category === 'fetch' || crumb.category === 'xhr') && crumb.data) {
    const { method, url, status_code } = crumb.data as { method?: string; url?: string; status_code?: number };
    return { ...crumb, data: { method, url: url ? stripQuery(url) : undefined, status_code } };
  }
  return crumb;
}

/** Last line of defence before an error leaves the phone. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = stripQuery(event.request.url);
  }
  return event;
}

export const crashReportingOn = Boolean(DSN);

if (DSN) {
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    environment: __DEV__ ? 'development' : 'production',
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

/** Reports an error caught by the app itself (it is not sent when reporting is off). */
export function reportError(error: unknown): void {
  if (DSN) Sentry.captureException(error);
}

export const wrapRoot = Sentry.wrap;
