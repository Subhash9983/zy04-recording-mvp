import { FastifyPluginAsync } from 'fastify';

export const deviceTimeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/sca/device/cloud_time', async (_request, reply) => {
    const responseBody = JSON.stringify({
      code: 0,
      data: {
        create_time: Date.now()
      }
    });

    return reply
      .status(200)
      .type('application/json; charset=utf-8')
      .header('Content-Length', Buffer.byteLength(responseBody))
      .send(responseBody);
  });
};
