/** Content is keyed by explicitly resolved portal identity; unknown/missing means null. */
export function getDialerBrandContent(portalUrl: string | null | undefined, content?: {coaching_url?: string | null; dialer_training_url?: string | null}) {
  const matches = portalUrl === 'https://app.policyprinter.io';
  return {
    coachingUrl: content && Object.prototype.hasOwnProperty.call(content, 'coaching_url') ? content.coaching_url || null : matches ? 'https://calendly.com/chrispolicyprinter/30min' : null,
    trainingVideoUrl: content && Object.prototype.hasOwnProperty.call(content, 'dialer_training_url') ? content.dialer_training_url || null : matches ? 'https://www.loom.com/embed/9b8f5ea326e84e838e37feccbba71630' : null
  };
}
