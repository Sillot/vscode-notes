import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../extension';
import { Note } from '../../note';
import { NotesViewProvider } from '../../notesViewProvider';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.equal(-1, [1, 2, 3].indexOf(5));
		assert.equal(-1, [1, 2, 3].indexOf(0));
	});
});

/*
 * The snapshot is what tells the watcher whether anything the tree displays has
 * changed, so these cover the three decisions behind it: what counts as a
 * change, what deliberately does not, and how much of the tree is looked at.
 */
suite('External change detection', () => {

	let notesLocation: string;

	setup(() => {
		notesLocation = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-notes-'));
		fs.writeFileSync(path.join(notesLocation, 'first.md'), '# first\n');
		fs.mkdirSync(path.join(notesLocation, 'folder'));
	});

	teardown(() => {
		fs.rmSync(notesLocation, { recursive: true, force: true });
	});

	test('a note appearing on its own is picked up', async () => {
		const tree = new NotesViewProvider(notesLocation, '*');
		const before = await tree.snapshot();

		fs.writeFileSync(path.join(notesLocation, 'synced.md'), '# synced\n');

		assert.notStrictEqual(await tree.snapshot(), before);
	});

	test('editing a note is not a change worth redrawing', async () => {
		const tree = new NotesViewProvider(notesLocation, '*');
		const before = await tree.snapshot();

		fs.writeFileSync(path.join(notesLocation, 'first.md'), '# first, rewritten\n');

		// the signature holds names rather than modification times, which is what
		// keeps a poll cheap and an edit from refreshing the tree for nothing
		assert.strictEqual(await tree.snapshot(), before);
	});

	test('only the open folders are watched', async () => {
		const tree = new NotesViewProvider(notesLocation, '*');
		const nested = path.join(notesLocation, 'folder', 'nested.md');

		const closed = await tree.snapshot();
		fs.writeFileSync(nested, '# nested\n');
		assert.strictEqual(await tree.snapshot(), closed, 'a closed folder shows nothing, so it costs nothing');

		tree.setExpanded(new Note('folder', notesLocation, '', '', true), true);
		const open = await tree.snapshot();
		fs.unlinkSync(nested);
		assert.notStrictEqual(await tree.snapshot(), open, 'an open folder is on screen, so it is watched');
	});

	test('an open folder that disappears is reported once, then settles', async () => {
		const tree = new NotesViewProvider(notesLocation, '*');
		tree.setExpanded(new Note('folder', notesLocation, '', '', true), true);

		const before = await tree.snapshot();
		fs.rmSync(path.join(notesLocation, 'folder'), { recursive: true, force: true });

		const reported = await tree.snapshot();
		assert.notStrictEqual(reported, before, 'the folder leaving the tree is a change');
		// a watcher compares one snapshot to the next, so a folder that is gone has
		// to stop moving, or every poll would redraw the tree for nothing
		assert.strictEqual(await tree.snapshot(), reported, 'and it stops being one');
	});

	test('a file the tree would not show is not a change', async () => {
		const tree = new NotesViewProvider(notesLocation, 'md');
		const before = await tree.snapshot();

		// the snapshot filters extensions itself, so it has to agree with getNotes
		fs.writeFileSync(path.join(notesLocation, 'ignored.txt'), 'not a note\n');
		assert.strictEqual(await tree.snapshot(), before);

		fs.writeFileSync(path.join(notesLocation, 'counted.md'), '# counted\n');
		assert.notStrictEqual(await tree.snapshot(), before);
	});
});
