/**
 * Every vendor the extension knows. A provider is:
 *
 *   id, name, site, origin, homeUrl
 *   template     plan limit template (gauges, plans, messages), data only
 *   fetchUsage(http) -> {meters, plan}   vendor API -> normalized meters
 *   proxyPaths   API paths an open vendor tab may fetch for the background
 *   proxyHeaders request headers allowed on that route (optional)
 *   isActivity(path, durationMs)         did a finished page request spend quota?
 *   enabledByDefault, optionalPermission  monitored out of the box, or only once
 *                the user switches it on and grants its site (optional)
 *
 * Adding a vendor: write providers/<id>/{provider,template}.js and list it
 * here. A vendor in host_permissions + content_scripts is always available;
 * one marked optionalPermission asks for its site when switched on.
 */
import chatgpt from './chatgpt/provider.js';
import claude from './claude/provider.js';

export const PROVIDERS = Object.freeze([claude, chatgpt]);

/** Host pattern a provider's site needs. */
export function originPattern(provider) {
  return `${provider.origin}/*`;
}

export function getProvider(id) {
  return PROVIDERS.find(provider => provider.id === id) ?? null;
}

export function providersForOrigin(origin) {
  return PROVIDERS.filter(provider => provider.origin === origin);
}
