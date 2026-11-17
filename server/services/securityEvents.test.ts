import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { parseUserAgentSummary, resolveServerRequestIp } from './connectionContext';
import { APPROXIMATE_LOCATION_NOTICE, IpGeolocationService } from './ipGeolocation';
import {
  captureAndRecordAuthSecurityEvent,
  clearRuntimeSecurityEvents,
  getRuntimeSecurityEvents,
} from './securityEvents';

function mockRequest(options: {
  ip?: string;
  remoteAddress?: string;
  userAgent?: string;
  body?: Record<string, unknown>;
}): Request {
  return {
    ip: options.ip,
    socket: { remoteAddress: options.remoteAddress } as Request['socket'],
    body: options.body ?? {},
    header(name: string) {
      if (name.toLowerCase() === 'user-agent') {
        return options.userAgent ?? '';
      }
      return undefined;
    },
  } as unknown as Request;
}

test('resolveServerRequestIp uses Express trusted req.ip and ignores spoofable client body fields', () => {
  const req = mockRequest({
    ip: '::ffff:203.0.113.45',
    remoteAddress: '10.0.0.5',
    body: { ip: '8.8.8.8', ipAddress: '1.1.1.1' },
  });

  const resolved = resolveServerRequestIp(req);
  assert.equal(resolved.ipSource, 'express_trusted_ip');
  assert.equal(resolved.ipInfo.ip, '203.0.113.45');
  assert.equal(resolved.ipInfo.version, 4);
});

test('parseUserAgentSummary classifies device type, OS, and browser cleanly', () => {
  const ua = parseUserAgentSummary(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );
  assert.equal(ua.deviceType, 'Desktop');
  assert.equal(ua.operatingSystem, 'macOS');
  assert.equal(ua.browser, 'Chrome');
});

test('authentication security capture succeeds even when IPGeolocation.io is unavailable or times out', async () => {
  clearRuntimeSecurityEvents();

  const failingIpService = new IpGeolocationService({
    apiKey: 'secret-test-key',
    enableDbCache: false,
    fetchImpl: (async () => {
      throw new Error('Upstream network unreachable');
    }) as typeof fetch,
  });

  const req = mockRequest({
    ip: '198.51.100.12',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

  const event = await captureAndRecordAuthSecurityEvent({
    req,
    eventType: 'login_success',
    userId: '11111111-2222-3333-4444-555555555555',
    identifierAttempted: 'user@example.com',
    ipService: failingIpService,
    persistToDb: false,
  });

  assert.equal(event.eventType, 'login_success');
  assert.equal(event.ipAddress, '198.51.100.12');
  assert.equal(event.ipIntelStatus, 'provider_error');
  assert.equal(event.deviceType, 'Mobile');
  assert.equal(event.operatingSystem, 'iOS');
  assert.equal(event.browser, 'Safari');
  assert.equal(event.isGeolocationApproximate, true);
  assert.equal(event.locationNotice, APPROXIMATE_LOCATION_NOTICE);
  assert.equal(event.vpnDetectionStatus, 'unavailable');
  assert.equal(event.proxyDetectionStatus, 'unavailable');
  assert.equal(event.torDetectionStatus, 'unavailable');
  assert.equal(event.isVpn, null);
  assert.equal(event.isProxy, null);
  assert.equal(event.isTor, null);

  const recorded = getRuntimeSecurityEvents(10);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].id, event.id);
});
