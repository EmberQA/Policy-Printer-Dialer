import {describe, it, expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import VideoPlayer from './VideoPlayer';
import {resolveVideoSource} from '@/lib/videoSource';

const id = 'e5b8c04bca094dd8a5507925ab887002';
describe('video renderer', () => {
 it.each(['share','embed'])('renders Loom %s as iframe', route => {
  const html = renderToStaticMarkup(<VideoPlayer src={`https://www.loom.com/${route}/${id}`} title="Walkthrough" />);
  expect(html).toContain('<iframe');
  expect(html).toContain(`https://www.loom.com/embed/${id}`);
  expect(html).not.toContain('<video');
 });
 it('renders signed MP4 using native controls', () => {
  const src = 'https://storage.example/team-videos/asset.mp4?sig=example';
  expect(resolveVideoSource(src)).toEqual({kind:'file',src});
  const html = renderToStaticMarkup(<VideoPlayer src={src} title="Training" />);
  expect(html).toContain('<video');
  expect(html).toContain('controls');
  expect(html).not.toContain('<iframe');
 });
 it.each([null,'','https://example.com/page','javascript:alert(1)','https://loom.com.evil.test/embed/'+id])('unavailable source %s never substitutes a video', src => {
  const html = renderToStaticMarkup(<VideoPlayer src={src} title="Training" />);
  expect(html).toContain('Video unavailable');
  expect(html).not.toMatch(/<iframe|<video/);
 });
});
