import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROXIMATE_LOCATION_NOTICE,
  IP_GEOLOCATION_ENDPOINT,
  IpGeolocationService,
} from './ipGeolocation';

test('successful IPv4 lookup parses official IPGeolocation.io v3 response, caches result, and marks VPN/proxy/Tor unavailable', async () => {
  let fetchCalls = 0;
  let capturedUrl = '';

  const service = new IpGeolocationService({
    apiKey: 'secret-test-key-123',
    enableDbCache: false,
    fetchImpl: (async (input: RequestInfo | URL) => {
      fetchCalls += 1;
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          ip: '8.8.8.8',
          location: {
            country_code2: 'US',
            country_name: 'United States',
            state_prov: 'California',
            city: 'Mountain View',
          },
          asn: {
            as_number: 'AS15169',
            organization: 'Google LLC',
          },
          company: {
            name: 'Google LLC',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch,
  });

  const first = await service.lookupIp('8.8.8.8');
  assert.equal(fetchCalls, 1);
  assert.ok(capturedUrl.startsWith(IP_GEOLOCATION_ENDPOINT));
  assert.ok(capturedUrl.includes('ip=8.8.8.8'));
  assert.equal(first.status, 'success');
  assert.equal(first.cached, false);
  assert.equal(first.ipAddress, '8.8.8.8');
  assert.equal(first.ipVersion, 4);
  assert.equal(first.countryCode, 'US');
  assert.equal(first.countryName, 'United States');
  assert.equal(first.regionState, 'California');
  assert.equal(first.approximateCity, 'Mountain View');
  assert.equal(first.isp, 'Google LLC');
  assert.equal(first.asn, 'AS15169');
  assert.equal(first.isGeolocationApproximate, true);
  assert.equal(first.locationNotice, APPROXIMATE_LOCATION_NOTICE);

  // Free plan must honestly represent VPN/proxy/Tor checks as unavailable (never false)
  assert.equal(first.securityChecks.vpn.status, 'unavailable');
  assert.equal(first.securityChecks.vpn.detected, null);
  assert.equal(first.securityChecks.proxy.status, 'unavailable');
  assert.equal(first.securityChecks.proxy.detected, null);
  assert.equal(first.securityChecks.residentialProxy.status, 'unavailable');
  assert.equal(first.securityChecks.residentialProxy.detected, null);
  assert.equal(first.securityChecks.datacenterProxy.status, 'unavailable');
  assert.equal(first.securityChecks.datacenterProxy.detected, null);
  assert.equal(first.securityChecks.tor.status, 'unavailable');
  assert.equal(first.securityChecks.tor.detected, null);

  // Subsequent lookup uses cache and saves API credits
  const second = await service.lookupIp('::ffff:8.8.8.8');
  assert.equal(fetchCalls, 1);
  assert.equal(second.status, 'cached');
  assert.equal(second.cached, true);
  assert.equal(second.countryCode, 'US');
});

test('supports IPv6 public IP addresses cleanly', async () => {
  const service = new IpGeolocationService({
    apiKey: 'secret-test-key-123',
    enableDbCache: false,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          ip: '2001:4860:4860::8888',
          location: {
            country_code2: 'US',
            country_name: 'United States',
            state_prov: 'California',
            city: 'Mountain View',
          },
          asn: {
            as_number: 'AS15169',
            organization: 'Google LLC',
          },
        }),
        { status: 200 }
      )) as typeof fetch,
  });

  const result = await service.lookupIp('2001:4860:4860::8888');
  assert.equal(result.status, 'success');
  assert.equal(result.ipVersion, 6);
  assert.equal(result.ipAddress, '2001:4860:4860::8888');
  assert.equal(result.asn, 'AS15169');
});

test('handles missing API key gracefully without making upstream requests', async () => {
  let called = false;
  const service = new IpGeolocationService({
    apiKey: null,
    enableDbCache: false,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const result = await service.lookupIp('8.8.8.8');
  assert.equal(called, false);
  assert.equal(result.status, 'missing_api_key');
  assert.equal(result.ipAddress, '8.8.8.8');
  assert.equal(result.securityChecks.vpn.status, 'unavailable');
});

test('rejects invalid IP addresses and skips private/loopback IPs without API calls', async () => {
  let called = false;
  const service = new IpGeolocationService({
    apiKey: 'secret-test-key-123',
    enableDbCache: false,
    fetchImpl: (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const invalid = await service.lookupIp('999.999.999.999');
  assert.equal(invalid.status, 'invalid_ip');
  assert.equal(invalid.ipAddress, null);

  const loopback = await service.lookupIp('127.0.0.1');
  assert.equal(loopback.status, 'private_ip');
  assert.equal(loopback.ipVersion, 4);

  const v6Loopback = await service.lookupIp('::1');
  assert.equal(v6Loopback.status, 'private_ip');
  assert.equal(v6Loopback.ipVersion, 6);

  assert.equal(called, false);
});

test('handles provider timeout gracefully without throwing or leaking API keys', async () => {
  const apiKey = 'super-secret-ipgeo-key';
  const service = new IpGeolocationService({
    apiKey,
    timeoutMs: 1200,
    enableDbCache: false,
    fetchImpl: (async () => {
      const err = new Error(`Timeout requesting ${IP_GEOLOCATION_ENDPOINT}?apiKey=${apiKey}`);
      err.name = 'TimeoutError';
      throw err;
    }) as typeof fetch,
  });

  const result = await service.lookupIp('1.1.1.1');
  assert.equal(result.status, 'timeout');
  assert.equal(result.ipAddress, '1.1.1.1');
  assert.ok(result.error && !result.error.includes(apiKey));
  assert.equal(result.securityChecks.vpn.status, 'unavailable');
});

test('handles HTTP 401/429 provider error responses cleanly and scrubs secrets from error details', async () => {
  const apiKey = 'super-secret-ipgeo-key';
  const service = new IpGeolocationService({
    apiKey,
    enableDbCache: false,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          message: `You have exceeded daily limit for apiKey=${apiKey}`,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch,
  });

  const result = await service.lookupIp('1.1.1.1');
  assert.equal(result.status, 'provider_error');
  assert.ok(result.error && !result.error.includes(apiKey));
  assert.equal(service.getCacheSize(), 0);
});
