import { FastifyPluginAsync } from 'fastify';
import {
  OtaRequestValidationError,
  otaService,
  validateOtaRequest
} from '../services/otaService.js';

export const otaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/ota/v1/fetch_new_firmware', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    try {
      const input = validateOtaRequest(request.body);
      const latestFirmware = await otaService.fetch(input);
      return reply.status(200).send({
        sn: input.sn,
        device_model: input.deviceModel,
        current_firmware: input.currentFirmware,
        latest_firmware: latestFirmware
      });
    } catch (error) {
      if (error instanceof OtaRequestValidationError) {
        return reply.status(400).send({ code: 400, msg: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ code: 500, msg: 'Failed to fetch firmware' });
    }
  });
};
