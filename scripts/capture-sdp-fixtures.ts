// Captures real bootstrap SDPs (negotiated data channel only) from each engine.
// Run: pnpm capture-fixtures      Writes test/fixtures/sdp/{chromium,firefox,webkit}-{offer,answer}.sdp
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';

const OUT = new URL('../test/fixtures/sdp/', import.meta.url);
mkdirSync(OUT, { recursive: true });

async function gather(arg: {
  role: 'offer' | 'answer';
  remoteOffer: string | null;
}): Promise<string> {
  const { role, remoteOffer } = arg;
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true });
  if (role === 'answer' && remoteOffer) {
    await pc.setRemoteDescription({ type: 'offer', sdp: remoteOffer });
  }
  await pc.setLocalDescription();
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
    setTimeout(resolve, 4000);
  });
  const sdp = pc.localDescription?.sdp ?? '';
  pc.close();
  return sdp;
}

const engines: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

let chromiumOffer: string | null = null;
for (const [name, type] of engines) {
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.warn(`skip ${name}: ${(e as Error).message.split('\n')[0]}`);
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const offer = await page.evaluate(gather, { role: 'offer' as const, remoteOffer: null });
    writeFileSync(new URL(`${name}-offer.sdp`, OUT), offer);
    if (name === 'chromium') chromiumOffer = offer;
    console.log(`${name}: offer ${offer.length} bytes`);
    if (chromiumOffer) {
      const answer = await page.evaluate(gather, {
        role: 'answer' as const,
        remoteOffer: chromiumOffer,
      });
      writeFileSync(new URL(`${name}-answer.sdp`, OUT), answer);
      console.log(`${name}: answer (to chromium offer) ${answer.length} bytes`);
    }
  } catch (e) {
    console.warn(`${name} failed: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}
