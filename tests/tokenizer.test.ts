import { describe, expect, it } from 'vitest';
import {
	findTokenIndexAtOffset,
	spellOut,
	tokenize,
	type Token,
	type TokenizeOptions,
} from '../src/tokenizer';

const words = (src: string, opts: Partial<TokenizeOptions> = {}): string[] =>
	tokenize(src, opts).map((t) => t.display);

const speech = (src: string, opts: Partial<TokenizeOptions> = {}): string[] =>
	tokenize(src, opts).map((t) => t.speech);

/** Source text covered by each token. */
const slices = (src: string, tokens: Token[]): string[] => tokens.map((t) => src.slice(t.start, t.end));

describe('plain text', () => {
	it('splits on whitespace and keeps punctuation attached', () => {
		expect(words('Hello, world. How are you?')).toEqual(['Hello,', 'world.', 'How', 'are', 'you?']);
	});

	it('speaks words without attached punctuation', () => {
		expect(speech('"Hello," she said.')).toEqual(['Hello', 'she', 'said']);
	});

	it('treats contractions, hyphenated words, numbers and dates as single tokens', () => {
		expect(words("Don't re-read the 3.5 pages on 14/11/2026 at 10:30am")).toEqual([
			"Don't",
			're-read',
			'the',
			'3.5',
			'pages',
			'on',
			'14/11/2026',
			'at',
			'10:30am',
		]);
	});

	it('handles empty and whitespace-only input', () => {
		expect(tokenize('')).toEqual([]);
		expect(tokenize('  \n\n\t ')).toEqual([]);
	});

	it('handles CRLF line endings', () => {
		expect(words('# Title\r\n\r\nOne two\r\n- three')).toEqual(['Title', 'One', 'two', 'three']);
	});

	it('speaks standalone dashes as "dash"', () => {
		expect(speech('wait — what')).toEqual(['wait', 'dash', 'what']);
	});
});

describe('frontmatter', () => {
	it('skips YAML frontmatter', () => {
		const src = '---\ntitle: My day\ntags: [journal]\n---\nDear diary';
		expect(words(src)).toEqual(['Dear', 'diary']);
	});

	it('skips empty frontmatter', () => {
		expect(words('---\n---\nHello')).toEqual(['Hello']);
	});

	it('does not treat a later horizontal rule as frontmatter', () => {
		expect(words('Intro\n\n---\n\nAfter')).toEqual(['Intro', 'After']);
	});

	it('keeps exact offsets after frontmatter', () => {
		const src = '---\na: 1\n---\nDear diary';
		const tokens = tokenize(src);
		expect(slices(src, tokens)).toEqual(['Dear', 'diary']);
		expect(tokens[0]?.start).toBe(src.indexOf('Dear'));
	});
});

describe('headings, lists, quotes and callouts', () => {
	it('strips heading hashes, including closing hashes', () => {
		expect(words('## Morning pages ##\nText')).toEqual(['Morning', 'pages', 'Text']);
	});

	it('does not treat a hashtag as a heading', () => {
		expect(words('#journal entry')).toEqual(['journal', 'entry']);
	});

	it('strips bullet and numbered list markers', () => {
		const src = '- apples\n* pears\n+ plums\n1. first\n2) second';
		expect(words(src)).toEqual(['apples', 'pears', 'plums', 'first', 'second']);
	});

	it('strips nested list markers and task checkboxes', () => {
		expect(words('- [ ] buy milk\n  - [x] done it')).toEqual(['buy', 'milk', 'done', 'it']);
	});

	it('does not strip a leading minus sign that is not a list marker', () => {
		expect(words('-5 degrees')).toEqual(['-5', 'degrees']);
	});

	it('strips blockquote markers', () => {
		expect(words('> To be\n> or not')).toEqual(['To', 'be', 'or', 'not']);
	});

	it('strips callout markers but keeps the title and body', () => {
		const src = '> [!note]- Remember\n> Water the plants';
		expect(words(src)).toEqual(['Remember', 'Water', 'the', 'plants']);
	});

	it('drops horizontal rules and table separators', () => {
		const src = '| Day | Mood |\n| --- | :---: |\n| Mon | good |';
		expect(words(src)).toEqual(['Day', 'Mood', 'Mon', 'good']);
	});
});

describe('emphasis', () => {
	it('strips bold, italic, strikethrough and highlight markers', () => {
		const src = 'A **bold** and *italic* and __strong__ and _em_ and ~~gone~~ and ==marked== day';
		expect(words(src)).toEqual([
			'A', 'bold', 'and', 'italic', 'and', 'strong', 'and', 'em', 'and', 'gone', 'and', 'marked', 'day',
		]);
	});

	it('handles nested and multi-word emphasis', () => {
		expect(words('***very*** **big deal**')).toEqual(['very', 'big', 'deal']);
	});

	it('keeps punctuation that follows emphasis attached', () => {
		const src = 'It was **fine**, honestly.';
		const tokens = tokenize(src);
		expect(tokens.map((t) => t.display)).toEqual(['It', 'was', 'fine,', 'honestly.']);
		// Highlight covers the original source span, markup included.
		expect(src.slice(tokens[2]?.start, tokens[2]?.end)).toBe('fine**,');
	});

	it('leaves intraword underscores and lone asterisks alone', () => {
		expect(words('snake_case_name and 2 * 3')).toEqual(['snake_case_name', 'and', '2', '*', '3']);
	});

	it('respects backslash escapes', () => {
		expect(words('\\*not italic\\*')).toEqual(['*not', 'italic*']);
	});
});

describe('links', () => {
	it('speaks markdown link text, not the URL', () => {
		const src = 'See [the docs](https://example.com/a?b=c) today';
		const tokens = tokenize(src);
		expect(tokens.map((t) => t.display)).toEqual(['See', 'the', 'docs', 'today']);
		expect(slices(src, tokens)).toEqual(['See', 'the', 'docs', 'today']);
	});

	it('handles reference links and autolinks', () => {
		expect(words('A [ref link][1] and <https://x.org>')).toEqual(['A', 'ref', 'link', 'and', 'https://x.org']);
	});

	it('drops images and embeds entirely', () => {
		expect(words('Before ![alt text](pic.png) ![[Photo.jpg]] after')).toEqual(['Before', 'after']);
	});

	it('speaks the note name for a plain wikilink', () => {
		expect(words('Met [[Alice Smith]] today')).toEqual(['Met', 'Alice', 'Smith', 'today']);
	});

	it('speaks the alias for a wikilink with an alias', () => {
		const src = 'Called [[People/Alice Smith|Ally]] again';
		const tokens = tokenize(src);
		expect(tokens.map((t) => t.display)).toEqual(['Called', 'Ally', 'again']);
		expect(tokens[1]?.start).toBe(src.indexOf('Ally'));
		expect(tokens[1]?.end).toBe(src.indexOf('Ally') + 4);
	});

	it('drops folders, headings and .md from wikilink targets', () => {
		expect(words('[[Journal/2026/Monday.md#Evening]]')).toEqual(['Monday']);
		expect(words('[[#Evening plans]]')).toEqual(['Evening', 'plans']);
		expect(words('x [[#^abc123]] y')).toEqual(['x', 'y']);
	});

	it('keeps punctuation after a wikilink attached', () => {
		expect(words('I saw [[Bob]].')).toEqual(['I', 'saw', 'Bob.']);
	});
});

describe('code', () => {
	const src = 'Before\n\n```js\nconst x = 1;\n```\n\nAfter `inline` code';

	it('skips fenced code blocks by default', () => {
		expect(words(src)).toEqual(['Before', 'After', 'inline', 'code']);
	});

	it('reads fenced code blocks when skipCodeBlocks is off', () => {
		expect(words(src, { skipCodeBlocks: false })).toEqual([
			'Before', 'const', 'x', '=', '1;', 'After', 'inline', 'code',
		]);
	});

	it('does not interpret markdown inside code', () => {
		const md = '```\n# not a heading **x**\n```';
		expect(words(md, { skipCodeBlocks: false })).toEqual(['#', 'not', 'a', 'heading', '**x**']);
		expect(words('Use `**raw**` here')).toEqual(['Use', '**raw**', 'here']);
	});

	it('supports tilde fences and longer closing fences', () => {
		expect(words('~~~\nhidden\n~~~~\nshown')).toEqual(['shown']);
	});

	it('treats an unclosed fence as code to the end', () => {
		expect(words('Text\n```\nnever closed')).toEqual(['Text']);
	});
});

describe('comments and other noise', () => {
	it('drops HTML comments, including multi-line ones', () => {
		expect(words('One <!-- secret --> two <!--\nhidden\n--> three')).toEqual(['One', 'two', 'three']);
	});

	it('drops Obsidian %% comments', () => {
		expect(words('Keep %%not this%% this')).toEqual(['Keep', 'this']);
	});

	it('does not treat comment syntax inside code as a comment', () => {
		expect(words('```\n<!-- x -->\n```\nok', { skipCodeBlocks: false })).toEqual(['<!--', 'x', '-->', 'ok']);
	});

	it('drops footnote references, HTML tags and block ids', () => {
		expect(words('A claim[^1] in <b>bold</b> text ^block-1')).toEqual(['A', 'claim', 'in', 'bold', 'text']);
	});
});

describe('punctuation mode', () => {
	const opts = { speakPunctuation: true };

	it('splits punctuation into its own steps', () => {
		expect(speech('Hello, world.', opts)).toEqual(['Hello', 'comma', 'world', 'full stop']);
	});

	it('names quotes, brackets and ellipses', () => {
		expect(speech('"Wait (please)..." she said', opts)).toEqual([
			'open quote', 'Wait', 'open bracket', 'please', 'close bracket', 'ellipsis', 'close quote', 'she', 'said',
		]);
	});

	it('adds new line and new paragraph steps', () => {
		expect(speech('One\nTwo\n\nThree', opts)).toEqual(['One', 'new line', 'Two', 'new paragraph', 'Three']);
	});

	it('does not add a break for frontmatter or at the start or end', () => {
		expect(speech('---\na: 1\n---\n\nHi\n\n', opts)).toEqual(['Hi']);
	});

	it('keeps apostrophes in contractions and possessives', () => {
		expect(speech("Don't touch the students' books.", opts)).toEqual([
			"Don't", 'touch', 'the', "students'", 'books', 'full stop',
		]);
	});

	it('pairs single quotes', () => {
		expect(speech("'Hi there,' he said", opts)).toEqual([
			'open single quote', 'Hi', 'there', 'comma', 'close single quote', 'he', 'said',
		]);
	});

	it('keeps abbreviations like e.g. intact', () => {
		expect(speech('Fruit, e.g. apples.', opts)).toEqual(['Fruit', 'comma', 'e.g.', 'apples', 'full stop']);
	});

	it('maps each step to the exact source offsets', () => {
		const src = '- **Yes**, *really*!';
		const tokens = tokenize(src, opts);
		expect(tokens.map((t) => t.display)).toEqual(['Yes', ',', 'really', '!']);
		expect(slices(src, tokens)).toEqual(['Yes', ',', 'really', '!']);
	});

	it('is off by default', () => {
		expect(words('Hi, you.')).toEqual(['Hi,', 'you.']);
	});
});

describe('offset mapping', () => {
	it('maps every token in a busy note back to its source text', () => {
		const src = [
			'---',
			'mood: calm',
			'---',
			'# Tuesday',
			'',
			'> [!quote] Overheard',
			'> "Nice [[Places/Park|park]]," she said.',
			'',
			'1. Walked **3km** with [Sam](https://sam.example)',
			'2. Ate ~~cake~~ fruit <!-- no comment -->',
		].join('\n');
		const tokens = tokenize(src);
		expect(tokens.map((t) => t.display)).toEqual([
			'Tuesday', 'Overheard', '"Nice', 'park,"', 'she', 'said.', 'Walked', '3km', 'with', 'Sam', 'Ate', 'cake', 'fruit',
		]);
		for (const t of tokens) {
			// The first and last characters of each token must line up exactly.
			expect(src[t.start]).toBe(t.display[0]);
			expect(src[t.end - 1]).toBe(t.display[t.display.length - 1]);
		}
	});

	it('only returns tokens overlapping a selection range', () => {
		const src = 'one two three four';
		const from = src.indexOf('two');
		const to = src.indexOf('three') + 2; // ends mid-word
		expect(tokenize(src, {}, { from, to }).map((t) => t.display)).toEqual(['two', 'three']);
	});

	it('respects context outside the selection', () => {
		const src = '```\ncode words\n```\nprose';
		expect(tokenize(src, {}, { from: 0, to: src.length }).map((t) => t.display)).toEqual(['prose']);
		expect(tokenize(src, {}, { from: 4, to: 14 })).toEqual([]);
	});

	it('finds the token at or after an offset', () => {
		const tokens = tokenize('alpha beta gamma');
		expect(findTokenIndexAtOffset(tokens, 0)).toBe(0);
		expect(findTokenIndexAtOffset(tokens, 7)).toBe(1); // inside "beta"
		expect(findTokenIndexAtOffset(tokens, 5)).toBe(1); // the space before "beta"
		expect(findTokenIndexAtOffset(tokens, 999)).toBe(2);
		expect(findTokenIndexAtOffset([], 0)).toBe(-1);
	});
});

describe('spellOut', () => {
	it('spells letters, capitals and punctuation', () => {
		expect(spellOut("Don't")).toEqual(['capital D', 'o', 'n', 'apostrophe', 't']);
		expect(spellOut('re-do')).toEqual(['r', 'e', 'hyphen', 'd', 'o']);
		expect(spellOut('B2')).toEqual(['capital B', '2']);
	});

	it('handles accented and non-Latin letters', () => {
		expect(spellOut('Café')).toEqual(['capital C', 'a', 'f', 'é']);
	});
});
