import * as mjolnirTesting from './mjolnirTesting';

switch (process.argv[2]) {
    case 'up':
        mjolnirTesting.upHarness();
        break;
    case 'down':
        mjolnirTesting.downHarness();
        break;
}