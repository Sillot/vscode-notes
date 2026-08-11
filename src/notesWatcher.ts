import * as vscode from 'vscode';
import { NotesViewProvider } from './notesViewProvider';

let fileWatcher: vscode.FileSystemWatcher | undefined;
let watcherListeners: vscode.Disposable[] = [];
let pollTimer: ReturnType<typeof setInterval> | undefined;
let notesTree: NotesViewProvider | undefined;
let notesVisible = true;
let lastSnapshot: string | undefined;
let checking = false;
let checkGuardTimer: ReturnType<typeof setTimeout> | undefined;

/* How long a check may hold the guard before later polls are allowed through. */
const CHECK_GUARD_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_SECONDS = 5;
const MIN_INTERVAL_SECONDS = 2;
const MAX_INTERVAL_SECONDS = 60;

/*
 * Watches the storage location for notes added, renamed or removed outside of
 * this window: another VS Code window, a sync client, the Windows side of a WSL
 * setup.
 *
 * Registers its own teardown on the extension's lifetime.
 */
export function initNotesWatcher(context: vscode.ExtensionContext, tree: NotesViewProvider): void {
	notesTree = tree;
	context.subscriptions.push(new vscode.Disposable(() => stopWatching()));
	restartNotesWatcher();
}

// call whenever the storage location or one of the watch settings changed
export function restartNotesWatcher(): void {
	stopWatching();
	if (!notesTree) {
		return;
	}

	const configuration = vscode.workspace.getConfiguration('notes');
	if (!configuration.get<boolean>('watchExternalChanges', true)) {
		return;
	}

	const notesLocation = String(configuration.get('notesLocation') ?? '');
	if (!notesLocation) {
		return;
	}

	startFileWatcher(notesLocation);

	// The watcher is only a low-latency hint: a storage location on a synced or
	// Windows folder never delivers an event, inotify does not cross the mount.
	// Polling is the source of truth.
	const seconds = clampIntervalSeconds(configuration.get('watchIntervalSeconds'));
	pollTimer = setInterval(() => void check(true), seconds * 1000);
}

// the tree is only worth polling while someone is looking at it
export function setNotesVisible(visible: boolean): void {
	notesVisible = visible;
	// catch up on whatever happened while the view was hidden
	if (visible) {
		void check(true);
	}
}

/*
 * Take what is on disk now as the reference, without redrawing anything.
 *
 * Called once the tree already shows the current state, either because the
 * extension just rebuilt it or because the user opened a folder, which changes
 * what the snapshot covers without anything having changed on disk.
 *
 * The reference is recomputed rather than dropped: leaving it empty would make
 * the next poll unable to report anything, and a change landing in that window
 * would never be seen again.
 */
export function rebaselineWatcher(): void {
	void check(false);
}

function clampIntervalSeconds(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_INTERVAL_SECONDS;
	}
	return Math.min(Math.max(Math.round(value), MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS);
}

function startFileWatcher(notesLocation: string): void {
	try {
		fileWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(notesLocation), '**/*'),
			false, // report created notes and folders
			true,  // ignore edits, the tree renders names only
			false  // report deleted notes and folders
		);
	} catch (err) {
		// an unmounted or unwatchable drive must not break the extension, the
		// poll loop still covers it
		fileWatcher = undefined;
		return;
	}

	const onEvent = () => void check(true);
	watcherListeners = [fileWatcher.onDidCreate(onEvent), fileWatcher.onDidDelete(onEvent)];
}

function releaseGuard(): void {
	checking = false;
	if (checkGuardTimer !== undefined) {
		clearTimeout(checkGuardTimer);
		checkGuardTimer = undefined;
	}
}

async function check(refreshOnChange: boolean): Promise<void> {
	if (!notesTree || !notesVisible) {
		return;
	}

	/*
	 * Reading a sleeping synced folder can outlive the poll interval.
	 *
	 * This also covers the reentrant call: refreshing below fires the tree data
	 * event, which comes straight back here to rebaseline. The guard turns that
	 * into a no-op and leaves the reference on the snapshot just compared.
	 */
	if (checking) {
		return;
	}
	checking = true;
	// …and reading a folder that never wakes up can outlive everything. Release
	// the guard on a timer so one hung call does not end the polling for good.
	checkGuardTimer = setTimeout(() => {
		checking = false;
		checkGuardTimer = undefined;
	}, CHECK_GUARD_TIMEOUT_MS);

	try {
		const snapshot = await notesTree.snapshot();
		const changed = lastSnapshot !== undefined && snapshot !== lastSnapshot;
		lastSnapshot = snapshot;

		if (changed && refreshOnChange) {
			notesTree.refresh();
		}
	} catch (err) {
		// a rejection escaping the interval would only add noise to the log
		console.error('Failed to check the notes location for changes:', err);
	} finally {
		releaseGuard();
	}
}

function stopWatching(): void {
	for (const listener of watcherListeners) {
		listener.dispose();
	}
	watcherListeners = [];
	fileWatcher?.dispose();
	fileWatcher = undefined;

	if (pollTimer !== undefined) {
		clearInterval(pollTimer);
		pollTimer = undefined;
	}

	lastSnapshot = undefined;
	releaseGuard();
}
