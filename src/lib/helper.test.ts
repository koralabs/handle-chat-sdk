import assert from 'node:assert';
import { afterEach, describe, it, mock } from 'node:test';

describe('helper tests', () => {
    afterEach(() => {
        mock.restoreAll();
    });

     it('should pass', async () => {
        assert.strictEqual('', '');
    });
});