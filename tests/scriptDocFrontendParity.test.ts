import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {DOC_TITLE, SCRIPT_DOC} from '../src/scriptDoc/content';
import * as dialer from '../src/scriptDoc/core';
import type {Block} from '../src/scriptDoc/types';

// Like scriptParity.test.ts, exercise the sibling checkout when it is available.
const frontendRoot = resolve(
	import.meta.dirname,
	'../../EmberQA-Frontend/src/sections/dashboard/training/programs/policyPrinterScript'
);
const frontendContent = existsSync(resolve(frontendRoot, 'content.ts'))
	? await import(/* @vite-ignore */ resolve(frontendRoot, 'content.ts'))
	: undefined;
const frontendCore: typeof dialer | undefined = frontendContent
	? await import(/* @vite-ignore */ resolve(frontendRoot, 'core.ts'))
	: undefined;

describe.skipIf(!frontendContent || !frontendCore)(
	'ENG-298 dialer / training script parity',
	() => {
		it('keeps the complete script and its section/objection/trigger targets identical', () => {
			expect(frontendContent!.DOC_TITLE).toBe(DOC_TITLE);
			expect(frontendContent!.SCRIPT_DOC).toEqual(SCRIPT_DOC);
		});

		it('keeps visibility, choices, exits, and link resolution identical in both modes', () => {
			const index = dialer.buildAnchorIndex(SCRIPT_DOC);
			const trainingIndex = frontendCore!.buildAnchorIndex(
				frontendContent!.SCRIPT_DOC
			);
			expect(trainingIndex).toEqual(index);
			expect(frontendCore!.buildPathGroups(SCRIPT_DOC, trainingIndex)).toEqual(
				dialer.buildPathGroups(SCRIPT_DOC, index)
			);
			expect(frontendCore!.findBrokenLinks(SCRIPT_DOC, trainingIndex)).toEqual(
				[]
			);
			const walk = (blocks: Block[]) => {
				for (const block of blocks) {
					for (const mode of ['live', 'training'] as const) {
						expect(
							frontendCore!.isBlockVisible(
								block,
								mode,
								SCRIPT_DOC,
								trainingIndex
							)
						).toBe(dialer.isBlockVisible(block, mode, SCRIPT_DOC, index));
					}
					if (block.t === 'path') walk(block.blocks);
				}
			};
			for (const node of SCRIPT_DOC) {
				walk(node.blocks);
				expect(frontendCore!.exitOf(node)).toEqual(dialer.exitOf(node));
			}
		});
	}
);
