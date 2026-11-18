import { runInNewContext } from 'node:vm';
import { buildReaderChromeScript } from '../buildReaderChromeScript';

it.each([
  [false, false, false],
  [true, false, true],
  [false, true, true],
  [true, true, true],
])('restores controls hidden=%s search=%s', (hidden, search, expected) => {
  const page = { reader: { hidden: { val: !expected } } };
  runInNewContext(buildReaderChromeScript(hidden, search), { window: page });
  expect(page.reader.hidden.val).toBe(expected);
});
it('tolerates a document without reader state', () => {
  expect(() =>
    runInNewContext(buildReaderChromeScript(false, false), { window: {} }),
  ).not.toThrow();
});
