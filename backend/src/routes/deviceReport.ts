import { FastifyPluginAsync } from 'fastify';
import {
  deviceReportService,
  parseReportInfo,
  ReportInfoValidationError
} from '../services/deviceReportService.js';

export const deviceReportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/sca/device/reportinfo', { bodyLimit: 1_000_000 }, async (request, reply) => {
    try {
      const report = parseReportInfo(request.body);
      await deviceReportService.ingest(report);
      return reply.status(200).send({ code: 0 });
    } catch (error) {
      if (error instanceof ReportInfoValidationError) {
        return reply.status(400).send({ code: 400, msg: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ code: 500, msg: 'Failed to ingest device report' });
    }
  });
};
