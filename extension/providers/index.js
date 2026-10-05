/**
 * Every vendor the extension knows. A provider is:
 *
 *   id, name, site, origin, homeUrl
 *   template     plan limit template (gauges, plans, messages), data only
 *   fetchUsage(http) -> {meters, plan}   vendor API -> normalized meters
 *   proxyPaths   API paths an open vendor tab may fetch for the background
 *   isActivity(path, durationMs)         did a finished page request spend quota?
 *
 * Adding a vendor: write providers/<id>/{provider,template}.js, list it here,
 * and add its origin to host_permissions in manifest.json.
 */
import claude from './claude/provider.js';

export const PROVIDERS = Object.freeze([claude]);

export function getProvider(id) {
  return PROVIDERS.find(provider => provider.id === id) ?? null;
}

export function providersForOrigin(origin) {
  return PROVIDERS.filter(provider => provider.origin === origin);
}
