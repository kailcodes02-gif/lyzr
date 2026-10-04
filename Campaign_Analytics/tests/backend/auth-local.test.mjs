// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { localLogin, verifyLocalToken, localUsers, requireUser } from '../../../functions/api/ca/_lib/auth.js';

const env = { CA_LOCAL_USERS: 'isha@whitepath.in:secret-one, other@x.com:pw2', CA_CRON_SECRET: 'cron-secret-for-tests' };

test('local sign-in: right password gives a token that requireUser accepts; wrong password, wrong secret and expiry do not', async () => {
  assert.deepEqual([...localUsers(env).keys()], ['isha@whitepath.in', 'other@x.com']);
  assert.equal(await localLogin(env, 'isha@whitepath.in', 'nope'), null);
  assert.equal(await localLogin(env, 'nobody@x.com', 'secret-one'), null);
  const r = await localLogin(env, 'Isha@WhitePath.in ', 'secret-one');
  assert.ok(r.token.startsWith('ca1.')); assert.equal(r.email, 'isha@whitepath.in');
  const u = await verifyLocalToken(env, r.token); assert.equal(u.email, 'isha@whitepath.in'); assert.equal(u.name, 'Isha');
  assert.equal(await verifyLocalToken({ ...env, CA_CRON_SECRET: 'other' }, r.token), null);
  assert.equal(await verifyLocalToken(env, r.token.slice(0, -2) + 'xx'), null);
  const who = await requireUser({ headers: new Headers({ Authorization: 'Bearer ' + r.token }) }, env, { editors: ['isha@whitepath.in'] });
  assert.equal(who.email, 'isha@whitepath.in'); assert.equal(who.isEditor, true);
  // expired payload
  const [, payload] = r.token.split('.');
  const old = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); old.x = Date.now() - 1000;
  const expiredPayload = Buffer.from(JSON.stringify(old)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await verifyLocalToken(env, `ca1.${expiredPayload}.${r.token.split('.')[2]}`), null);
  assert.equal(await requireUser({ headers: new Headers({ Authorization: 'Bearer ca1.bad.bad' }) }, env), null);
});
