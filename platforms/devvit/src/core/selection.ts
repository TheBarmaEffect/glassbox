const CONSENT_FIELD_PREFIX = 'consentFor_';
const REDDIT_CONTENT_ID = /^t[13]_[a-z0-9]+$/i;

export type RedditContentId = `t1_${string}` | `t3_${string}`;

export function consentFieldName(targetId: string): string {
  if (!REDDIT_CONTENT_ID.test(targetId)) {
    throw new Error('Only Reddit posts and comments can be audited.');
  }
  return `${CONSENT_FIELD_PREFIX}${targetId}`;
}

export function consentedTargetId(
  values: Record<string, unknown>,
): RedditContentId | undefined {
  const consentKeys = Object.entries(values).filter(
    ([name, value]) => name.startsWith(CONSENT_FIELD_PREFIX) && value === true,
  );
  if (consentKeys.length !== 1) return undefined;

  const targetId = consentKeys[0]?.[0].slice(CONSENT_FIELD_PREFIX.length);
  return targetId && REDDIT_CONTENT_ID.test(targetId)
    ? (targetId as RedditContentId)
    : undefined;
}
