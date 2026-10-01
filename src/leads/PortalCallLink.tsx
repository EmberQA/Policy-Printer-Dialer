import {ExternalLink} from 'lucide-react';
import {getDialerBranding, getPortalCallUrl} from '@/branding';
import {buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';

/**
 * Opens the call on the portal (recording + call details). Renders nothing until
 * the call has been scored — only Retreaver-routed calls ever get a score_uuid.
 */
export function PortalCallLink({
	scoreUuid,
	iconOnly = false,
	className
}: {
	scoreUuid: string | null;
	iconOnly?: boolean;
	className?: string;
}) {
	if (!scoreUuid) return null;
	const label = `Open call in ${getDialerBranding().appName}`;

	return (
		<a
			href={getPortalCallUrl(scoreUuid)}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={label}
			title={label}
			className={cn(
				buttonVariants({variant: 'outline', size: iconOnly ? 'icon' : 'sm'}),
				className
			)}
		>
			<ExternalLink className="size-4" />
			{!iconOnly && 'View call'}
		</a>
	);
}
