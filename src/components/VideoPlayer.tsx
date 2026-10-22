import {useState, type CSSProperties, type ReactNode} from 'react';
import {resolveVideoSource} from '@/lib/videoSource';

export interface VideoPlayerProps {
  src?: string | null;
  title: string;
  className?: string;
  style?: CSSProperties;
  unavailable?: ReactNode;
}

export default function VideoPlayer({src, title, className, style, unavailable = 'Video unavailable'}: VideoPlayerProps) {
  const source = resolveVideoSource(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!source || failedSrc === source.src) {
    return <div className={className} style={{display: 'grid', placeItems: 'center', color: 'inherit', ...style}} role="status">{unavailable}</div>;
  }
  const playerStyle = {width: '100%', height: '100%', border: 0, display: 'block', ...style};
  return source.kind === 'embed'
    ? <iframe key={source.src} src={source.src} title={title} className={className} style={playerStyle}
        allow="fullscreen; picture-in-picture" allowFullScreen onError={() => setFailedSrc(source.src)} />
    : <video key={source.src} src={source.src} aria-label={title} className={className}
        style={{...playerStyle, objectFit: 'contain'}} controls playsInline preload="metadata"
        onError={() => setFailedSrc(source.src)} />;
}
