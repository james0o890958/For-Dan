-- 005_security_events_and_ip_intelligence.sql
-- Prepares versioned database structures for authentication security monitoring
-- and IP intelligence caching (IPGeolocation.io v3).
-- Security guarantees:
--   1. Customer, anonymous, and finance_admin roles have zero access to IP intelligence and security events.
--   2. Security events block all DELETEs and ad-hoc UPDATEs; only purpose-built retention anonymization
--      of expired PII fields is allowed via anonymize_expired_auth_security_events().
--   3. IP geolocation is stored explicitly as approximate.
--   4. VPN / proxy / residential proxy / Tor checks default to 'unavailable' (NULL detection)
--      unless a supported paid plan or security provider is active.

CREATE TABLE IF NOT EXISTS public.auth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('register', 'login_success', 'login_failure')),
  user_id UUID,
  identifier_attempted TEXT,
  ip_address INET,
  ip_version SMALLINT CHECK (ip_version IN (4, 6)),
  ip_source VARCHAR(32) NOT NULL DEFAULT 'express_trusted_ip',
  is_geolocation_approximate BOOLEAN NOT NULL DEFAULT TRUE,
  country_code VARCHAR(8),
  country_name TEXT,
  region_state TEXT,
  approximate_city TEXT,
  isp TEXT,
  asn TEXT,
  asn_organization TEXT,
  device_type VARCHAR(32),
  operating_system VARCHAR(64),
  browser VARCHAR(64),
  user_agent_summary TEXT,
  ip_intel_provider VARCHAR(64) NOT NULL DEFAULT 'ipgeolocation.io',
  ip_intel_status VARCHAR(32) NOT NULL CHECK (ip_intel_status IN (
    'success',
    'cached',
    'missing_api_key',
    'invalid_ip',
    'private_ip',
    'timeout',
    'provider_error',
    'unavailable'
  )),
  ip_intel_error TEXT,
  vpn_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (vpn_detection_status IN ('unavailable', 'supported')),
  proxy_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (proxy_detection_status IN ('unavailable', 'supported')),
  tor_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (tor_detection_status IN ('unavailable', 'supported')),
  is_vpn BOOLEAN,
  is_proxy BOOLEAN,
  is_residential_proxy BOOLEAN,
  is_datacenter_proxy BOOLEAN,
  is_tor BOOLEAN,
  location_notice TEXT NOT NULL DEFAULT 'IP-based geolocation is approximate and does not represent a precise physical location.',
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  anonymized_at TIMESTAMPTZ,
  anonymization_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE public.auth_security_events
    DROP CONSTRAINT IF EXISTS auth_security_events_user_id_fkey;

  ALTER TABLE public.auth_security_events
    ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS anonymization_reason TEXT;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_security_events_created_at
  ON public.auth_security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_user_id
  ON public.auth_security_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_ip_address
  ON public.auth_security_events (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_retention
  ON public.auth_security_events (retention_expires_at)
  WHERE anonymized_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_auth_security_events_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Records in auth_security_events cannot be deleted; use retention anonymization for expired PII.';
  END IF;

  IF current_setting('exchange.retention_op', true) <> 'anonymize_expired_security_events' THEN
    RAISE EXCEPTION 'Records in auth_security_events are immutable and cannot be modified outside retention anonymization.';
  END IF;

  IF OLD.anonymized_at IS NOT NULL OR OLD.retention_expires_at > NOW() THEN
    RAISE EXCEPTION 'Only un-anonymized, retention-expired auth_security_events rows may be anonymized.';
  END IF;

  IF NEW.anonymized_at IS NULL
     OR NULLIF(BTRIM(COALESCE(NEW.anonymization_reason, '')), '') IS NULL
     OR NEW.identifier_attempted IS NOT NULL
     OR NEW.ip_address IS NOT NULL
     OR NEW.region_state IS NOT NULL
     OR NEW.approximate_city IS NOT NULL
     OR NEW.user_agent_summary IS DISTINCT FROM 'REDACTED_RETENTION'
     OR NEW.ip_intel_error IS NOT NULL THEN
    RAISE EXCEPTION 'Retention anonymization must scrub all PII fields and record anonymized_at and anonymization_reason.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.ip_version IS DISTINCT FROM OLD.ip_version
     OR NEW.ip_source IS DISTINCT FROM OLD.ip_source
     OR NEW.is_geolocation_approximate IS DISTINCT FROM OLD.is_geolocation_approximate
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.country_name IS DISTINCT FROM OLD.country_name
     OR NEW.isp IS DISTINCT FROM OLD.isp
     OR NEW.asn IS DISTINCT FROM OLD.asn
     OR NEW.asn_organization IS DISTINCT FROM OLD.asn_organization
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.operating_system IS DISTINCT FROM OLD.operating_system
     OR NEW.browser IS DISTINCT FROM OLD.browser
     OR NEW.ip_intel_provider IS DISTINCT FROM OLD.ip_intel_provider
     OR NEW.ip_intel_status IS DISTINCT FROM OLD.ip_intel_status
     OR NEW.vpn_detection_status IS DISTINCT FROM OLD.vpn_detection_status
     OR NEW.proxy_detection_status IS DISTINCT FROM OLD.proxy_detection_status
     OR NEW.tor_detection_status IS DISTINCT FROM OLD.tor_detection_status
     OR NEW.is_vpn IS DISTINCT FROM OLD.is_vpn
     OR NEW.is_proxy IS DISTINCT FROM OLD.is_proxy
     OR NEW.is_residential_proxy IS DISTINCT FROM OLD.is_residential_proxy
     OR NEW.is_datacenter_proxy IS DISTINCT FROM OLD.is_datacenter_proxy
     OR NEW.is_tor IS DISTINCT FROM OLD.is_tor
     OR NEW.location_notice IS DISTINCT FROM OLD.location_notice
     OR NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Retention anonymization cannot alter non-PII security telemetry or audit timestamps.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_auth_security_events ON public.auth_security_events;
CREATE TRIGGER trg_immutable_auth_security_events
  BEFORE UPDATE OR DELETE ON public.auth_security_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_auth_security_events_immutability();

CREATE OR REPLACE FUNCTION public.anonymize_expired_auth_security_events(p_max_rows INTEGER DEFAULT 1000)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_max_rows, 1000), 10000));
BEGIN
  PERFORM set_config('exchange.retention_op', 'anonymize_expired_security_events', true);

  WITH target_rows AS (
    SELECT id
    FROM public.auth_security_events
    WHERE anonymized_at IS NULL
      AND retention_expires_at <= NOW()
    ORDER BY retention_expires_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.auth_security_events e
  SET
    identifier_attempted = NULL,
    ip_address = NULL,
    region_state = NULL,
    approximate_city = NULL,
    user_agent_summary = 'REDACTED_RETENTION',
    ip_intel_error = NULL,
    anonymized_at = NOW(),
    anonymization_reason = 'scheduled_90d_retention_scrub'
  FROM target_rows tr
  WHERE e.id = tr.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM set_config('exchange.retention_op', '', true);
  RETURN v_updated;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ip_intelligence_cache (
  ip_address INET PRIMARY KEY,
  provider VARCHAR(64) NOT NULL DEFAULT 'ipgeolocation.io',
  country_code VARCHAR(8),
  country_name TEXT,
  region_state TEXT,
  approximate_city TEXT,
  isp TEXT,
  asn TEXT,
  asn_organization TEXT,
  vpn_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (vpn_detection_status IN ('unavailable', 'supported')),
  proxy_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (proxy_detection_status IN ('unavailable', 'supported')),
  tor_detection_status VARCHAR(24) NOT NULL DEFAULT 'unavailable' CHECK (tor_detection_status IN ('unavailable', 'supported')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION public.purge_expired_ip_intelligence_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.ip_intelligence_cache
  WHERE expires_at <= NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_auth_security_events_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anonymize_expired_auth_security_events(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_ip_intelligence_cache() FROM PUBLIC, anon, authenticated;

-- Strict Least-Privilege RLS & Permissions
REVOKE ALL ON TABLE
  public.auth_security_events,
  public.ip_intelligence_cache
FROM anon, authenticated;

ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_intelligence_cache ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.auth_security_events TO authenticated;

DROP POLICY IF EXISTS auth_security_events_admin_read ON public.auth_security_events;
CREATE POLICY auth_security_events_admin_read ON public.auth_security_events
  FOR SELECT TO authenticated
  USING (public.can_read_security_events());
