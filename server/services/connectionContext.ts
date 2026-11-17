import { isIP } from 'node:net';
import type { Request } from 'express';

export interface NormalizedClientIp {
  ip: string | null;
  version: 4 | 6 | null;
  isValid: boolean;
  isPrivateOrLoopback: boolean;
}

export interface ServerConnectionContext {
  ipInfo: NormalizedClientIp;
  ipSource: 'express_trusted_ip' | 'socket_remote_address' | 'unavailable';
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';
  operatingSystem: string;
  browser: string;
  userAgentSummary: string;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value >>> 0;
}

export function isPrivateOrReservedIp(ip: string, version: 4 | 6): boolean {
  if (version === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    const first = (n >>> 24) & 0xff;
    const second = (n >>> 16) & 0xff;

    // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
    if (first === 0 || first === 10 || first === 127) return true;
    // 100.64.0.0/10 (CGNAT)
    if (first === 100 && second >= 64 && second <= 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (first === 169 && second === 254) return true;
    // 172.16.0.0/12
    if (first === 172 && second >= 16 && second <= 31) return true;
    // 192.168.0.0/16
    if (first === 192 && second === 168) return true;
    // Multicast / reserved >= 224.0.0.0
    if (first >= 224) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // Unique Local Address (fc00::/7)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower) || /^f[cd][0-9a-f]{0,2}:/i.test(lower)) {
    const firstHex = lower.split(':')[0];
    if (firstHex.length >= 2) {
      const byte0 = Number.parseInt(firstHex.padStart(4, '0').slice(0, 2), 16);
      if ((byte0 & 0xfe) === 0xfc) return true;
      // Link-local (fe80::/10)
      if ((byte0 & 0xff) === 0xfe) {
        const byte1 = Number.parseInt(firstHex.padStart(4, '0').slice(2, 4), 16);
        if ((byte1 & 0xc0) === 0x80) return true;
      }
    }
  }
  // Multicast (ff00::/8)
  if (lower.startsWith('ff')) return true;
  return false;
}

export function normalizeClientIp(rawIp?: string | null): NormalizedClientIp {
  if (!rawIp || typeof rawIp !== 'string') {
    return { ip: null, version: null, isValid: false, isPrivateOrLoopback: false };
  }

  let candidate = rawIp.trim();
  if (!candidate) {
    return { ip: null, version: null, isValid: false, isPrivateOrLoopback: false };
  }

  // Strip IPv6 bracket notation [addr]:port
  if (candidate.startsWith('[')) {
    const closeBracket = candidate.indexOf(']');
    if (closeBracket > 1) {
      candidate = candidate.slice(1, closeBracket);
    }
  }

  // Strip IPv6 zone index (%eth0)
  const zoneIdx = candidate.indexOf('%');
  if (zoneIdx > 0) {
    candidate = candidate.slice(0, zoneIdx);
  }

  // Strip IPv4-mapped IPv6 prefix ::ffff:
  if (candidate.toLowerCase().startsWith('::ffff:')) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) {
      candidate = mapped;
    }
  }

  // Strip port from IPv4:port if present (single colon)
  if (candidate.includes('.') && candidate.indexOf(':') === candidate.lastIndexOf(':') && candidate.includes(':')) {
    candidate = candidate.slice(0, candidate.indexOf(':'));
  }

  const detectedVersion = isIP(candidate);
  if (detectedVersion !== 4 && detectedVersion !== 6) {
    return { ip: null, version: null, isValid: false, isPrivateOrLoopback: false };
  }

  const version = detectedVersion as 4 | 6;
  return {
    ip: candidate,
    version,
    isValid: true,
    isPrivateOrLoopback: isPrivateOrReservedIp(candidate, version),
  };
}

export function resolveServerRequestIp(req: Pick<Request, 'ip' | 'socket'>): {
  ipInfo: NormalizedClientIp;
  ipSource: 'express_trusted_ip' | 'socket_remote_address' | 'unavailable';
} {
  if (typeof req.ip === 'string' && req.ip.trim()) {
    const normalized = normalizeClientIp(req.ip);
    if (normalized.isValid) {
      return { ipInfo: normalized, ipSource: 'express_trusted_ip' };
    }
  }

  const remoteAddress = req.socket?.remoteAddress;
  if (typeof remoteAddress === 'string' && remoteAddress.trim()) {
    const normalized = normalizeClientIp(remoteAddress);
    if (normalized.isValid) {
      return { ipInfo: normalized, ipSource: 'socket_remote_address' };
    }
  }

  return {
    ipInfo: { ip: null, version: null, isValid: false, isPrivateOrLoopback: false },
    ipSource: 'unavailable',
  };
}

export function parseUserAgentSummary(rawUserAgent?: string | null): {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';
  operatingSystem: string;
  browser: string;
  userAgentSummary: string;
} {
  const ua = typeof rawUserAgent === 'string' ? rawUserAgent.trim() : '';
  if (!ua) {
    return {
      deviceType: 'Unknown',
      operatingSystem: 'Unknown',
      browser: 'Unknown',
      userAgentSummary: 'Unavailable',
    };
  }

  let deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown' = 'Desktop';
  if (/bot|crawler|spider|curl|wget|python-requests|postman/i.test(ua)) {
    deviceType = 'Bot';
  } else if (/ipad|tablet|playbook|silk/i.test(ua)) {
    deviceType = 'Tablet';
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) {
    deviceType = 'Mobile';
  }

  let operatingSystem = 'Unknown';
  if (/windows nt/i.test(ua)) operatingSystem = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) operatingSystem = 'iOS';
  else if (/android/i.test(ua)) operatingSystem = 'Android';
  else if (/mac os x|macintosh/i.test(ua)) operatingSystem = 'macOS';
  else if (/linux/i.test(ua)) operatingSystem = 'Linux';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';

  return {
    deviceType,
    operatingSystem,
    browser,
    userAgentSummary: ua.slice(0, 220),
  };
}

export function extractServerConnectionContext(req: Request): ServerConnectionContext {
  const { ipInfo, ipSource } = resolveServerRequestIp(req);
  const ua = parseUserAgentSummary(req.header('user-agent'));
  return {
    ipInfo,
    ipSource,
    ...ua,
  };
}
