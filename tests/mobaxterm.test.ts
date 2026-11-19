import { describe, expect, it } from 'vitest';
import { MobaHighlighterSession } from '../src/utils/mobaxterm';

const ERROR_HL = '\x1b[1;91mERROR\x1b[39;22m';
const encoder = new TextEncoder();

function run(chunks: Array<string | Uint8Array>, enabled = true): string[] {
  const session = new MobaHighlighterSession();
  return chunks.map((chunk) => session.process(chunk, enabled));
}

describe('MobaHighlighterSession', () => {
  it('highlights plain tokens when enabled', () => {
    expect(run(['disk ERROR here'])).toEqual([`disk ${ERROR_HL} here`]);
  });

  it('passes text through unchanged when disabled', () => {
    const text = 'ERROR at 10.0.0.1 on 2026-11-19 via https://example.com /etc/hosts 50%\r\n';
    expect(run([text], false)).toEqual([text]);
  });

  it('passes byte chunks through unchanged when disabled', () => {
    const text = 'FAILED: Grüße € 😀 WARNING\r\n';
    expect(run([encoder.encode(text)], false).join('')).toBe(text);
  });

  it('holds back a lone ESC at a chunk boundary', () => {
    expect(run(['abc\x1b', '[0m ERROR'])).toEqual(['abc', `\x1b[0m ${ERROR_HL}`]);
  });

  it('tracks SGR colors split across chunks and skips already-colored text', () => {
    const out = run(['ls \x1b[3', '1mERROR\x1b[0', 'm then ERROR']);
    expect(out[0]).toBe('ls ');
    expect(out[1]).toBe('\x1b[31mERROR');
    expect(out[2]).toBe(`\x1b[0m then ${ERROR_HL}`);
  });

  it('bypasses the alternate screen even when the switch is split', () => {
    const out = run(['\x1b[?10', '49h ERROR vim', '\x1b[?1049l ERROR']);
    expect(out[0]).toBe('');
    expect(out[1]).toBe('\x1b[?1049h ERROR vim');
    expect(out[2]).toBe(`\x1b[?1049l ${ERROR_HL}`);
  });

  it('never highlights inside an OSC sequence split across chunks', () => {
    const out = run(['\x1b]0;ERROR title', ' more\x1b', '\\ ERROR']);
    expect(out[0]).toBe('');
    expect(out[1]).toBe('');
    expect(out[2]).toBe(`\x1b]0;ERROR title more\x1b\\ ${ERROR_HL}`);
  });

  it('reassembles escape sequences split at every possible position', () => {
    const text = 'a \x1b[1;32mok\x1b[0m b \x1b]2;t\x07 c \x1b(B d';
    for (let cut = 1; cut < text.length; cut++) {
      expect(run([text.slice(0, cut), text.slice(cut)], false).join('')).toBe(text);
    }
  });

  it('decodes UTF-8 multi-byte characters split across byte chunks', () => {
    const bytes = encoder.encode('Grüße ');
    // 'ü' is 0xC3 0xBC; cut between its two bytes.
    const cut = encoder.encode('Gr').length + 1;
    const out = run([bytes.slice(0, cut), bytes.slice(cut), encoder.encode('ERROR')]);
    expect(out).toEqual(['Gr', 'üße ', ERROR_HL]);
    expect(out.join('')).not.toContain('\uFFFD');
  });

  it('decodes every split of 2-, 3- and 4-byte sequences without replacement characters', () => {
    const text = 'ä€😀 ERROR';
    const bytes = encoder.encode(text);
    for (let cut = 1; cut < bytes.length; cut++) {
      const out = run([bytes.slice(0, cut), bytes.slice(cut)], false).join('');
      expect(out).toBe(text);
    }
  });

  it('highlights a token that follows a split multi-byte character', () => {
    const bytes = encoder.encode('€ ERROR');
    const out = run([bytes.slice(0, 2), bytes.slice(2)]);
    expect(out).toEqual(['', `€ ${ERROR_HL}`]);
  });
});
