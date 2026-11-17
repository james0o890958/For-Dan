import { Router } from 'express';
import { getEnvConfig } from '../config';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  APPROXIMATE_LOCATION_NOTICE,
  defaultIpGeolocationService,
  IP_GEOLOCATION_ENDPOINT,
  unavailableSecurityChecks,
} from '../services/ipGeolocation';
import { listAuthSecurityEvents, type AuthSecurityEventType } from '../services/securityEvents';

const router = Router();

router.use(requireAuth);
router.use(requireRole('super_admin', 'compliance_admin', 'operations_admin'));

router.get('/provider-status', (_req, res) => {
  const { status } = getEnvConfig();
  res.json({
    ok: true,
    provider: 'ipgeolocation.io',
    endpoint: IP_GEOLOCATION_ENDPOINT,
    configured: status.ipGeolocationConfigured,
    trustedProxyHops: status.trustedProxyHops,
    cacheEntries: defaultIpGeolocationService.getCacheSize(),
    locationNotice: APPROXIMATE_LOCATION_NOTICE,
    capabilities: {
      geolocationApproximate: status.ipGeolocationConfigured,
      ispAndAsn: status.ipGeolocationConfigured,
      vpnProxyTorDetection: unavailableSecurityChecks(),
    },
  });
});

router.get('/events', async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  const rawType = typeof req.query.eventType === 'string' ? req.query.eventType.trim() : undefined;
  const eventType =
    rawType === 'register' || rawType === 'login_success' || rawType === 'login_failure'
      ? (rawType as AuthSecurityEventType)
      : undefined;

  const data = await listAuthSecurityEvents({ limit, eventType });
  res.json({
    ok: true,
    source: data.source,
    locationNotice: APPROXIMATE_LOCATION_NOTICE,
    events: data.events,
  });
});

export default router;
