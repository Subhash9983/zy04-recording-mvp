import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { installBufferedResponseFraming } from '../dist/app.js';

async function createTestApp() {
  const app = Fastify({ logger: false });
  installBufferedResponseFraming(app);

  app.get('/sca/device/cloud_time', async () => ({ code: 0, message: 'ready' }));
  app.get('/sca/device/config', async (_request, reply) => {
    return reply.status(400).send({ code: 400, message: 'invalid \u2713' });
  });
  app.get('/conflicting-header', async (_request, reply) => {
    return reply.header('Transfer-Encoding', 'chunked').send({ code: 0 });
  });
  app.get('/stream', async (_request, reply) => {
    return reply.type('text/plain').send(Readable.from(['streamed ', 'response']));
  });
  app.get('/no-content', async (_request, reply) => reply.status(204).send());
  app.get('/not-modified', async (_request, reply) => reply.status(304).send());

  return app;
}

test('sets Content-Length on buffered success and JSON error responses', async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  for (const path of ['/sca/device/cloud_time', '/sca/device/config']) {
    const response = await app.inject(path);
    assert.equal(response.headers['content-length'], String(Buffer.byteLength(response.body)));
    assert.equal(response.headers['transfer-encoding'], undefined);
    assert.match(response.headers['cache-control'], /(?:^|,)\s*no-transform\s*(?:,|$)/i);
  }
});

test('uses the UTF-8 byte length of the final serialized payload', async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const response = await app.inject('/sca/device/config');
  assert.notEqual(Buffer.byteLength(response.body), response.body.length);
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
});

test('removes conflicting transfer encoding from buffered responses', async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const response = await app.inject('/conflicting-header');
  assert.equal(response.headers['transfer-encoding'], undefined);
  assert.equal(response.headers['content-length'], String(Buffer.byteLength(response.body)));
});

test('leaves streams and bodyless responses to Fastify framing', async (t) => {
  const app = await createTestApp();
  t.after(() => app.close());

  const stream = await app.inject('/stream');
  assert.equal(stream.statusCode, 200);
  assert.equal(stream.body, 'streamed response');
  assert.equal(stream.headers['content-length'], undefined);

  for (const path of ['/no-content', '/not-modified']) {
    const response = await app.inject(path);
    assert.ok(response.statusCode === 204 || response.statusCode === 304);
    assert.equal(response.body, '');
  }
});
