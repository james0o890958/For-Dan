import crypto from 'node:crypto';
import type { Request } from 'express';
import { dbQuery, getDbPool } from '../db';
import { extractServerConnectionContext } from './connectionContext';
import {
  APPROXIMATE_LOCATION_NOTICE,
  defaultIpGeolocationService,
  type IpGeolocationService,
  type IpIntelligenceResult,
  type IpIntelligenceStatus,
} from './ipGeolocation';

export type AuthSecurityEventType = 'register' | 'login_success' | 'login_failure';

export interface AuthSecurityEventRecord {
  id: string;
  eventType: AuthSecurityEventType;
  userId: string | null;
  identifierAttempted: string | null;
  ipAddress: string | null;
  ipVersion: 4 | 6 | null;
  ipSource: 'express_trusted_ip' | 'socket_remote_address' | 'unavailable';
  isGeolocationApproximate: true;
  locationNotice: string;
  countryCode: string | null;
  countryName: string | null;
  regionState: string | null;
  approximateCity: string | null;
  isp: string | null;
  asn: string | null;
  asnOrganization: string | null;
  deviceType: string;
  operatingSystem: string;
  browser: string;
  userAgentSummary: string;
  ipIntelProvider: 'ipgeolocation.io';
  ipIntelStatus: IpIntelligenceStatus;
  ipIntelError: string | null;
  vpnDetectionStatus: 'unavailable';
  proxyDetectionStatus: 'unavailable';
  torDetectionStatus: 'unavailable';
  isVpn: null;
  isProxy: null;
  isResidentialProxy: null;
  isDatacenterProxy: null;
  isTor: null;
  createdAt: string;
}

const MAX_IN_MEMORY_EVENTS = 500;
const runtimeEventsBuffer: AuthSecurityEventRecord[] = [];

function sanitizeAttemptedIdentifier(raw?: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

function appendRuntimeEvent(record: AuthSecurityEventRecord) {
  runtimeEventsBuffer.unshift(record);
  if (runtimeEventsBuffer.length > MAX_IN_MEMORY_EVENTS) {
    runtimeEventsBuffer.length = MAX_IN_MEMORY_EVENTS;
  }
}

export function getRuntimeSecurityEvents(limit = 50): AuthSecurityEventRecord[] {
  return runtimeEventsBuffer.slice(0, Math.max(1, Math.min(limit, MAX_IN_MEMORY_EVENTS)));
}

export function clearRuntimeSecurityEvents(): void {
  runtimeEventsBuffer.length = 0;
}

export async function captureAndRecordAuthSecurityEvent(params: {
  req: Request;
  eventType: AuthSecurityEventType;
  userId?: string | null;
  identifierAttempted?: string | null;
  ipService?: IpGeolocationService;
  persistToDb?: boolean;
}): Promise<AuthSecurityEventRecord> {
  const ipService = params.ipService ?? defaultIpGeolocationService;
  const context = extractServerConnectionContext(params.req);

  let ipIntel: IpIntelligenceResult;
  try {
    ipIntel = await ipService.lookupIp(context.ipInfo.ip);
  } catch (err) {
    ipIntel = {
      provider: 'ipgeolocation.io',
      status: 'unavailable',
      cached: false,
      ipAddress: context.ipInfo.ip,
      ipVersion: context.ipInfo.version,
      isGeolocationApproximate: true,
      locationNotice: APPROXIMATE_LOCATION_NOTICE,
      countryCode: null,
      countryName: null,
      regionState: null,
      approximateCity: null,
      isp: null,
      asn: null,
      asnOrganization: null,
      securityChecks: {
        vpn: { status: 'unavailable', detected: null, reason: 'Provider unavailable.' },
        proxy: { status: 'unavailable', detected: null, reason: 'Provider unavailable.' },
        residentialProxy: { status: 'unavailable', detected: null, reason: 'Provider unavailable.' },
        datacenterProxy: { status: 'unavailable', detected: null, reason: 'Provider unavailable.' },
        tor: { status: 'unavailable', detected: null, reason: 'Provider unavailable.' },
      },
      error: err instanceof Error ? err.message : 'IP lookup unavailable.',
      checkedAt: new Date().toISOString(),
    };
  }

  const record: AuthSecurityEventRecord = {
    id: crypto.randomUUID(),
    eventType: params.eventType,
    userId: params.userId ?? null,
    identifierAttempted: sanitizeAttemptedIdentifier(params.identifierAttempted),
    ipAddress: context.ipInfo.ip,
    ipVersion: context.ipInfo.version,
    ipSource: context.ipSource,
    isGeolocationApproximate: true,
    locationNotice: APPROXIMATE_LOCATION_NOTICE,
    countryCode: ipIntel.countryCode,
    countryName: ipIntel.countryName,
    regionState: ipIntel.regionState,
    approximateCity: ipIntel.approximateCity,
    isp: ipIntel.isp,
    asn: ipIntel.asn,
    asnOrganization: ipIntel.asnOrganization,
    deviceType: context.deviceType,
    operatingSystem: context.operatingSystem,
    browser: context.browser,
    userAgentSummary: context.userAgentSummary,
    ipIntelProvider: 'ipgeolocation.io',
    ipIntelStatus: ipIntel.status,
    ipIntelError: ipIntel.error,
    vpnDetectionStatus: 'unavailable',
    proxyDetectionStatus: 'unavailable',
    torDetectionStatus: 'unavailable',
    isVpn: null,
    isProxy: null,
    isResidentialProxy: null,
    isDatacenterProxy: null,
    isTor: null,
    createdAt: new Date().toISOString(),
  };

  appendRuntimeEvent(record);

  if (params.persistToDb !== false && getDbPool()) {
    try {
      await dbQuery(
        `
        INSERT INTO public.auth_security_events (
          id,
          event_type,
          user_id,
          identifier_attempted,
          ip_address,
          ip_version,
          ip_source,
          is_geolocation_approximate,
          country_code,
          country_name,
          region_state,
          approximate_city,
          isp,
          asn,
          asn_organization,
          device_type,
          operating_system,
          browser,
          user_agent_summary,
          ip_intel_provider,
          ip_intel_status,
          ip_intel_error,
          vpn_detection_status,
          proxy_detection_status,
          tor_detection_status,
          is_vpn,
          is_proxy,
          is_residential_proxy,
          is_datacenter_proxy,
          is_tor,
          location_notice,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5::inet, $6, $7, TRUE,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, 'ipgeolocation.io', $19, $20,
          'unavailable', 'unavailable', 'unavailable',
          NULL, NULL, NULL, NULL, NULL,
          $21, $22::timestamptz
        )
        `,
        [
          record.id,
          record.eventType,
          record.userId,
          record.identifierAttempted,
          record.ipAddress,
          record.ipVersion,
          record.ipSource,
          record.countryCode,
          record.countryName,
          record.regionState,
          record.approximateCity,
          record.isp,
          record.asn,
          record.asnOrganization,
          record.deviceType,
          record.operatingSystem,
          record.browser,
          record.userAgentSummary,
          record.ipIntelStatus,
          record.ipIntelError,
          record.locationNotice,
          record.createdAt,
        ]
      );
    } catch {
      // Security telemetry persistence must never prevent authentication when migrations aren't applied or DB is unavailable
    }
  }

  return record;
}

export async function listAuthSecurityEvents(options: {
  limit?: number;
  eventType?: AuthSecurityEventType;
} = {}): Promise<{ source: 'database' | 'runtime'; events: AuthSecurityEventRecord[] }> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  if (getDbPool()) {
    try {
      const params: unknown[] = [];
      let whereClause = '';
      if (options.eventType) {
        params.push(options.eventType);
        whereClause = `WHERE event_type = $${params.length}`;
      }
      params.push(limit);

      const res = await dbQuery<{
        id: string;
        event_type: AuthSecurityEventType;
        user_id: string | null;
        identifier_attempted: string | null;
        ip_address: string | null;
        ip_version: 4 | 6 | null;
        ip_source: 'express_trusted_ip' | 'socket_remote_address' | 'unavailable';
        country_code: string | null;
        country_name: string | null;
        region_state: string | null;
        approximate_city: string | null;
        isp: string | null;
        asn: string | null;
        asn_organization: string | null;
        device_type: string;
        operating_system: string;
        browser: string;
        user_agent_summary: string;
        ip_intel_status: IpIntelligenceStatus;
        ip_intel_error: string | null;
        location_notice: string;
        created_at: string;
      }>(
        `
        SELECT
          id::text AS id,
          event_type,
          user_id::text AS user_id,
          identifier_attempted,
          host(ip_address) AS ip_address,
          ip_version,
          ip_source,
          country_code,
          country_name,
          region_state,
          approximate_city,
          isp,
          asn,
          asn_organization,
          device_type,
          operating_system,
          browser,
          user_agent_summary,
          ip_intel_status,
          ip_intel_error,
          location_notice,
          created_at::text AS created_at
        FROM public.auth_security_events
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length}
        `,
        params
      );

      return {
        source: 'database',
        events: res.rows.map((r) => ({
          id: r.id,
          eventType: r.event_type,
          userId: r.user_id,
          identifierAttempted: r.identifier_attempted,
          ipAddress: r.ip_address,
          ipVersion: r.ip_version,
          ipSource: r.ip_source,
          isGeolocationApproximate: true,
          locationNotice: r.location_notice,
          countryCode: r.country_code,
          countryName: r.country_name,
          regionState: r.region_state,
          approximateCity: r.approximate_city,
          isp: r.isp,
          asn: r.asn,
          asnOrganization: r.asn_organization,
          deviceType: r.device_type,
          operatingSystem: r.operating_system,
          browser: r.browser,
          userAgentSummary: r.user_agent_summary,
          ipIntelProvider: 'ipgeolocation.io',
          ipIntelStatus: r.ip_intel_status,
          ipIntelError: r.ip_intel_error,
          vpnDetectionStatus: 'unavailable',
          proxyDetectionStatus: 'unavailable',
          torDetectionStatus: 'unavailable',
          isVpn: null,
          isProxy: null,
          isResidentialProxy: null,
          isDatacenterProxy: null,
          isTor: null,
          createdAt: r.created_at,
        })),
      };
    } catch {
      // Fall back to runtime buffer if 005 migration isn't applied yet
    }
  }

  const filtered = options.eventType
    ? runtimeEventsBuffer.filter((e) => e.eventType === options.eventType)
    : runtimeEventsBuffer;

  return {
    source: 'runtime',
    events: filtered.slice(0, limit),
  };
}
