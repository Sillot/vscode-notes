import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// VS Code sets this for processes it spawns, which would make the VS Code
		// we download run as plain Node instead of Electron and reject every option
		delete process.env.ELECTRON_RUN_AS_NODE;

		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({ extensionDevelopmentPath, extensionTestsPath });
	} catch (err) {
		// report the underlying failure, not just that something went wrong
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

main();
