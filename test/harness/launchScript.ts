import * as mjolnirTesting from './mjolnirTesting';

console.log('wat')
switch (process.argv[2]) {
    case 'up':
        console.info('hmm')
        mjolnirTesting.upHarness();
        break;
    case 'down':
        mjolnirTesting.downHarness();
        break;
}