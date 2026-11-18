import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  'src/screens/reader/components/WebViewReader.tsx',
  'utf8',
);
const callback = source
  .slice(
    source.indexOf('onLoadEnd={() => {') + 'onLoadEnd={'.length,
    source.indexOf('onMessage='),
  )
  .trim()
  .replace(/}\s*$/, '');

const indexSource = readFileSync('assets/reader/js/index.js', 'utf8');
const toolSource = indexSource.slice(
  indexSource.indexOf('const ToolWrapper ='),
  indexSource.indexOf('const ImageModal ='),
);
const seekbarClass = (hidden: boolean) =>
  runInNewContext(`${toolSource}; ToolWrapper().class()`, {
    reader: {
      hidden: { val: hidden },
      generalSettings: { val: { verticalSeekbar: false } },
    },
    van: { derive: (fn: () => boolean) => ({ val: fn() }) },
    div: (attributes: unknown) => attributes,
    Scrollbar: () => null,
  });

describe('chrome state after document load', () => {
  it.each(['next', 'previous'])('restores the seekbar after %s chapter', () => {
    const page = {
      reader: { hidden: { val: true }, batteryLevel: { val: 0 } },
    };
    const context = {
      webViewRef: {
        current: {
          injectJavaScript: (script: string) =>
            runInNewContext(script, { window: page }),
        },
      },
      chromeHidden: false,
      lastKnownBatteryLevel: 100,
      adjacentChapterScriptRef: { current: 'true;' },
      searchTextRef: { current: '' },
      autoStartTTSRef: { current: false },
    };
    runInNewContext(`(${callback})()`, context);
    expect(page.reader.hidden.val).toBe(false);
    expect(seekbarClass(page.reader.hidden.val)).not.toContain('hidden');
  });
  it('keeps the seekbar hidden during search', () => {
    const page = {
      reader: { hidden: { val: false }, batteryLevel: { val: 0 } },
    };
    runInNewContext(`(${callback})()`, {
      webViewRef: {
        current: {
          injectJavaScript: (script: string) =>
            runInNewContext(script, { window: page }),
        },
      },
      chromeHidden: true,
      lastKnownBatteryLevel: 100,
      adjacentChapterScriptRef: { current: 'true;' },
      searchTextRef: { current: '' },
      autoStartTTSRef: { current: false },
    });
    expect(page.reader.hidden.val).toBe(true);
    expect(seekbarClass(page.reader.hidden.val)).toContain('hidden');
  });
});
