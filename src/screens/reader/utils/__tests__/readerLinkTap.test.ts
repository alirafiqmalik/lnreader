import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

type TapEvent = {
  target: { closest: (selector: string) => unknown };
  defaultPrevented: boolean;
  clientX: number;
  clientY: number;
  preventDefault: jest.Mock;
};

const loadClickHandler = () => {
  const core = readFileSync(
    join(process.cwd(), 'assets/reader/js/core.js'),
    'utf8',
  );
  const start = core.indexOf('// click handler\n(function () {');
  const closing = '\n})();';
  const end = core.indexOf(closing, start);

  if (start < 0 || end < 0) {
    throw new Error('Could not locate the reader click handler');
  }

  const clock = { now: 1_000_000 };
  const context = {
    Date: { now: () => clock.now },
    document: {} as { onclick?: (event: TapEvent) => void },
    pageReader: { ignoreClickUntil: 0 },
    reader: {
      post: jest.fn(),
      layoutWidth: 400,
      layoutHeight: 800,
      generalSettings: { val: { pageReader: false, tapToScroll: false } },
    },
    window: {},
    // An online chapter is loaded with the plugin site as its base URL.
    location: { href: 'https://www.royalroad.com/' },
  };

  runInNewContext(core.slice(start, end + closing.length), context);

  const tap = (
    onLink: boolean,
    target = '',
    href = 'https://royalroad.com/fiction/123',
    defaultPrevented = false,
  ) => {
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    const event: TapEvent = {
      target: {
        closest: () => (onLink ? { href, target, hash } : null),
      },
      defaultPrevented,
      clientX: 200,
      clientY: 400,
      preventDefault: jest.fn(),
    };
    context.document.onclick?.(event);
    return event;
  };

  return { tap, clock, post: context.reader.post };
};

describe('reader link taps', () => {
  it('lets a link open without toggling the reader controls', () => {
    const { tap, post } = loadClickHandler();

    expect(tap(true).preventDefault).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      type: 'link',
      data: { url: 'https://royalroad.com/fiction/123', target: '' },
    });
  });

  it('still toggles the controls for a tap on text', () => {
    const { tap, post } = loadClickHandler();

    tap(false);

    expect(post).toHaveBeenCalledWith({ type: 'hide' });
  });

  // The app may answer the second load request too late, and the WebView then
  // loads the linked site in place of the chapter.
  it('stops a second tap while the first one opens the link', () => {
    const { tap, clock, post } = loadClickHandler();

    tap(true);
    clock.now += 300;

    expect(tap(true).preventDefault).toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('opens a link again after the double-tap window', () => {
    const { tap, clock, post } = loadClickHandler();

    tap(true);
    clock.now += 2000;

    expect(tap(true).preventDefault).toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

it('posts a blank-target activation from a descendant image', () => {
  const { tap, post } = loadClickHandler();
  expect(tap(true, '_blank').preventDefault).toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith({
    type: 'link',
    data: { url: 'https://royalroad.com/fiction/123', target: '_blank' },
  });
});

it('lets a footnote link in the page scroll without the app', () => {
  const { tap, post } = loadClickHandler();
  const event = tap(true, '', 'https://www.royalroad.com/#note-1');
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('sends a fragment link to another page to the app', () => {
  const { tap, post } = loadClickHandler();
  const url = 'https://www.royalroad.com/fiction/123#chapters';
  expect(tap(true, '', url).preventDefault).toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith({
    type: 'link',
    data: { url, target: '' },
  });
});

it('keeps an empty fragment in the document', () => {
  const { tap, post } = loadClickHandler();
  expect(
    tap(true, '', 'https://www.royalroad.com/#').preventDefault,
  ).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
it('respects a cancelled click', () => {
  const { tap, post } = loadClickHandler();
  tap(true, '', 'https://royalroad.com/fiction/123', true);
  expect(post).not.toHaveBeenCalled();
});
it.each([
  'lnreader://refresh-chapter',
  'mailto:author@example.com',
  'intent:example',
])('debounces %s', url => {
  const { tap, clock } = loadClickHandler();
  expect(tap(true, '', url).preventDefault).not.toHaveBeenCalled();
  clock.now += 300;
  expect(tap(true, '', url).preventDefault).toHaveBeenCalled();
});
