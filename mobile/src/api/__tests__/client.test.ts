jest.mock('expo-secure-store', () => ({
  getItem: () => null,
  setItem: () => {},
  deleteItemAsync: async () => {},
}));

/* eslint-disable import/first */
import { onUnauthorized, setToken } from '../../auth';
import { api, ApiError, errorDetail } from '../client';
/* eslint-enable import/first */

const reply = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });

test('a 401 signs out only the session that sent the request', async () => {
  const signedOut = jest.fn();
  const off = onUnauthorized(signedOut);
  let answer!: (r: unknown) => void;
  globalThis.fetch = jest.fn(() => new Promise((r) => (answer = r))) as unknown as typeof fetch;

  setToken('old');
  const stale = api.tiers();
  setToken('new'); // signed in again while the old request was in flight
  answer(reply(401, { detail: 'expired' }));
  await expect(stale).rejects.toBeInstanceOf(ApiError);
  expect(signedOut).not.toHaveBeenCalled();

  const current = api.tiers();
  answer(reply(401, { detail: 'expired' }));
  await expect(current).rejects.toMatchObject({ status: 401 });
  expect(signedOut).toHaveBeenCalledTimes(1);

  // An explicit token (login before it is committed) never signs anyone out.
  const probe = api.athlete('a1', 'pending');
  answer(reply(401, null));
  await expect(probe).rejects.toBeInstanceOf(ApiError);
  expect((globalThis.fetch as jest.Mock).mock.calls[2][1].headers.Authorization).toBe('Bearer pending');
  expect(signedOut).toHaveBeenCalledTimes(1);
  off();
});

test('422 validation details become a readable reason', async () => {
  const body = {
    detail: [
      { loc: ['body', 0, 'reps'], msg: 'Input should be greater than or equal to 0', type: 'greater_than_equal' },
      { loc: ['body', 0, 'load_kg'], msg: 'Input should be a valid number', type: 'float_parsing' },
    ],
  };
  expect(errorDetail(body, 422)).toBe(
    'reps: Input should be greater than or equal to 0; load_kg: Input should be a valid number',
  );
  expect(errorDetail({ detail: [{ loc: ['body'], msg: 'Field required' }] }, 422)).toBe('Field required');
  expect(errorDetail({ detail: 'E-mail já cadastrado.' }, 409)).toBe('E-mail já cadastrado.');
  expect(errorDetail(null, 502)).toBe('HTTP 502');

  globalThis.fetch = jest.fn(async () => reply(422, body)) as unknown as typeof fetch;
  await expect(api.postLogs('a1', [])).rejects.toMatchObject({ status: 422, message: expect.stringContaining('reps:') });
});
