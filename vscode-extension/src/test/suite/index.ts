import * as path from 'path';
import { glob } from 'glob';

export async function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname, '..');

    // Dynamically import mocha
    const { default: Mocha } = await import('mocha');
    
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    // Find all test files
    const testFiles = glob.sync('**/**.test.js', { cwd: testsRoot });
    
    // Add files to the test suite
    testFiles.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    return new Promise((c, e) => {
        try {
            // Run the mocha test
            mocha.run((failures: number) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        } catch (err) {
            console.error(err);
            e(err);
        }
    });
}