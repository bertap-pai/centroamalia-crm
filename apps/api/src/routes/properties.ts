import type { FastifyInstance } from 'fastify';
import { inArray, asc } from 'drizzle-orm';
import { propertyDefinitions } from '@crm/db';

export default async function propertiesRoutes(app: FastifyInstance) {
  // GET /api/properties?scope=contact|deal|both|all
  // scope=contact returns both 'contact' and 'both' scoped properties
  app.get(
    '/api/properties',
    { preHandler: app.requireAuth },
    async (req) => {
      const { scope } = req.query as { scope?: string };

      let scopes: ('contact' | 'deal' | 'both')[];
      if (!scope || scope === 'all') {
        scopes = ['contact', 'deal', 'both'];
      } else if (scope === 'contact') {
        scopes = ['contact', 'both'];
      } else if (scope === 'deal') {
        scopes = ['deal', 'both'];
      } else {
        scopes = [scope as 'contact' | 'deal' | 'both'];
      }

      return app.db
        .select()
        .from(propertyDefinitions)
        .where(inArray(propertyDefinitions.scope, scopes))
        .orderBy(asc(propertyDefinitions.position), asc(propertyDefinitions.createdAt));
    },
  );
}
